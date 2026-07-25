import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  openDatabase,
  createRepositories,
  type Database,
  type Repositories,
} from '../src/main/db/index.ts';
import {
  createDeleteService,
  type ApplyDeletionInput,
  type DeleteService,
  type DeletionResult,
} from '../src/main/sync/deleteService.ts';

// The delete mechanics of spec 6.4/26.2 against a real destination directory: the
// version gate, the desktop deletion policy, the atomic trash move, and the
// idempotent record. Path safety and mapping ownership are the endpoint's job and
// are proven in controlServer.test.ts.

const CLOCK = '2026-07-25T12:00:00.000Z';
const TRASH_TS = '2026-07-25T120000Z';
const PHONE = 'phone-1';
const ROOT = 'cccccccc-3333-4333-8333-333333333333';
const FILE_ENTRY = 'ffffffff-6666-4666-8666-666666666666';
const REL = 'Camera/IMG_0001.jpg';
const EVENT = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const OTHER_VERSION = '00000000-0000-4000-8000-000000000000';
const SHA = 'a'.repeat(64);

let dir: string;
let db: Database;
let repositories: Repositories;
let service: DeleteService;

function seedCommitted(): string {
  const { versionId } = repositories.files.recordCommittedVersion({
    phoneDeviceId: PHONE,
    rootId: ROOT,
    fileEntryId: FILE_ENTRY,
    relativePath: REL,
    sha256: SHA,
    size: 5,
    committedAt: CLOCK,
  });
  return versionId;
}

async function writeDestFile(content = 'hello'): Promise<string> {
  const p = join(dir, ...REL.split('/'));
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, content);
  return p;
}

function apply(overrides: Partial<ApplyDeletionInput> = {}): Promise<DeletionResult> {
  return service.applyDeletion({
    eventId: EVENT,
    phoneDeviceId: PHONE,
    rootId: ROOT,
    destinationRoot: dir,
    relativePath: REL,
    expectedRemoteVersionId: OTHER_VERSION,
    desktopDeletionPolicy: 'mirror_user_deletions',
    ...overrides,
  });
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fsync-delete-'));
  db = openDatabase(':memory:');
  repositories = createRepositories(db);
  repositories.devices.insert({
    phoneDeviceId: PHONE,
    phoneDisplayName: 'Pixel',
    tokenHash: 'hash',
    pairedAt: CLOCK,
  });
  service = createDeleteService({ repositories, now: () => new Date(CLOCK) });
});

afterEach(async () => {
  db.close();
  await rm(dir, { recursive: true, force: true });
});

describe('applyDeletion', () => {
  it('moves the desktop copy to managed trash under mirror_user_deletions', async () => {
    const versionId = seedCommitted();
    const source = await writeDestFile('photo-bytes');

    const result = await apply({ expectedRemoteVersionId: versionId });
    expect(result).toEqual({
      outcome: 'applied',
      action: 'trashed',
      trashPath: `.foldersync-trash/${TRASH_TS}/Camera/IMG_0001.jpg`,
    });

    // The file left its original location and its bytes survive in trash.
    await expect(access(source)).rejects.toThrow();
    const trashed = join(dir, '.foldersync-trash', TRASH_TS, 'Camera', 'IMG_0001.jpg');
    expect(await readFile(trashed, 'utf8')).toBe('photo-bytes');

    // The committed truth and the deletion history agree.
    expect(repositories.files.getRemoteFile(PHONE, ROOT, REL)?.state).toBe('trashed');
    const event = repositories.files.getDeletionEvent(EVENT);
    expect(event?.appliedAction).toBe('trashed');
    expect(event?.trashPath).toBe(`.foldersync-trash/${TRASH_TS}/Camera/IMG_0001.jpg`);
  });

  it('preserves the desktop copy under preserve_desktop_copy', async () => {
    const versionId = seedCommitted();
    const source = await writeDestFile();

    const result = await apply({
      expectedRemoteVersionId: versionId,
      desktopDeletionPolicy: 'preserve_desktop_copy',
    });
    expect(result).toEqual({ outcome: 'applied', action: 'preserved', trashPath: null });

    // The file is untouched and the remote_file stays committed.
    await expect(access(source)).resolves.toBeUndefined();
    expect(repositories.files.getRemoteFile(PHONE, ROOT, REL)?.state).toBe('committed');
    expect(repositories.files.getDeletionEvent(EVENT)?.appliedAction).toBe('preserved');
  });

  it('never trashes when the policy is unknown (null)', async () => {
    const versionId = seedCommitted();
    const source = await writeDestFile();
    const result = await apply({ expectedRemoteVersionId: versionId, desktopDeletionPolicy: null });
    expect(result.outcome === 'applied' && result.action).toBe('preserved');
    await expect(access(source)).resolves.toBeUndefined();
  });

  it('reports no_remote_file when nothing is committed at the path', async () => {
    const result = await apply();
    expect(result).toEqual({ outcome: 'applied', action: 'no_remote_file', trashPath: null });
    expect(repositories.files.getDeletionEvent(EVENT)?.appliedAction).toBe('no_remote_file');
  });

  it('refuses with version_conflict when the expected version is not current', async () => {
    seedCommitted(); // current version differs from OTHER_VERSION
    const source = await writeDestFile();

    const result = await apply({ expectedRemoteVersionId: OTHER_VERSION });
    expect(result).toEqual({ outcome: 'version_conflict' });

    // Nothing was moved or recorded — the phone must re-sync and retry.
    await expect(access(source)).resolves.toBeUndefined();
    expect(repositories.files.getRemoteFile(PHONE, ROOT, REL)?.state).toBe('committed');
    expect(repositories.files.getDeletionEvent(EVENT)).toBeNull();
  });

  it('is idempotent: replaying an event id returns the recorded outcome without acting twice', async () => {
    const versionId = seedCommitted();
    await writeDestFile('once');
    const first = await apply({ expectedRemoteVersionId: versionId });
    expect(first.outcome).toBe('applied');

    // Recreate a file at the path to prove the replay does not move it again.
    await writeDestFile('resurrected');
    const replay = await apply({ expectedRemoteVersionId: versionId });
    expect(replay).toEqual({
      outcome: 'already_applied',
      trashPath: `.foldersync-trash/${TRASH_TS}/Camera/IMG_0001.jpg`,
    });
    const source = join(dir, ...REL.split('/'));
    expect(await readFile(source, 'utf8')).toBe('resurrected');
  });

  it('marks the file trashed even when the source is already gone (external race)', async () => {
    const versionId = seedCommitted(); // committed record exists, but no file on disk
    const result = await apply({ expectedRemoteVersionId: versionId });
    expect(result).toEqual({ outcome: 'applied', action: 'trashed', trashPath: null });
    expect(repositories.files.getRemoteFile(PHONE, ROOT, REL)?.state).toBe('trashed');
  });
});
