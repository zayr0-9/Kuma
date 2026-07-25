import { join } from 'node:path';
import type { ErrorCode } from '@foldersync/protocol';
import type { Repositories } from '../db/index.ts';
import { isTerminalPrepareState } from '../db/index.ts';
import { stagingDirPath } from '../storage/layout.ts';
import { commitStagedFile, type CommitFailure } from './commit.ts';

// Commits one uploaded prepare (spec 18.5 steps 5–9): verify the staged bytes,
// make the file visible atomically (via commitStagedFile / spike 6), then persist
// the new immutable version and flip the prepare to its terminal state. This is the
// operation the commit coordinator serialises per (rootId, relativePath); it never
// runs on the tus request path so a multi-gigabyte hash cannot stall an upload.

export type CommitPrepareResult =
  | { prepareState: 'committed'; versionId: string; commitOutcome: CommittedOutcome }
  | { prepareState: 'failed'; errorCode: ErrorCode }
  // The prepare was already terminal or vanished — nothing to do (idempotent).
  | { prepareState: 'skipped' };

type CommittedOutcome = 'committed' | 'adopted_existing' | 'already_committed';

export interface CommitService {
  commitPrepare(prepareId: string): Promise<CommitPrepareResult>;
}

export interface CommitServiceDeps {
  repositories: Repositories;
  // Commit timestamp; injectable for deterministic tests.
  now?: () => Date;
  // Conflict-directory timestamp forwarded to commitStagedFile; injectable so a
  // preserved-conflict path is deterministic in tests.
  conflictTimestamp?: () => Date;
}

// A commit failure is durable state the phone reads back via prepare status, so it
// maps to a wire error code (spec 25.3) rather than an internal message.
function commitFailureToErrorCode(kind: CommitFailure['kind']): ErrorCode {
  switch (kind) {
    case 'invalid_path':
    case 'reserved_path':
    case 'unsafe_parents':
      return 'invalid_relative_path';
    case 'staged_missing':
      return 'upload_not_found';
    case 'size_mismatch':
    case 'staged_hash_mismatch':
      // The received bytes no longer match what the phone reserved — treat as a
      // source change and let the phone re-upload.
      return 'source_changed';
  }
}

export function createCommitService(deps: CommitServiceDeps): CommitService {
  const { repositories } = deps;
  const now = deps.now ?? (() => new Date());

  const commitPrepare = async (prepareId: string): Promise<CommitPrepareResult> => {
    const prepare = repositories.files.getPrepare(prepareId);
    if (prepare === null || isTerminalPrepareState(prepare.state)) {
      return { prepareState: 'skipped' };
    }

    const mapping = repositories.roots.getByPhoneRoot(prepare.phoneDeviceId, prepare.rootId);
    if (mapping === null) {
      // The mapping was torn down between upload and commit; the destination is gone.
      repositories.files.setPrepareState(prepareId, 'failed', 'destination_unavailable');
      return { prepareState: 'failed', errorCode: 'destination_unavailable' };
    }

    repositories.files.setPrepareState(prepareId, 'verifying');

    const existing = repositories.files.getRemoteFile(
      prepare.phoneDeviceId,
      prepare.rootId,
      prepare.relativePath,
    );
    const lastCommitted =
      existing !== null && existing.sha256 !== null && existing.size !== null
        ? { size: existing.size, sha256: existing.sha256 }
        : null;

    const conflictTimestamp = deps.conflictTimestamp?.();
    const result = await commitStagedFile({
      destinationRoot: mapping.destinationRoot,
      stagedFilePath: join(stagingDirPath(mapping.destinationRoot), prepareId),
      relativePath: prepare.relativePath,
      expectedSize: prepare.expectedSize,
      lastCommitted,
      ...(conflictTimestamp !== undefined ? { timestamp: conflictTimestamp } : {}),
    });

    if (result.outcome === 'failed') {
      const errorCode = commitFailureToErrorCode(result.error.kind);
      repositories.files.setPrepareState(prepareId, 'failed', errorCode);
      return { prepareState: 'failed', errorCode };
    }

    // committed | adopted_existing | already_committed all leave durable bytes at the
    // destination; already_committed carries no size, so fall back to the reservation.
    const size = 'size' in result ? result.size : prepare.expectedSize;
    const { versionId } = repositories.files.recordCommittedVersion({
      phoneDeviceId: prepare.phoneDeviceId,
      rootId: prepare.rootId,
      fileEntryId: prepare.fileEntryId,
      relativePath: prepare.relativePath,
      sha256: result.sha256,
      size,
      committedAt: now().toISOString(),
    });
    repositories.files.setPrepareState(prepareId, 'committed');
    return { prepareState: 'committed', versionId, commitOutcome: result.outcome };
  };

  return { commitPrepare };
}
