import { request as httpsRequest } from 'node:https';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  deviceResponseSchema,
  errorResponseSchema,
  healthResponseSchema,
  pairResponseSchema,
  prepareStatusResponseSchema,
  prepareUploadResponseSchema,
} from '@foldersync/contracts';
import { HEADER_PROTOCOL, HEADER_REQUEST_ID } from '@foldersync/protocol';
import { openDatabase, createRepositories, type Database } from '../src/main/db/index.ts';
import { createControlServer } from '../src/main/api/controlServer.ts';
import { createPairingWindow, type PairingWindow } from '../src/main/auth/pairingWindow.ts';
import { generateDesktopIdentity, type DesktopIdentity } from '../src/main/auth/identity.ts';
import { hashToken } from '../src/main/auth/token.ts';

// Integration proof for the control-server slice (spec 24, 25): a real TLS request
// against the pinned desktop identity, exercising the request-id / protocol /
// bearer-auth middleware and the health + device endpoints.

const TOKEN = 'tok_super_secret_value';
const CLOCK = '2026-07-25T12:00:00.000Z';
const A_UUID = '11111111-2222-4333-8444-555555555555';
const PHONE_UUID = '99999999-8888-4777-8666-555555555555';
const KNOWN_SECRET = 'A'.repeat(43); // valid base64Url32 secret shape

interface Response {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  json: () => unknown;
}

let db: Database;
let identity: DesktopIdentity;
let app: FastifyInstance;
let baseUrl: string;
let pairingWindow: PairingWindow;
// Mutable so a single test can simulate a nearly-full volume; reset each run.
let freeSpaceBytes: number;

// node:https verifies against the server's own self-signed cert supplied as `ca`,
// which proves the server presents the pinned identity (a wrong cert fails the
// handshake). Hostname is skipped because the cert CN is a device id, not an IP.
function call(
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: string,
): Promise<Response> {
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
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            json: () => JSON.parse(text) as unknown,
          });
        });
      },
    );
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

const authHeaders = (token = TOKEN): Record<string, string> => ({
  authorization: `Bearer ${token}`,
  [HEADER_PROTOCOL]: '1',
});

beforeEach(async () => {
  identity = await generateDesktopIdentity();
  db = openDatabase(':memory:');
  const repositories = createRepositories(db);
  repositories.devices.insert({
    phoneDeviceId: 'phone-1',
    phoneDisplayName: 'Pixel',
    tokenHash: hashToken(TOKEN),
    pairedAt: '2026-07-24T00:00:00.000Z',
  });

  pairingWindow = createPairingWindow({
    now: () => new Date(CLOCK),
    generateSecret: () => KNOWN_SECRET,
  });

  freeSpaceBytes = Number.MAX_SAFE_INTEGER;
  app = createControlServer({
    tls: { key: identity.privateKeyPem, cert: identity.certificatePem },
    identity: { deviceId: identity.deviceId, name: 'Karn-PC' },
    repositories,
    pairingWindow,
    freeSpace: () => Promise.resolve(freeSpaceBytes),
    now: () => new Date(CLOCK),
  });
  baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });
});

afterEach(async () => {
  await app.close();
  db.close();
});

describe('GET /v1/health', () => {
  it('is unauthenticated and reports protocol availability', async () => {
    const res = await call('GET', '/v1/health');
    expect(res.status).toBe(200);
    expect(healthResponseSchema.parse(res.json())).toEqual({ status: 'ok', protocolVersion: 1 });
  });

  it('always returns a request id header', async () => {
    const res = await call('GET', '/v1/health');
    expect(res.headers[HEADER_REQUEST_ID]).toBeDefined();
  });
});

