import { mkdir, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { DesktopDeletionPolicy } from '@foldersync/contracts';
import type { DeletionAppliedAction, Repositories } from '../db/index.ts';
import { fsyncDir } from '../storage/durability.ts';
import { relativeTrashPath, trashPathFor } from '../storage/layout.ts';

// POST /v1/files/delete (spec 6.4, 25.2, 26.2): applies a phone-reported
// user/external deletion to the desktop copy. The desktop is one-way authoritative
// for its own files (spec 6.3) — it consults its own deletion policy, refuses to act
// on a stale version, and moves rather than erases. Path safety and mapping
// ownership are enforced by the caller (the control endpoint); this service owns the
// delete mechanics and their atomic record.

export interface ApplyDeletionInput {
  eventId: string;
  phoneDeviceId: string;
  rootId: string;
  destinationRoot: string;
  // Normalised storage key (the canonical form from resolveDestinationPath).
  relativePath: string;
  expectedRemoteVersionId: string;
  // The mapping's desktop policy; null (an unbound mapping) is treated as preserve —
  // a file is never trashed while the policy is unknown.
  desktopDeletionPolicy: DesktopDeletionPolicy | null;
}

export type DeletionResult =
  | { outcome: 'applied'; action: DeletionAppliedAction; trashPath: string | null }
  | { outcome: 'already_applied'; trashPath: string | null }
  // The phone deleted a version the desktop no longer holds current: this needs
  // review, not a silent trash (spec 26.2 CONFLICT_REQUIRES_REVIEW). No event is
  // recorded, so the phone may retry after re-syncing.
  | { outcome: 'version_conflict' };

export interface DeleteService {
  applyDeletion(input: ApplyDeletionInput): Promise<DeletionResult>;
}

export interface DeleteServiceDeps {
  repositories: Repositories;
  // Injectable clock so the trash-directory timestamp and applied_at are
  // deterministic in tests; defaults to the wall clock.
  now?: () => Date;
}

function errnoCode(error: unknown): string | undefined {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return undefined;
}

// Moves the committed file into managed trash (spec 6.4). Returns false when the
// source is already gone — an external deletion beat us to it, which is not an error:
// the desktop copy is absent either way.
async function moveToTrash(
  destinationRoot: string,
  relativePath: string,
  timestamp: Date,
): Promise<boolean> {
  const source = join(destinationRoot, ...relativePath.split('/'));
  const target = trashPathFor(destinationRoot, timestamp, relativePath);
  await mkdir(dirname(target), { recursive: true });
  try {
    await rename(source, target);
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') return false;
    throw error;
  }
  // The trashed file and both directory entries must be durable (spec 18.5).
  await fsyncDir(dirname(target));
  await fsyncDir(dirname(source));
  return true;
}

export function createDeleteService(deps: DeleteServiceDeps): DeleteService {
  const { repositories } = deps;
  const now = deps.now ?? (() => new Date());

  return {
    applyDeletion: async (input) => {
      // Idempotent replay: a known event id returns its recorded outcome (spec 25.2).
      const existing = repositories.files.getDeletionEvent(input.eventId);
      if (existing !== null) {
        return { outcome: 'already_applied', trashPath: existing.trashPath };
      }

      const at = now();
      const appliedAt = at.toISOString();
      const remoteFile = repositories.files.getRemoteFile(
        input.phoneDeviceId,
        input.rootId,
        input.relativePath,
      );

      // Nothing committed (or already trashed) at this path: a no-op, still recorded
      // so a later replay of this event id is recognised.
      if (remoteFile === null || remoteFile.state !== 'committed') {
        repositories.files.recordDeletion({
          eventId: input.eventId,
          remoteFileId: remoteFile?.id ?? null,
          expectedVersionId: input.expectedRemoteVersionId,
          relativePath: input.relativePath,
          appliedAction: 'no_remote_file',
          trashPath: null,
          appliedAt,
        });
        return { outcome: 'applied', action: 'no_remote_file', trashPath: null };
      }

      // Version gate (spec 26.2): the phone must be deleting the version the desktop
      // currently holds. A mismatch means the desktop advanced since the phone last
      // synced — refuse rather than trash newer content.
      if (remoteFile.currentVersionId !== input.expectedRemoteVersionId) {
        return { outcome: 'version_conflict' };
      }

      // Policy gate (spec 6.1/6.4): only mirror_user_deletions trashes; otherwise the
      // desktop keeps its copy and merely records that the phone deleted its own.
      if (input.desktopDeletionPolicy !== 'mirror_user_deletions') {
        repositories.files.recordDeletion({
          eventId: input.eventId,
          remoteFileId: remoteFile.id,
          expectedVersionId: input.expectedRemoteVersionId,
          relativePath: input.relativePath,
          appliedAction: 'preserved',
          trashPath: null,
          appliedAt,
        });
        return { outcome: 'applied', action: 'preserved', trashPath: null };
      }

      const moved = await moveToTrash(input.destinationRoot, input.relativePath, at);
      const trashPath = moved ? relativeTrashPath(at, input.relativePath) : null;
      repositories.files.recordDeletion({
        eventId: input.eventId,
        remoteFileId: remoteFile.id,
        expectedVersionId: input.expectedRemoteVersionId,
        relativePath: input.relativePath,
        appliedAction: 'trashed',
        trashPath,
        appliedAt,
      });
      return { outcome: 'applied', action: 'trashed', trashPath };
    },
  };
}
