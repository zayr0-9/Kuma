import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { commitStagedFile, type CommitRequest } from '../src/main/sync/commit.ts';
import { garbageCollectStaging } from '../src/main/sync/stagingGc.ts';
import {
  CONFLICTS_DIR,
  STAGING_DIR,
  isReservedRelativePath,
  layoutTimestamp,
} from '../src/main/storage/layout.ts';

const sha256 = (data: string): string => createHash('sha256').update(data).digest('hex');

let root: string;
let stagingDir: string;

async function stage(name: string, content: string): Promise<string> {
  const stagedPath = join(stagingDir, name);
  await writeFile(stagedPath, content);
  return stagedPath;
}

function requestFor(
  stagedFilePath: string,
  content: string,
  overrides: Partial<CommitRequest> = {},
): CommitRequest {
  return {
    destinationRoot: root,
    stagedFilePath,
    relativePath: 'Camera/IMG_0001.jpg',
    expectedSize: Buffer.byteLength(content),
    lastCommitted: null,
    timestamp: new Date('2026-07-25T12:00:00Z'),
    ...overrides,
  };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'fsync-commit-'));
  stagingDir = join(root, STAGING_DIR);
  await mkdir(stagingDir, { recursive: true });
});

describe('commitStagedFile', () => {
  it('commits a staged file atomically into a fresh destination', async () => {
    const staged = await stage('u1', 'photo-bytes');
    const result = await commitStagedFile(requestFor(staged, 'photo-bytes'));

    expect(result).toEqual({
      outcome: 'committed',
      finalPath: join(root, 'Camera', 'IMG_0001.jpg'),
      sha256: sha256('photo-bytes'),
      size: Buffer.byteLength('photo-bytes'),
      conflictPath: null,
    });
    await expect(readFile(join(root, 'Camera', 'IMG_0001.jpg'), 'utf8')).resolves.toBe(
      'photo-bytes',
    );
    await expect(readdir(stagingDir)).resolves.toEqual([]);
  });

  it('fails on size mismatch and leaves the destination untouched', async () => {
    const staged = await stage('u1', 'short');
    const result = await commitStagedFile(requestFor(staged, 'short', { expectedSize: 999 }));

    expect(result).toEqual({
      outcome: 'failed',
      error: { kind: 'size_mismatch', actualSize: 5 },
    });
    await expect(readdir(root)).resolves.toEqual([STAGING_DIR]);
  });

  it('fails on staged-hash mismatch (staging corruption between attempts)', async () => {
    const staged = await stage('u1', 'tampered');
    const result = await commitStagedFile(
      requestFor(staged, 'tampered', { expectedSha256: sha256('original') }),
    );

    expect(result).toEqual({
      outcome: 'failed',
      error: { kind: 'staged_hash_mismatch', actualSha256: sha256('tampered') },
    });
  });

  it('adopts an identical existing destination file in place (re-pair scenario)', async () => {
    await mkdir(join(root, 'Camera'), { recursive: true });
    await writeFile(join(root, 'Camera', 'IMG_0001.jpg'), 'same-bytes');
    const staged = await stage('u1', 'same-bytes');

    const result = await commitStagedFile(requestFor(staged, 'same-bytes'));

    expect(result).toEqual({
      outcome: 'adopted_existing',
      finalPath: join(root, 'Camera', 'IMG_0001.jpg'),
      sha256: sha256('same-bytes'),
      size: Buffer.byteLength('same-bytes'),
    });
    // no conflict copy, staged artifacts gone
    await expect(readdir(root)).resolves.not.toContain(CONFLICTS_DIR);
    await expect(readdir(stagingDir)).resolves.toEqual([]);
  });

  it('replaces the destination without a conflict copy when it matches the last commit', async () => {
    await mkdir(join(root, 'Camera'), { recursive: true });
    await writeFile(join(root, 'Camera', 'IMG_0001.jpg'), 'version-1');
    const staged = await stage('u1', 'version-2');

    const result = await commitStagedFile(
      requestFor(staged, 'version-2', {
        lastCommitted: { size: Buffer.byteLength('version-1'), sha256: sha256('version-1') },
      }),
    );

    expect(result.outcome).toBe('committed');
    if (result.outcome === 'committed') expect(result.conflictPath).toBeNull();
    await expect(readFile(join(root, 'Camera', 'IMG_0001.jpg'), 'utf8')).resolves.toBe('version-2');
    await expect(readdir(root)).resolves.not.toContain(CONFLICTS_DIR);
  });

  it('preserves an externally modified destination before committing', async () => {
    await mkdir(join(root, 'Camera'), { recursive: true });
    await writeFile(join(root, 'Camera', 'IMG_0001.jpg'), 'edited-on-desktop');
    const staged = await stage('u1', 'phone-version');
    const timestamp = new Date('2026-07-25T12:00:00Z');

    const result = await commitStagedFile(
      requestFor(staged, 'phone-version', {
        lastCommitted: { size: 9, sha256: sha256('version-0') },
        timestamp,
      }),
    );

    const expectedConflictPath = join(
      root,
      CONFLICTS_DIR,
      layoutTimestamp(timestamp),
      'Camera',
      'IMG_0001.jpg',
    );
    expect(result).toEqual({
      outcome: 'committed',
      finalPath: join(root, 'Camera', 'IMG_0001.jpg'),
      sha256: sha256('phone-version'),
      size: Buffer.byteLength('phone-version'),
      conflictPath: expectedConflictPath,
    });
    await expect(readFile(expectedConflictPath, 'utf8')).resolves.toBe('edited-on-desktop');
    await expect(readFile(join(root, 'Camera', 'IMG_0001.jpg'), 'utf8')).resolves.toBe(
      'phone-version',
    );
  });

  it('rejects traversal and reserved paths', async () => {
    const staged = await stage('u1', 'x');
    const traversal = await commitStagedFile(
      requestFor(staged, 'x', { relativePath: '../escape.jpg' }),
    );
    expect(traversal.outcome).toBe('failed');
    if (traversal.outcome === 'failed') expect(traversal.error.kind).toBe('invalid_path');

    const reserved = await commitStagedFile(
      requestFor(staged, 'x', { relativePath: '.foldersync-trash/gotcha.jpg' }),
    );
    expect(reserved).toEqual({ outcome: 'failed', error: { kind: 'reserved_path' } });
    expect(isReservedRelativePath('.foldersync-staging/x')).toBe(true);
    expect(isReservedRelativePath('normal/.foldersync-staging')).toBe(false);
  });

  describe('crash recovery (deterministic, never a partial file)', () => {
    it('crash before rename: destination untouched, staged intact, re-run converges', async () => {
      const staged = await stage('u1', 'payload');
      const request = requestFor(staged, 'payload');

      await expect(
        commitStagedFile(request, {
          beforeRename: () => {
            throw new Error('simulated crash before rename');
          },
        }),
      ).rejects.toThrow('simulated crash');

      // parent directories may exist (created pre-rename) but hold no file —
      // the invariant is "never a partial destination file", staged still whole
      await expect(readdir(join(root, 'Camera'))).resolves.toEqual([]);
      await expect(readFile(staged, 'utf8')).resolves.toBe('payload');

      // recovery = simply run the commit again
      const retry = await commitStagedFile(request);
      expect(retry.outcome).toBe('committed');
      await expect(readFile(join(root, 'Camera', 'IMG_0001.jpg'), 'utf8')).resolves.toBe('payload');
    });

    it('crash after rename: destination is complete, re-run reports already_committed', async () => {
      const staged = await stage('u1', 'payload');
      const request = requestFor(staged, 'payload', { expectedSha256: sha256('payload') });

      await expect(
        commitStagedFile(request, {
          afterRename: () => {
            throw new Error('simulated crash after rename');
          },
        }),
      ).rejects.toThrow('simulated crash');

      // the rename happened: destination holds the full file, never a partial one
      await expect(readFile(join(root, 'Camera', 'IMG_0001.jpg'), 'utf8')).resolves.toBe('payload');

      const retry = await commitStagedFile(request);
      expect(retry).toEqual({
        outcome: 'already_committed',
        finalPath: join(root, 'Camera', 'IMG_0001.jpg'),
        sha256: sha256('payload'),
      });
    });

    it('staged missing with no recorded hash fails explicitly', async () => {
      const result = await commitStagedFile(requestFor(join(stagingDir, 'gone'), 'x'));
      expect(result).toEqual({ outcome: 'failed', error: { kind: 'staged_missing' } });
    });
  });
});

describe('garbageCollectStaging', () => {
  it('removes orphans and keeps active uploads with their sidecars', async () => {
    await writeFile(join(stagingDir, 'active-upload'), 'a');
    await writeFile(join(stagingDir, 'active-upload.json'), '{}');
    await writeFile(join(stagingDir, 'orphan'), 'b');
    await writeFile(join(stagingDir, 'orphan.json'), '{}');

    const removed = await garbageCollectStaging(root, new Set(['active-upload']));

    expect(removed.sort()).toEqual(['orphan', 'orphan.json']);
    await expect(readdir(stagingDir)).resolves.toEqual(
      expect.arrayContaining(['active-upload', 'active-upload.json']),
    );
  });

  it('is a no-op when the staging directory does not exist', async () => {
    const bare = await mkdtemp(join(tmpdir(), 'fsync-bare-'));
    await expect(garbageCollectStaging(bare, new Set())).resolves.toEqual([]);
  });
});