describe('GET /v1/device', () => {
  it('returns the identity summary for an authenticated request', async () => {
    const res = await call('GET', '/v1/device', authHeaders());
    expect(res.status).toBe(200);
    expect(deviceResponseSchema.parse(res.json())).toEqual({
      deviceId: identity.deviceId,
      name: 'Karn-PC',
      protocolVersion: 1,
    });
  });

  it('records last-seen for the authenticated device', async () => {
    await call('GET', '/v1/device', authHeaders());
    const device = createRepositories(db).devices.getByDeviceId('phone-1');
    expect(device?.lastSeenAt).toBe(CLOCK);
  });

  it('rejects a missing bearer token with unauthorised', async () => {
    const res = await call('GET', '/v1/device', { [HEADER_PROTOCOL]: '1' });
    expect(res.status).toBe(401);
    expect(errorResponseSchema.parse(res.json()).error.code).toBe('unauthorised');
  });

  it('rejects an invalid token', async () => {
    const res = await call('GET', '/v1/device', authHeaders('wrong-token'));
    expect(res.status).toBe(401);
    expect(errorResponseSchema.parse(res.json()).error.code).toBe('unauthorised');
  });

  it('rejects a revoked device even with the right token', async () => {
    createRepositories(db).devices.revoke('phone-1', CLOCK);
    const res = await call('GET', '/v1/device', authHeaders());
    expect(res.status).toBe(401);
    expect(errorResponseSchema.parse(res.json()).error.code).toBe('unauthorised');
  });

  it('rejects an unsupported protocol version', async () => {
    const res = await call('GET', '/v1/device', {
      authorization: `Bearer ${TOKEN}`,
      [HEADER_PROTOCOL]: '2',
    });
    expect(res.status).toBe(400);
    expect(errorResponseSchema.parse(res.json()).error.code).toBe('protocol_version_unsupported');
  });

  it('rejects a request with no protocol version header', async () => {
    const res = await call('GET', '/v1/device', { authorization: `Bearer ${TOKEN}` });
    expect(res.status).toBe(400);
    expect(errorResponseSchema.parse(res.json()).error.code).toBe('protocol_version_unsupported');
  });
});

describe('request id propagation', () => {
  it('echoes a valid uuid request id in the header and error body', async () => {
    const res = await call('GET', '/v1/device', { [HEADER_REQUEST_ID]: A_UUID });
    expect(res.headers[HEADER_REQUEST_ID]).toBe(A_UUID);
    // unauthenticated (no token) → error envelope carries the same request id
    expect(errorResponseSchema.parse(res.json()).error.requestId).toBe(A_UUID);
  });
});

const JSON_HEADERS = { 'content-type': 'application/json' };

function pairBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    secret: KNOWN_SECRET,
    deviceId: PHONE_UUID,
    deviceName: 'Pixel 8',
    supportedProtocolVersions: [1],
    ...overrides,
  });
}

describe('POST /v1/pair', () => {
  it('pairs during an open window and issues a working token', async () => {
    pairingWindow.open();
    const res = await call('POST', '/v1/pair', JSON_HEADERS, pairBody());
    expect(res.status).toBe(200);

    const paired = pairResponseSchema.parse(res.json());
    expect(paired.desktopDeviceId).toBe(identity.deviceId);
    expect(paired.protocolVersion).toBe(1);

    // The device is persisted with a hashed token, not the plaintext.
    const repos = createRepositories(db);
    const device = repos.devices.getByDeviceId(PHONE_UUID);
    expect(device?.tokenHash).toBe(hashToken(paired.deviceToken));
    expect(device?.tokenHash).not.toBe(paired.deviceToken);

    // The freshly minted token authenticates a normal control request.
    const authed = await call('GET', '/v1/device', {
      authorization: `Bearer ${paired.deviceToken}`,
      [HEADER_PROTOCOL]: '1',
    });
    expect(authed.status).toBe(200);
  });

  it('rejects a wrong secret without pairing', async () => {
    pairingWindow.open();
    const res = await call('POST', '/v1/pair', JSON_HEADERS, pairBody({ secret: 'B'.repeat(43) }));
    expect(res.status).toBe(403);
    expect(errorResponseSchema.parse(res.json()).error.code).toBe('pairing_expired');
  });

  it('rejects pairing when no window is open', async () => {
    const res = await call('POST', '/v1/pair', JSON_HEADERS, pairBody());
    expect(res.status).toBe(403);
    expect(errorResponseSchema.parse(res.json()).error.code).toBe('pairing_expired');
  });

  it('is one-time: replaying the secret after a successful pair fails', async () => {
    pairingWindow.open();
    expect((await call('POST', '/v1/pair', JSON_HEADERS, pairBody())).status).toBe(200);
    const replay = await call('POST', '/v1/pair', JSON_HEADERS, pairBody());
    expect(replay.status).toBe(403);
    expect(errorResponseSchema.parse(replay.json()).error.code).toBe('pairing_expired');
  });

  it('rejects a phone with no mutually supported protocol without burning the window', async () => {
    pairingWindow.open();
    const res = await call(
      'POST',
      '/v1/pair',
      JSON_HEADERS,
      pairBody({ supportedProtocolVersions: [2] }),
    );
    expect(res.status).toBe(400);
    expect(errorResponseSchema.parse(res.json()).error.code).toBe('protocol_version_unsupported');
    // window survived — a valid attempt still succeeds
    expect((await call('POST', '/v1/pair', JSON_HEADERS, pairBody())).status).toBe(200);
  });

  it('rejects a malformed body with bad_request', async () => {
    pairingWindow.open();
    const res = await call(
      'POST',
      '/v1/pair',
      JSON_HEADERS,
      JSON.stringify({ secret: KNOWN_SECRET, deviceName: 'x', supportedProtocolVersions: [1] }),
    );
    expect(res.status).toBe(400);
    expect(errorResponseSchema.parse(res.json()).error.code).toBe('bad_request');
  });

  it('re-pairing the same device issues a new token and supersedes the old one', async () => {
    pairingWindow.open();
    const first = pairResponseSchema.parse(
      (await call('POST', '/v1/pair', JSON_HEADERS, pairBody())).json(),
    );
    pairingWindow.open();
    const second = pairResponseSchema.parse(
      (await call('POST', '/v1/pair', JSON_HEADERS, pairBody())).json(),
    );
    expect(second.deviceToken).not.toBe(first.deviceToken);

    // old token no longer authenticates; new one does
    const oldAuth = await call('GET', '/v1/device', {
      authorization: `Bearer ${first.deviceToken}`,
      [HEADER_PROTOCOL]: '1',
    });
    expect(oldAuth.status).toBe(401);
    const newAuth = await call('GET', '/v1/device', {
      authorization: `Bearer ${second.deviceToken}`,
      [HEADER_PROTOCOL]: '1',
    });
    expect(newAuth.status).toBe(200);
  });
});

