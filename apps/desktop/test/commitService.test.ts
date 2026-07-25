import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createRepositories,
  openDatabase,
  type Database,
  type Repositories,
} from '../src/main/db/index.ts';
import { createCommitService, type CommitService } from '../src/main/sync/commitService.ts';
import { STAGING_DIR } from '../src/main/storage/layout.ts';

// Commit service (spec 18.5): verify the staged upload, make it visible atomically,
// and persist the version — driving the prepare to its terminal state. commit.ts's
// own branches (crash recovery, conflict preservation) are proven in commit.test.ts;
// these tests exercise the service wiring: state transitions and version records.

const T0 = '2026-07-25T12:00:00.000Z';
const REL = 'Camera/IMG_0001.jpg';

let db: Database;
let repos: Repositories;
let service: CommitService;
let destinationRoot: string;

beforeEach(async () => {
  db = openDatabase(':memory:');
  repos = createRepositories(db);
  destinationRoot = await mkdtemp(join(tmpdir(), 'fsync-commit-'));
  repos.devices.insert({
    phoneDeviceId: 'dev-1',
    phoneDisplayName: 'Pixel',
    tokenHash: 'h',
    pairedAt: T0,
  });
  repos.roots.create({
    mappingId: 'map-1',
    phoneDeviceId: 'dev-1',
    destinationRoot,
    displayName: 'Camera',
    createdAt: T0,
    phoneRootId: 'root-1',
    phoneRetentionPolicy: 'keep_on_phone',
    desktopDeletionPolicy: 'preserve_desktop_copy',
  });
  service = createCommitService({ repositories: repos, now: () => new Date(T0) });
});

afterEach(async () => {
  db.close();
  await rm(destinationRoot, { recursive: true, force: true });
});

function seedPrepare(prepareId: string, size: number, relativePath = REL): void {
  repos.files.createPrepare({
    prepareId,
    phoneDeviceId: 'dev-1',
    rootId: 'root-1',
    fileEntryId: 'file-1',
    relativePath,
    expectedSize: size,
    createdAt: T0,
    expiresAt: '2026-08-01T00:00:00.000Z',
  });
}

async function stage(prepareId: string, content: Buffer): Promise<void> {
  const dir = join(destinationRoot, STAGING_DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, prepareId), content);
}

async function writeDest(relativePath: string, content: Buffer): Promise<void> {
  const abs = join(destinationRoot, ...relativePath.split('/'));
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content);
}

const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
const visible = (relativePath: string): Promise<Buffer> =>
  readFile(join(destinationRoot, ...relativePath.split('/')));

describe('commitService', () => {
  it('commits a fresh upload and records the version', async () => {
    const payload = Buffer.from('hello world');
    seedPrepare('prep-1', payload.length);
    await stage('prep-1', payload);

    const result = await service.commitPrepare('prep-1');
    expect(result.prepareState).toBe('committed');
    if (result.prepareState !== 'committed') throw new Error('expected committed');
    expect(result.commitOutcome).toBe('committed');

    await expect(visible(REL)).resolves.toEqual(payload);
    expect(repos.files.getPrepare('prep-1')?.state).toBe('committed');
    const file = repos.files.getRemoteFile('dev-1', 'root-1', REL);
    expect(file?.currentVersionId).toBe(result.versionId);
    expect(file?.sha256).toBe(sha(payload));
    expect(repos.files.getRemoteVersion(result.versionId)?.size).toBe(payload.length);
  });

  it('fails with source_changed when the staged size does not match the reservation', async () => {
    const payload = Buffer.from('longer than the reservation claimed');
    seedPrepare('prep-1', 5);
    await stage('prep-1', payload);

    const result = await service.commitPrepare('prep-1');
    expect(result).toEqual({ prepareState: 'failed', errorCode: 'source_changed' });
    expect(repos.files.getPrepare('prep-1')?.state).toBe('failed');
    expect(repos.files.getPrepare('prep-1')?.errorCode).toBe('source_changed');
    expect(repos.files.getRemoteFile('dev-1', 'root-1', REL)).toBeNull();
  });

  it('adopts an identical destination file in place', async () => {
    const payload = Buffer.from('identical bytes already at destination');
    await writeDest(REL, payload);
    seedPrepare('prep-1', payload.length);
    await stage('prep-1', payload);

    const result = await service.commitPrepare('prep-1');
    expect(result.prepareState).toBe('committed');
    if (result.prepareState !== 'committed') throw new Error('expected committed');
    expect(result.commitOutcome).toBe('adopted_existing');
    expect(repos.files.getRemoteFile('dev-1', 'root-1', REL)?.currentVersionId).toBe(
      result.versionId,
    );
    await expect(visible(REL)).resolves.toEqual(payload);
  });

  it('supersedes the prior version on a second commit for the same path', async () => {
    const first = Buffer.from('version one');
    seedPrepare('prep-1', first.length);
    await stage('prep-1', first);
    const r1 = await service.commitPrepare('prep-1');
    if (r1.prepareState !== 'committed') throw new Error('expected committed');

    const second = Buffer.from('version two, a bit longer');
    seedPrepare('prep-2', second.length);
    await stage('prep-2', second);
    const r2 = await service.commitPrepare('prep-2');
    if (r2.prepareState !== 'committed') throw new Error('expected committed');

    await expect(visible(REL)).resolves.toEqual(second);
    const file = repos.files.getRemoteFile('dev-1', 'root-1', REL);
    expect(file?.currentVersionId).toBe(r2.versionId);
    expect(repos.files.getRemoteVersion(r1.versionId)?.supersededAt).toBe(T0);
    expect(repos.files.getRemoteVersion(r2.versionId)?.supersededAt).toBeNull();
  });

  it('skips a prepare that is already terminal', async () => {
    seedPrepare('prep-1', 3);
    repos.files.setPrepareState('prep-1', 'committed');
    expect(await service.commitPrepare('prep-1')).toEqual({ prepareState: 'skipped' });
  });

  it('skips an unknown prepare', async () => {
    expect(await service.commitPrepare('nope')).toEqual({ prepareState: 'skipped' });
  });
});
