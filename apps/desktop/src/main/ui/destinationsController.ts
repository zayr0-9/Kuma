import { randomUUID } from 'node:crypto';
import { basename, isAbsolute } from 'node:path';
import type { Repositories } from '../db/index.ts';
import { findDestinationOverlap } from '../storage/destinationOverlap.ts';
import type {
  AddDestinationRequest,
  AddDestinationResult,
  DestinationSummary,
  DeviceSummary,
  UnbindDestinationResult,
} from '../../shared/destinations.ts';

// Manages destinations (root_mapping rows) for the desktop UI with no Electron
// dependency, so creation and the overlap guard are unit-tested. A destination is
// created for a paired phone (the FK requires one) and starts unbound; the phone binds
// a folder to it later via POST /v1/roots/register. The destination-overlap check runs
// here at creation (spec 12.5) — the register endpoint enforces it again for the wire.

export interface DestinationsControllerDeps {
  repositories: Repositories;
  now?: () => Date;
  // Injectable so a created mapping's id is deterministic in tests.
  generateId?: () => string;
}

export interface DestinationsController {
  listDevices(): DeviceSummary[];
  listDestinations(): DestinationSummary[];
  addDestination(input: AddDestinationRequest): AddDestinationResult;
  unbindDestination(mappingId: string): UnbindDestinationResult;
}

export function createDestinationsController(
  deps: DestinationsControllerDeps,
): DestinationsController {
  const { repositories } = deps;
  const now = deps.now ?? (() => new Date());
  const generateId = deps.generateId ?? (() => randomUUID());

  return {
    listDevices: () =>
      repositories.devices.listActive().map((device) => ({
        deviceId: device.phoneDeviceId,
        displayName: device.phoneDisplayName,
        pairedAt: device.pairedAt,
        lastSeenAt: device.lastSeenAt,
      })),

    listDestinations: () =>
      repositories.roots.list().map((mapping) => ({
        mappingId: mapping.mappingId,
        phoneDeviceId: mapping.phoneDeviceId,
        destinationRoot: mapping.destinationRoot,
        displayName: mapping.displayName,
        bound: mapping.phoneRootId !== null,
      })),

    addDestination: (input) => {
      // The dialog always yields an absolute path; guard anyway so a malformed IPC
      // payload can never create a bad mapping.
      if (input.destinationRoot === '' || !isAbsolute(input.destinationRoot)) {
        return { outcome: 'invalid_destination' };
      }
      if (repositories.devices.getByDeviceId(input.phoneDeviceId) === null) {
        return { outcome: 'unknown_device' };
      }

      const mappingId = generateId();
      const conflict = findDestinationOverlap(
        input.destinationRoot,
        repositories.roots.listDestinations(),
        mappingId,
      );
      if (conflict !== null) {
        return { outcome: 'overlap', conflictingMappingId: conflict };
      }

      const trimmed = input.displayName?.trim();
      const displayName =
        trimmed !== undefined && trimmed !== ''
          ? trimmed
          : basename(input.destinationRoot) || input.destinationRoot;

      repositories.roots.create({
        mappingId,
        phoneDeviceId: input.phoneDeviceId,
        destinationRoot: input.destinationRoot,
        displayName,
        createdAt: now().toISOString(),
      });

      return {
        outcome: 'created',
        destination: {
          mappingId,
          phoneDeviceId: input.phoneDeviceId,
          destinationRoot: input.destinationRoot,
          displayName,
          bound: false,
        },
      };
    },

    // Detach the phone folder so the destination is bindable again (spec 5.6 revocation).
    // The mapping row and its already-committed desktop files are kept — only the binding
    // (phone_root_id + the two policies) is cleared. The phone still holds a stale sync_root
    // until it removes the folder too; its next prepare against this mapping returns
    // root_not_mapped, which it surfaces as an error rather than silently re-uploading.
    unbindDestination: (mappingId) => {
      if (repositories.roots.getByMappingId(mappingId) === null) {
        return { outcome: 'not_found' };
      }
      repositories.roots.unbind(mappingId, now().toISOString());
      return { outcome: 'unbound' };
    },
  };
}