const MAP1 = 'aaaaaaaa-1111-4111-8111-111111111111';
const MAP2 = 'bbbbbbbb-2222-4222-8222-222222222222';
const ROOT1 = 'cccccccc-3333-4333-8333-333333333333';
const REQ = 'eeeeeeee-5555-4555-8555-555555555555';

function registerHeaders(): Record<string, string> {
  return { ...authHeaders(), 'content-type': 'application/json' };
}

function registerBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    requestId: REQ,
    rootId: ROOT1,
    mappingId: MAP1,
    displayName: 'Camera',
    phoneRetentionPolicy: 'keep_on_phone',
    desktopDeletionPolicy: 'preserve_desktop_copy',
    ...overrides,
  });
}

function approveMapping(
  mappingId: string,
  destinationRoot: string,
  phoneDeviceId = 'phone-1',
): void {
  createRepositories(db).roots.create({
    mappingId,
    phoneDeviceId,
    destinationRoot,
    displayName: 'Destination',
    createdAt: CLOCK,
  });
}

describe('POST /v1/roots/register', () => {
  it('binds a phone root to a desktop-approved mapping', async () => {
    approveMapping(MAP1, '/backups/camera');
    const res = await call('POST', '/v1/roots/register', registerHeaders(), registerBody());
    expect(res.status).toBe(200);
    expect(res.json()).toEqual({ rootId: ROOT1, mappingId: MAP1, status: 'registered' });

    const bound = createRepositories(db).roots.getByPhoneRoot('phone-1', ROOT1);
    expect(bound?.mappingId).toBe(MAP1);
    expect(bound?.phoneRetentionPolicy).toBe('keep_on_phone');
    expect(bound?.desktopDeletionPolicy).toBe('preserve_desktop_copy');
  });

  it('rejects an unknown mapping with root_not_mapped', async () => {
    const res = await call('POST', '/v1/roots/register', registerHeaders(), registerBody());
    expect(res.status).toBe(404);
    expect(errorResponseSchema.parse(res.json()).error.code).toBe('root_not_mapped');
  });

  it("rejects another device's mapping as root_not_mapped", async () => {
    createRepositories(db).devices.insert({
      phoneDeviceId: 'phone-2',
      phoneDisplayName: 'Other',
      tokenHash: hashToken('other-token'),
      pairedAt: CLOCK,
    });
    approveMapping(MAP1, '/backups/other', 'phone-2');
    const res = await call('POST', '/v1/roots/register', registerHeaders(), registerBody());
    expect(res.status).toBe(404);
    expect(errorResponseSchema.parse(res.json()).error.code).toBe('root_not_mapped');
  });

  it('rejects a destination that nests with an existing mapping', async () => {
    approveMapping(MAP2, '/backups'); // ancestor of /backups/camera
    approveMapping(MAP1, '/backups/camera');
    const res = await call('POST', '/v1/roots/register', registerHeaders(), registerBody());
    expect(res.status).toBe(409);
    const body = errorResponseSchema.parse(res.json());
    expect(body.error.code).toBe('destination_overlap');
    expect(body.error.details?.conflictingMappingId).toBe(MAP2);
  });

  it('allows re-registering the same pair as a policy update', async () => {
    approveMapping(MAP1, '/backups/camera');
    await call('POST', '/v1/roots/register', registerHeaders(), registerBody());
    const res = await call(
      'POST',
      '/v1/roots/register',
      registerHeaders(),
      registerBody({ phoneRetentionPolicy: 'delete_after_verified_backup' }),
    );
    expect(res.status).toBe(200);
    expect(
      createRepositories(db).roots.getByPhoneRoot('phone-1', ROOT1)?.phoneRetentionPolicy,
    ).toBe('delete_after_verified_backup');
  });

  it('rejects re-pointing a phone root to a different mapping', async () => {
    approveMapping(MAP1, '/backups/one');
    approveMapping(MAP2, '/backups/two');
    await call('POST', '/v1/roots/register', registerHeaders(), registerBody());
    const res = await call(
      'POST',
      '/v1/roots/register',
      registerHeaders(),
      registerBody({ mappingId: MAP2 }),
    );
    expect(res.status).toBe(409);
    expect(errorResponseSchema.parse(res.json()).error.code).toBe('bad_request');
  });

  it('rejects a malformed registration body', async () => {
    const res = await call(
      'POST',
      '/v1/roots/register',
      registerHeaders(),
      JSON.stringify({ requestId: REQ, mappingId: MAP1 }),
    );
    expect(res.status).toBe(400);
    expect(errorResponseSchema.parse(res.json()).error.code).toBe('bad_request');
  });
});

