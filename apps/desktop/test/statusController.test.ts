import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  openDatabase,
  createRepositories,
  type Database,
  type Repositories,
} from '../src/main/db/index.ts';
import { createStatusController } from '../src/main/ui/statusController.ts';

// The desktop status view (agent_design §5) against a real in-memory database: every
// destination's free space (bound or not), policies once bound, and the pending-commit
// backlog per destination and in total. statfs is injected so disk-space states are
// deterministic; the real statfs default is exercised at launch, not here.

const CLOCK = '2026-07-25T12:00:00.000Z';
const EXPIRES = '2026-08-01T12:00:00.000Z';
const DEVICE = 'phone-1';

let db: Database;
let repositories: Repositories;

beforeEach(() => {
  db = openDatabase(':memory:');
  repositories = createRepositories(db);
  repositories.devices.insert({
    phoneDeviceId: DEVICE,
    phoneDisplayName: 'Pixel',
    tokenHash: 'h1',
    pairedAt: CLOCK,
  });
});

afterEach(() => {
  db.close();
});

describe('statusController', () => {
  it('reports free space for every destination and policies only once bound', async () => {
    repositories.roots.create({
      mappingId: 'm-bound',
      phoneDeviceId: DEVICE,
      destinationRoot: '/backups/Camera',
      displayName: 'Camera',
      createdAt: CLOCK,
    });
    repositories.roots.bind({
      mappingId: 'm-bound',
      phoneRootId: 'root-1',
      phoneRetentionPolicy: 'delete_after_verified_backup',
      desktopDeletionPolicy: 'mirror_user_deletions',
      updatedAt: CLOCK,
    });
    repositories.roots.create({
      mappingId: 'm-unbound',
      phoneDeviceId: DEVICE,
      destinationRoot: '/backups/Docs',
      displayName: 'Docs',
      createdAt: CLOCK,
    });

    const controller = createStatusController({
      repositories,
      freeSpace: (path) =>
        Promise.resolve(path === '/backups/Camera' ? 5_000_000_000 : 9_000_000_000),
    });

    const view = await controller.getStatus();
    const byId = new Map(view.destinations.map((d) => [d.mappingId, d]));

    expect(byId.get('m-bound')).toEqual({
      mappingId: 'm-bound',
      destinationAvailable: true,
      freeBytes: 5_000_000_000,
      phoneRetentionPolicy: 'delete_after_verified_backup',
      desktopDeletionPolicy: 'mirror_user_deletions',
      pendingCommits: 0,
      lastSyncedAt: null,
    });
    expect(byId.get('m-unbound')).toEqual({
      mappingId: 'm-unbound',
      destinationAvailable: true,
      freeBytes: 9_000_000_000,
      phoneRetentionPolicy: null,
      desktopDeletionPolicy: null,
      pendingCommits: 0,
      lastSyncedAt: null,
    });
    expect(view.pendingCommits).toBe(0);
  });

  it('marks a destination unavailable when its volume cannot be read', async () => {
    repositories.roots.create({
      mappingId: 'm-usb',
      phoneDeviceId: DEVICE,
      destinationRoot: '/mnt/usb',
      displayName: 'USB',
      createdAt: CLOCK,
    });
    const controller = createStatusController({
      repositories,
      freeSpace: () => Promise.reject(new Error('ENOENT')),
    });

    const view = await controller.getStatus();
    expect(view.destinations[0]).toEqual({
      mappingId: 'm-usb',
      destinationAvailable: false,
      freeBytes: null,
      phoneRetentionPolicy: null,
      desktopDeletionPolicy: null,
      pendingCommits: 0,
      lastSyncedAt: null,
    });
  });

  it('counts pending commits per bound root and in total', async () => {
    repositories.roots.create({
      mappingId: 'm-bound',
      phoneDeviceId: DEVICE,
      destinationRoot: '/backups/Camera',
      displayName: 'Camera',
      createdAt: CLOCK,
    });
    repositories.roots.bind({
      mappingId: 'm-bound',
      phoneRootId: 'root-1',
      phoneRetentionPolicy: 'keep_on_phone',
      desktopDeletionPolicy: 'preserve_desktop_copy',
      updatedAt: CLOCK,
    });

    const prepare = (id: string): void => {
      repositories.files.createPrepare({
        prepareId: id,
        phoneDeviceId: DEVICE,
        rootId: 'root-1',
        fileEntryId: `fe-${id}`,
        relativePath: `${id}.bin`,
        expectedSize: 10,
        createdAt: CLOCK,
        expiresAt: EXPIRES,
      });
    };
    prepare('p-uploaded');
    repositories.files.setPrepareState('p-uploaded', 'uploaded');
    prepare('p-committing');
    repositories.files.setPrepareState('p-committing', 'committing');
    // A still-transferring prepare is not part of the commit backlog.
    prepare('p-uploading');
    repositories.files.setPrepareState('p-uploading', 'uploading');

    const controller = createStatusController({
      repositories,
      freeSpace: () => Promise.resolve(1_000),
    });

    const view = await controller.getStatus();
    expect(view.destinations[0]?.pendingCommits).toBe(2);
    expect(view.pendingCommits).toBe(2);
  });

  it('reports the most recent commit as last synced, null before any commit', async () => {
    repositories.roots.create({
      mappingId: 'm-bound',
      phoneDeviceId: DEVICE,
      destinationRoot: '/backups/Camera',
      displayName: 'Camera',
      createdAt: CLOCK,
    });
    repositories.roots.bind({
      mappingId: 'm-bound',
      phoneRootId: 'root-1',
      phoneRetentionPolicy: 'keep_on_phone',
      desktopDeletionPolicy: 'preserve_desktop_copy',
      updatedAt: CLOCK,
    });
    const controller = createStatusController({
      repositories,
      freeSpace: () => Promise.resolve(1_000),
    });

    expect((await controller.getStatus()).destinations[0]?.lastSyncedAt).toBeNull();

    repositories.files.recordCommittedVersion({
      phoneDeviceId: DEVICE,
      rootId: 'root-1',
      fileEntryId: 'fe-old',
      relativePath: 'old.bin',
      sha256: 'a'.repeat(64),
      size: 1,
      committedAt: '2026-07-20T00:00:00.000Z',
    });
    repositories.files.recordCommittedVersion({
      phoneDeviceId: DEVICE,
      rootId: 'root-1',
      fileEntryId: 'fe-new',
      relativePath: 'new.bin',
      sha256: 'b'.repeat(64),
      size: 1,
      committedAt: '2026-07-24T09:30:00.000Z',
    });

    expect((await controller.getStatus()).destinations[0]?.lastSyncedAt).toBe(
      '2026-07-24T09:30:00.000Z',
    );
  });
});
