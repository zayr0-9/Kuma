import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fsyncDir, fsyncFile } from '../storage/durability.ts';
import { sha256File } from '../storage/hash.ts';
import { isReservedRelativePath, conflictPathFor, stagingDirPath } from '../storage/layout.ts';
import { parentsResolveInsideRoot, resolveDestinationPath } from '../storage/pathSafety.ts';

// The commit sequence of spec 18.5 steps 5–9: verify the staged upload, preserve
// an externally modified destination, then make the file visible with one atomic
// rename. The destination must never expose a partially written final file, and
// re-running after a crash must converge (spec 35, spike 6).
//
// Metadata persistence (upload_prepare / remote_file rows) is wired in with the
// database slice; callers pass what the prepare record knows and persist what
// this returns.

export interface CommitRequest {
  destinationRoot: string;
  stagedFilePath: string;
  relativePath: string;
  expectedSize: number;
  // sha256 recorded by a previous attempt (retry/recovery); enables
  // already_committed detection when the staged file is gone and catches
  // staging corruption between attempts
  expectedSha256?: string;
  // what FolderSync last committed at this path (remote_file), null if nothing
  lastCommitted: { size: number; sha256: string } | null;
  // conflict-directory timestamp; injectable so tests are deterministic
  timestamp?: Date;
}

export type CommitFailure =
  | { kind: 'invalid_path'; detail: string }
  | { kind: 'reserved_path' }
  | { kind: 'unsafe_parents' }
  | { kind: 'staged_missing' }
  | { kind: 'size_mismatch'; actualSize: number }
  | { kind: 'staged_hash_mismatch'; actualSha256: string };

export type CommitResult =
  | {
      outcome: 'committed';
      finalPath: string;
      sha256: string;
      size: number;
      // set when an externally modified destination was preserved first (spec 6.5)
      conflictPath: string | null;
    }
  | { outcome: 'adopted_existing'; finalPath: string; sha256: string; size: number }
  | { outcome: 'already_committed'; finalPath: string; sha256: string }
  | { outcome: 'failed'; error: CommitFailure };

// Fault-injection seam for the crash-simulation tests only — production callers
// never pass hooks.
export interface CommitCrashHooks {
  beforeRename?: () => Promise<void> | void;
  afterRename?: () => Promise<void> | void;
}

function errnoCode(error: unknown): string | undefined {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return undefined;
}

async function statOrNull(path: string): Promise<{ size: number } | null> {
  try {
    return await stat(path);
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') return null;
    throw error;
  }
}

// POSIX rename atomically replaces an existing destination. Windows cannot; the
// fallback moves the current file aside into staging first — a brief not-present
// window, but never a partial file.
async function renameOverwriting(from: string, to: string, asidePath: string): Promise<void> {
  try {
    await rename(from, to);
  } catch (error) {
    const code = errnoCode(error);
    if (code !== 'EEXIST' && code !== 'EPERM' && code !== 'EACCES') throw error;
    await rename(to, asidePath);
    await rename(from, to);
    await rm(asidePath, { force: true });
  }
}

async function removeStagedArtifacts(stagedFilePath: string): Promise<void> {
  await rm(stagedFilePath, { force: true });
  // @tus/file-store keeps a sidecar info file next to the upload
  await rm(`${stagedFilePath}.json`, { force: true });
}

export async function commitStagedFile(
  request: CommitRequest,
  crashHooks: CommitCrashHooks = {},
): Promise<CommitResult> {
  const { destinationRoot, stagedFilePath, relativePath, expectedSize, expectedSha256 } = request;

  if (isReservedRelativePath(relativePath)) {
    return { outcome: 'failed', error: { kind: 'reserved_path' } };
  }

  const resolved = resolveDestinationPath(destinationRoot, relativePath);
  if (!resolved.ok) {
    return {
      outcome: 'failed',
      error: { kind: 'invalid_path', detail: JSON.stringify(resolved.error) },
    };
  }
  const finalPath = resolved.absolutePath;

  const stagedStat = await statOrNull(stagedFilePath);
  if (stagedStat === null) {
    // Crash-after-rename recovery: the staged file is gone. If a previous
    // attempt recorded the content hash and the destination matches it, the
    // commit already happened (spec 35 spike 6 — deterministic recovery).
    if (expectedSha256 !== undefined && (await statOrNull(finalPath)) !== null) {
      const destinationSha256 = await sha256File(finalPath);
      if (destinationSha256 === expectedSha256) {
        return { outcome: 'already_committed', finalPath, sha256: destinationSha256 };
      }
    }
    return { outcome: 'failed', error: { kind: 'staged_missing' } };
  }

  if (stagedStat.size !== expectedSize) {
    return { outcome: 'failed', error: { kind: 'size_mismatch', actualSize: stagedStat.size } };
  }

  const stagedSha256 = await sha256File(stagedFilePath);
  if (expectedSha256 !== undefined && stagedSha256 !== expectedSha256) {
    return {
      outcome: 'failed',
      error: { kind: 'staged_hash_mismatch', actualSha256: stagedSha256 },
    };
  }

  if (!(await parentsResolveInsideRoot(destinationRoot, finalPath))) {
    return { outcome: 'failed', error: { kind: 'unsafe_parents' } };
  }
  await mkdir(dirname(finalPath), { recursive: true });

  // Data must be durable before it can become visible (spec 18.5).
  await fsyncFile(stagedFilePath);

  let conflictPath: string | null = null;
  const existing = await statOrNull(finalPath);
  if (existing !== null) {
    const destinationSha256 = await sha256File(finalPath);

    if (destinationSha256 === stagedSha256) {
      // Identical content already at the destination (typically a re-paired or
      // reinstalled phone re-uploading an existing backup): adopt it in place —
      // no conflict copy, no replacement (spec 6.5).
      await removeStagedArtifacts(stagedFilePath);
      return {
        outcome: 'adopted_existing',
        finalPath,
        sha256: stagedSha256,
        size: expectedSize,
      };
    }

    const unchangedSinceLastCommit =
      request.lastCommitted !== null &&
      existing.size === request.lastCommitted.size &&
      destinationSha256 === request.lastCommitted.sha256;

    if (!unchangedSinceLastCommit) {
      // Externally modified: preserve before replacing, and only continue if
      // preservation succeeds (spec 6.5, 28.2).
      const preservedAt = conflictPathFor(
        destinationRoot,
        request.timestamp ?? new Date(),
        relativePath,
      );
      await mkdir(dirname(preservedAt), { recursive: true });
      await rename(finalPath, preservedAt);
      conflictPath = preservedAt;
    }
  }

  await crashHooks.beforeRename?.();

  const asidePath = join(stagingDirPath(destinationRoot), `replaced-${stagedSha256.slice(0, 16)}`);
  await renameOverwriting(stagedFilePath, finalPath, asidePath);

  await crashHooks.afterRename?.();

  await fsyncDir(dirname(finalPath));
  await removeStagedArtifacts(stagedFilePath);

  return {
    outcome: 'committed',
    finalPath,
    sha256: stagedSha256,
    size: expectedSize,
    conflictPath,
  };
}