const FILE_ENTRY = 'ffffffff-6666-4666-8666-666666666666';
const VERSION1 = 'dddddddd-7777-4777-8777-777777777777';
const REMOTE_FILE1 = '00000000-8888-4888-8888-888888888888';
const OTHER_UUID = '12121212-9999-4999-8999-999999999999';
const SHA = 'a'.repeat(64);

// A mapping already bound to a phone root (the register step is proven above); the
// prepare tests start from a device that can address ROOT1.
function bindMapping(
  mappingId: string,
  rootId: string,
  destinationRoot: string,
  phoneDeviceId = 'phone-1',
): void {
  createRepositories(db).roots.create({
    mappingId,
    phoneDeviceId,
    destinationRoot,
    displayName: 'Destination',
    createdAt: CLOCK,
    phoneRootId: rootId,
    phoneRetentionPolicy: 'keep_on_phone',
    desktopDeletionPolicy: 'preserve_desktop_copy',
  });
}

function prepareBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    requestId: REQ,
    rootId: ROOT1,
    fileEntryId: FILE_ENTRY,
    relativePath: 'Camera/IMG_0001.jpg',
    size: 1024,
    modifiedAtMs: 1784981000000,
    mimeType: 'image/jpeg',
    knownRemoteVersionId: null,
    ...overrides,
  });
}

// Seeds a committed file at Camera/IMG_0001.jpg with a single version (what the
// commit slice will write for real).
function seedCommittedFile(rootId = ROOT1, relativePath = 'Camera/IMG_0001.jpg'): void {
  const files = createRepositories(db).files;
  files.insertRemoteFile({
    id: REMOTE_FILE1,
    phoneDeviceId: 'phone-1',
    rootId,
    fileEntryId: FILE_ENTRY,
    relativePath,
    currentVersionId: VERSION1,
    sha256: SHA,
    size: 1024,
    destinationMtimeMs: 1784981000000,
    destinationIdentity: null,
    committedAt: CLOCK,
    state: 'committed',
  });
  files.insertRemoteVersion({
    versionId: VERSION1,
    remoteFileId: REMOTE_FILE1,
    sha256: SHA,
    size: 1024,
    originalRelativePath: relativePath,
    committedAt: CLOCK,
  });
}

