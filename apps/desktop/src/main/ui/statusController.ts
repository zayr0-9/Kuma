import type { Repositories } from '../db/index.ts';
import { freeBytesOnVolume } from '../storage/diskSpace.ts';
import type { DestinationStatus, SyncStatusView } from '../../shared/status.ts';

// Assembles the desktop status view (agent_design §5) with no Electron dependency, so
// the disk-space and pending-commit states are unit-tested. Unlike the phone-facing
// GET /v1/sync/status this reports every destination (bound or not) and its policies,
// because the management UI shows a folder's free space before a phone links to it.

export interface StatusControllerDeps {
  repositories: Repositories;
  // Free bytes for a destination volume; defaults to statfs. Injectable so
  // availability (statfs failure) and free-space figures are deterministic in tests.
  freeSpace?: (path: string) => Promise<number>;
}

export interface StatusController {
  getStatus(): Promise<SyncStatusView>;
}

export function createStatusController(deps: StatusControllerDeps): StatusController {
  const { repositories } = deps;
  const freeSpace = deps.freeSpace ?? freeBytesOnVolume;

  return {
    getStatus: async () => {
      const destinations: DestinationStatus[] = await Promise.all(
        repositories.roots.list().map(async (mapping) => {
          // An unplugged or unreadable destination volume fails statfs — surfaced as
          // unavailable rather than throwing the whole view (agent_design §2).
          let destinationAvailable = true;
          let freeBytes: number | null = null;
          try {
            freeBytes = await freeSpace(mapping.destinationRoot);
          } catch {
            destinationAvailable = false;
          }

          // Pending backlog and last-synced time are per bound root; an unbound
          // destination has neither (no root to key on).
          const pendingCommits =
            mapping.phoneRootId === null
              ? 0
              : repositories.files.countPendingCommitsForRoot(
                  mapping.phoneDeviceId,
                  mapping.phoneRootId,
                );
          const lastSyncedAt =
            mapping.phoneRootId === null
              ? null
              : repositories.files.getLastCommittedAt(mapping.phoneDeviceId, mapping.phoneRootId);

          return {
            mappingId: mapping.mappingId,
            destinationAvailable,
            freeBytes,
            phoneRetentionPolicy: mapping.phoneRetentionPolicy,
            desktopDeletionPolicy: mapping.desktopDeletionPolicy,
            pendingCommits,
            lastSyncedAt,
          };
        }),
      );

      return {
        destinations,
        pendingCommits: repositories.files.countPendingCommits(),
      };
    },
  };
}
