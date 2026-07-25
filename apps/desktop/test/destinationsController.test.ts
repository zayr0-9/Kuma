import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  openDatabase,
  createRepositories,
  type Database,
  type Repositories,
} from '../src/main/db/index.ts';
import {
  createDestinationsController,
  type DestinationsController,
} from '../src/main/ui/destinationsController.ts';

// Destination creation and the overlap guard (spec 12.5/25.2) against a real in-memory
// database. The native folder picker and IPC glue are the electron layer, tested at
// launch; this covers the logic.

const CLOCK = '2026-07-25T12:00:00.000Z';
const DEVICE = 'phone-1';
const DEVICE2 = 'phone-2';

let db: Database;
let repositories: Repositories;
let controller: DestinationsController;
let idCounter: number;

beforeEach(() => {
  db = openDatabase(':memory:');
  repositories = createRepositories(db);
  repositories.devices.insert({
    phoneDeviceId: DEVICE,
    phoneDisplayName: 'Pixel',
    tokenHash: 'h1',
    pairedAt: CLOCK,
  });
  idCounter = 0;
  controller = createDestinationsController({
    repositories,
    now: () => new Date(CLOCK),
    generateId: () => `mapping-${(idCounter += 1)}`,
  });
});

afterEach(() => {
  db.close();
});

describe('destinationsController', () => {
  it('lists active devices, excluding revoked ones', () => {
    repositories.devices.insert({
      phoneDeviceId: DEVICE2,
      phoneDisplayName: 'Galaxy',
      tokenHash: 'h2',
      pairedAt: CLOCK,
    });
    repositories.devices.revoke(DEVICE2, CLOCK);
    expect(controller.listDevices()).toEqual([
      { deviceId: DEVICE, displayName: 'Pixel', pairedAt: CLOCK, lastSeenAt: null },
    ]);
  });

  it('creates a destination for a paired device, deriving the name from the folder', () => {
    const result = controller.addDestination({
      phoneDeviceId: DEVICE,
      destinationRoot: '/backups/Camera',
    });
    expect(result).toEqual({
      outcome: 'created',
      destination: {
        mappingId: 'mapping-1',
        phoneDeviceId: DEVICE,
        destinationRoot: '/backups/Camera',
        displayName: 'Camera',
        bound: false,
      },
    });
    const stored = repositories.roots.getByMappingId('mapping-1');
    expect(stored?.destinationRoot).toBe('/backups/Camera');
    expect(stored?.phoneRootId).toBeNull();
    expect(controller.listDestinations()).toHaveLength(1);
  });

  it('uses an explicit display name when given', () => {
    const result = controller.addDestination({
      phoneDeviceId: DEVICE,
      destinationRoot: '/backups/Camera',
      displayName: 'Phone photos',
    });
    expect(result.outcome === 'created' && result.destination.displayName).toBe('Phone photos');
  });

  it('rejects a folder overlapping an existing destination', () => {
    controller.addDestination({ phoneDeviceId: DEVICE, destinationRoot: '/backups' });
    const nested = controller.addDestination({
      phoneDeviceId: DEVICE,
      destinationRoot: '/backups/Camera',
    });
    expect(nested).toEqual({ outcome: 'overlap', conflictingMappingId: 'mapping-1' });
    expect(controller.listDestinations()).toHaveLength(1);
  });

  it('rejects an unknown device', () => {
    expect(
      controller.addDestination({ phoneDeviceId: 'ghost', destinationRoot: '/backups/x' }),
    ).toEqual({ outcome: 'unknown_device' });
  });

  it('rejects a non-absolute or empty destination', () => {
    expect(
      controller.addDestination({ phoneDeviceId: DEVICE, destinationRoot: 'relative/dir' }),
    ).toEqual({ outcome: 'invalid_destination' });
    expect(controller.addDestination({ phoneDeviceId: DEVICE, destinationRoot: '' })).toEqual({
      outcome: 'invalid_destination',
    });
  });

  it('reports a destination as bound once a phone folder registers', () => {
    controller.addDestination({ phoneDeviceId: DEVICE, destinationRoot: '/backups/Camera' });
    repositories.roots.bind({
      mappingId: 'mapping-1',
      phoneRootId: 'root-1',
      phoneRetentionPolicy: 'keep_on_phone',
      desktopDeletionPolicy: 'preserve_desktop_copy',
      updatedAt: CLOCK,
    });
    expect(controller.listDestinations()[0]?.bound).toBe(true);
  });
});