describe('POST /v1/files/prepare', () => {
  it('reserves an upload for a new file', async () => {
    bindMapping(MAP1, ROOT1, '/backups/camera');
    const res = await call('POST', '/v1/files/prepare', registerHeaders(), prepareBody());
    expect(res.status).toBe(200);
    const body = prepareUploadResponseSchema.parse(res.json());
    expect(body.action).toBe('upload');
    if (body.action !== 'upload') throw new Error('expected upload');
    expect(body.tusEndpoint).toBe('/v1/uploads');

    const prepare = createRepositories(db).files.getPrepare(body.prepareId);
    expect(prepare?.state).toBe('prepared');
    expect(prepare?.relativePath).toBe('Camera/IMG_0001.jpg');
    expect(prepare?.expectedSize).toBe(1024);
  });

  it('is idempotent: a second prepare for the same path reuses the reservation', async () => {
    bindMapping(MAP1, ROOT1, '/backups/camera');
    const first = prepareUploadResponseSchema.parse(
      (await call('POST', '/v1/files/prepare', registerHeaders(), prepareBody())).json(),
    );
    const second = prepareUploadResponseSchema.parse(
      (await call('POST', '/v1/files/prepare', registerHeaders(), prepareBody())).json(),
    );
    if (first.action !== 'upload' || second.action !== 'upload') throw new Error('expected upload');
    expect(second.prepareId).toBe(first.prepareId);
  });

  it('skips when the phone already knows the current committed version', async () => {
    bindMapping(MAP1, ROOT1, '/backups/camera');
    seedCommittedFile();
    const res = await call(
      'POST',
      '/v1/files/prepare',
      registerHeaders(),
      prepareBody({ knownRemoteVersionId: VERSION1 }),
    );
    expect(res.status).toBe(200);
    const body = prepareUploadResponseSchema.parse(res.json());
    expect(body).toEqual({
      action: 'skip',
      remoteVersionId: VERSION1,
      sha256: SHA,
      size: 1024,
    });
  });

  it('still uploads when the phone knows nothing (re-paired phone; adopt-in-place at commit)', async () => {
    bindMapping(MAP1, ROOT1, '/backups/camera');
    seedCommittedFile();
    const res = await call(
      'POST',
      '/v1/files/prepare',
      registerHeaders(),
      prepareBody({ knownRemoteVersionId: null }),
    );
    expect(prepareUploadResponseSchema.parse(res.json()).action).toBe('upload');
  });

  it('rejects an unknown root with root_not_mapped', async () => {
    const res = await call('POST', '/v1/files/prepare', registerHeaders(), prepareBody());
    expect(res.status).toBe(404);
    expect(errorResponseSchema.parse(res.json()).error.code).toBe('root_not_mapped');
  });

  it("rejects another device's root as root_not_mapped", async () => {
    createRepositories(db).devices.insert({
      phoneDeviceId: 'phone-2',
      phoneDisplayName: 'Other',
      tokenHash: hashToken('other-token'),
      pairedAt: CLOCK,
    });
    bindMapping(MAP1, ROOT1, '/backups/other', 'phone-2');
    const res = await call('POST', '/v1/files/prepare', registerHeaders(), prepareBody());
    expect(res.status).toBe(404);
    expect(errorResponseSchema.parse(res.json()).error.code).toBe('root_not_mapped');
  });

  it('rejects a path addressing a managed directory with invalid_relative_path', async () => {
    bindMapping(MAP1, ROOT1, '/backups/camera');
    const res = await call(
      'POST',
      '/v1/files/prepare',
      registerHeaders(),
      prepareBody({ relativePath: '.foldersync-staging/x.jpg' }),
    );
    expect(res.status).toBe(400);
    const body = errorResponseSchema.parse(res.json());
    expect(body.error.code).toBe('invalid_relative_path');
    expect(body.error.details?.kind).toBe('reserved_managed_dir');
  });

  it('rejects a traversal path at the contract layer as bad_request', async () => {
    bindMapping(MAP1, ROOT1, '/backups/camera');
    const res = await call(
      'POST',
      '/v1/files/prepare',
      registerHeaders(),
      prepareBody({ relativePath: '../escape.jpg' }),
    );
    expect(res.status).toBe(400);
    expect(errorResponseSchema.parse(res.json()).error.code).toBe('bad_request');
  });

  it('rejects insufficient space before reserving', async () => {
    bindMapping(MAP1, ROOT1, '/backups/camera');
    freeSpaceBytes = 10;
    const res = await call('POST', '/v1/files/prepare', registerHeaders(), prepareBody());
    expect(res.status).toBe(507);
    expect(errorResponseSchema.parse(res.json()).error.code).toBe('insufficient_space');
  });
});

