import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { HEADER_PROTOCOL } from '@foldersync/protocol';
import {
  createRepositories,
  openDatabase,
  type Database,
  type Repositories,
} from '../src/main/db/index.ts';
import { createControlServer } from '../src/main/api/controlServer.ts';
import { createPairingWindow } from '../src/main/auth/pairingWindow.ts';
import { generateDesktopIdentity, type DesktopIdentity } from '../src/main/auth/identity.ts';
import { hashToken } from '../src/main/auth/token.ts';
import { createCommitService } from '../src/main/sync/commitService.ts';
import {
  createCommitCoordinator,
  type CommitCoordinator,
} from '../src/main/sync/commitCoordinator.ts';

// The whole vertical slice, end to end through the real TLS server: a prepared
// upload streams over tus, the finish hook hands it to the commit coordinator, and
// the bytes become visible at the destination with a durable version — the phone
// would observe `committed` by polling prepare status (spec 18.5).

const TOKEN = 'tok_commit_secret';
const CLOCK = '2026-07-25T12:00:00.000Z';
const ROOT_ID = 'cccccccc-3333-4333-8333-333333333333';
const PREPARE_ID = 'ffffffff-6666-4666-8666-666666666666';
const FILE_ENTRY = '11111111-2222-4333-8444-555555555555';
const REL_PATH = 'Camera/VID_0001.mp4';
const TUS = { 'tus-resumable': '1.0.0' };

let db: Database;
let repos: Repositories;
let identity: DesktopIdentity;
let app: FastifyInstance;
let baseUrl: string;
let destinationRoot: string;
let coordinator: CommitCoordinator;

interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
}

function tusCall(
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: Buffer,
): Promise<RawResponse> {
  const url = new URL(path, baseUrl);
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        method,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        headers,
        ca: identity.certificatePem,
        checkServerIdentity: () => undefined,
      },
      (res) => {
        res.on('data', () => {});
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers }));
      },
    );
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

const authTus = (extra: Record<string, string> = {}): Record<string, string> => ({
  authorization: `Bearer ${TOKEN}`,
  [HEADER_PROTOCOL]: '1',
  ...TUS,
  ...extra,
});

beforeEach(async () => {
  identity = await generateDesktopIdentity();
  db = openDatabase(':memory:');
  repos = createRepositories(db);
  destinationRoot = await mkdtemp(join(tmpdir(), 'fsync-cof-'));
  repos.devices.insert({
    phoneDeviceId: 'phone-1',
    phoneDisplayName: 'Pixel',
    tokenHash: hashToken(TOKEN),
    pairedAt: CLOCK,
  });
  repos.roots.create({
    mappingId: 'map-1',
    phoneDeviceId: 'phone-1',
    destinationRoot,
    displayName: 'Camera',
    createdAt: CLOCK,
    phoneRootId: ROOT_ID,
    phoneRetentionPolicy: 'keep_on_phone',
    desktopDeletionPolicy: 'preserve_desktop_copy',
  });
  repos.files.createPrepare({
    prepareId: PREPARE_ID,
    phoneDeviceId: 'phone-1',
    rootId: ROOT_ID,
    fileEntryId: FILE_ENTRY,
    relativePath: REL_PATH,
    expectedSize: 0, // set per-test before the upload
    createdAt: CLOCK,
    expiresAt: '2026-08-01T00:00:00.000Z',
  });

  const service = createCommitService({ repositories: repos, now: () => new Date(CLOCK) });
  coordinator = createCommitCoordinator({ repositories: repos, service });

  app = createControlServer({
    tls: { key: identity.privateKeyPem, cert: identity.certificatePem },
    identity: { deviceId: identity.deviceId, name: 'Karn-PC' },
    repositories: repos,
    pairingWindow: createPairingWindow({
      now: () => new Date(CLOCK),
      generateSecret: () => 'A'.repeat(43),
    }),
    freeSpace: () => Promise.resolve(Number.MAX_SAFE_INTEGER),
    commitCoordinator: coordinator,
    now: () => new Date(CLOCK),
  });
  baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });
});

afterEach(async () => {
  await app.close();
  db.close();
  await rm(destinationRoot, { recursive: true, force: true });
});

describe('commit on upload finish', () => {
  it('commits a finished upload and makes it visible with a durable version', async () => {
    const payload = Buffer.from('x'.repeat(4096) + 'tail');
    // reservation size must match the bytes for the commit size check
    db.prepare('UPDATE upload_prepare SET expected_size = ? WHERE prepare_id = ?').run(
      payload.length,
      PREPARE_ID,
    );

    const meta = `prepareId ${Buffer.from(PREPARE_ID).toString('base64')}`;
    const create = await tusCall(
      'POST',
      '/v1/uploads',
      authTus({ 'upload-length': String(payload.length), 'upload-metadata': meta }),
    );
    expect(create.status).toBe(201);

    const patch = await tusCall(
      'PATCH',
      `/v1/uploads/${PREPARE_ID}`,
      authTus({ 'upload-offset': '0', 'content-type': 'application/offset+octet-stream' }),
      payload,
    );
    expect(patch.status).toBe(204);

    // the finish hook scheduled the commit; wait for it to settle
    await coordinator.idle();

    // the prepare reached committed, the file is visible, and a version is durable
    const prepare = repos.files.getPrepare(PREPARE_ID);
    expect(prepare?.state).toBe('committed');
    await expect(readFile(join(destinationRoot, 'Camera', 'VID_0001.mp4'))).resolves.toEqual(
      payload,
    );
    const file = repos.files.getRemoteFile('phone-1', ROOT_ID, REL_PATH);
    expect(file?.state).toBe('committed');
    expect(file?.sha256).toBe(createHash('sha256').update(payload).digest('hex'));
    expect(file?.currentVersionId).not.toBeNull();
  });
});