describe('GET /v1/files/prepare/:prepareId', () => {
  async function createPrepare(): Promise<string> {
    bindMapping(MAP1, ROOT1, '/backups/camera');
    const body = prepareUploadResponseSchema.parse(
      (await call('POST', '/v1/files/prepare', registerHeaders(), prepareBody())).json(),
    );
    if (body.action !== 'upload') throw new Error('expected upload');
    return body.prepareId;
  }

  it('reports the prepared state to the owning device', async () => {
    const prepareId = await createPrepare();
    const res = await call('GET', `/v1/files/prepare/${prepareId}`, authHeaders());
    expect(res.status).toBe(200);
    expect(prepareStatusResponseSchema.parse(res.json())).toEqual({
      prepareId,
      state: 'prepared',
      remoteVersionId: null,
      sha256: null,
      errorCode: null,
    });
  });

  it('reports expired once the seven-day lifetime has passed', async () => {
    bindMapping(MAP1, ROOT1, '/backups/camera');
    createRepositories(db).files.createPrepare({
      prepareId: OTHER_UUID,
      phoneDeviceId: 'phone-1',
      rootId: ROOT1,
      fileEntryId: FILE_ENTRY,
      relativePath: 'Camera/IMG_0001.jpg',
      expectedSize: 1024,
      createdAt: '2026-07-01T00:00:00.000Z',
      expiresAt: '2026-07-08T00:00:00.000Z', // before CLOCK
    });
    const res = await call('GET', `/v1/files/prepare/${OTHER_UUID}`, authHeaders());
    expect(prepareStatusResponseSchema.parse(res.json()).state).toBe('expired');
    // Persisted, not just computed on read.
    expect(createRepositories(db).files.getPrepare(OTHER_UUID)?.state).toBe('expired');
  });

  it('surfaces the committed version id and hash', async () => {
    bindMapping(MAP1, ROOT1, '/backups/camera');
    seedCommittedFile();
    createRepositories(db).files.createPrepare({
      prepareId: OTHER_UUID,
      phoneDeviceId: 'phone-1',
      rootId: ROOT1,
      fileEntryId: FILE_ENTRY,
      relativePath: 'Camera/IMG_0001.jpg',
      expectedSize: 1024,
      createdAt: CLOCK,
      expiresAt: '2026-08-01T00:00:00.000Z',
    });
    createRepositories(db).files.setPrepareState(OTHER_UUID, 'committed');
    const res = await call('GET', `/v1/files/prepare/${OTHER_UUID}`, authHeaders());
    const body = prepareStatusResponseSchema.parse(res.json());
    expect(body.state).toBe('committed');
    expect(body.remoteVersionId).toBe(VERSION1);
    expect(body.sha256).toBe(SHA);
  });

  it("hides another device's prepare as upload_not_found", async () => {
    createRepositories(db).devices.insert({
      phoneDeviceId: 'phone-2',
      phoneDisplayName: 'Other',
      tokenHash: hashToken('other-token'),
      pairedAt: CLOCK,
    });
    createRepositories(db).files.createPrepare({
      prepareId: OTHER_UUID,
      phoneDeviceId: 'phone-2',
      rootId: OTHER_UUID,
      fileEntryId: FILE_ENTRY,
      relativePath: 'Camera/IMG_0001.jpg',
      expectedSize: 1024,
      createdAt: CLOCK,
      expiresAt: '2026-08-01T00:00:00.000Z',
    });
    const res = await call('GET', `/v1/files/prepare/${OTHER_UUID}`, authHeaders());
    expect(res.status).toBe(404);
    expect(errorResponseSchema.parse(res.json()).error.code).toBe('upload_not_found');
  });

  it('rejects a malformed prepare id with bad_request', async () => {
    const res = await call('GET', '/v1/files/prepare/not-a-uuid', authHeaders());
    expect(res.status).toBe(400);
    expect(errorResponseSchema.parse(res.json()).error.code).toBe('bad_request');
  });
});
