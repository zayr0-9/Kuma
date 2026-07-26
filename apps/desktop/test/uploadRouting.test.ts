import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { errorResponseSchema } from '@foldersync/contracts';
import { HEADER_PROTOCOL } from '@foldersync/protocol';
import { createRepositories, openDatabase, type Database } from '../src/main/db/index.ts';
import { createControlServer } from '../src/main/api/controlServer.ts';
import { parseTusMetadata } from '../src/main/api/uploadRouting.ts';
import { createPairingWindow, type PairingWindow } from '../src/main/auth/pairingWindow.ts';
import { generateDesktopIdentity, type DesktopIdentity } from '../src/main/auth/identity.ts';
import { hashToken } from '../src/main/auth/token.ts';
import { commitStagedFile } from '../src/main/sync/commit.ts';
import { STAGING_DIR } from '../src/main/storage/layout.ts';

// The tus transport folded into the authenticated control server (spec 18.4/18.5):
// a real resumable upload over TLS lands in the correct per-destination staging
// directory, keyed by prepare id, and only for the prepare's owning device.

const TOKEN = 'tok_upload_secret';
const CLOCK = '2026-07-25T12:00:00.000Z';
const FUTURE = '2026-08-01T00:00:00.000Z';
const PAST = '2026-07-01T00:00:00.000Z';
const ROOT_ID = 'cccccccc-3333-4333-8333-333333333333';
const MAPPING_ID = 'aaaaaaaa-1111-4111-8111-111111111111';
const PREPARE_ID = 'ffffffff-6666-4666-8666-666666666666';
const FILE_ENTRY = '11111111-2222-4333-8444-555555555555';
const REL_PATH = 'Camera/VID_0001.mp4';
const TUS = { 'tus-resumable': '1.0.0' };

interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

let db: Database;
let identity: DesktopIdentity;
let app: FastifyInstance;
let baseUrl: string;
let destinationRoot: string;
let pairingWindow: PairingWindow;

function tusCall(
  method: string,
  path: string,
  headers: Record<string, string> = {},
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
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
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

function uploadMetadata(prepareId: string): string {
  return `prepareId ${Buffer.from(prepareId).toString('base64')}`;
}

function errorCode(res: RawResponse): string {
  return errorResponseSchema.parse(JSON.parse(res.body.toString('utf8'))).error.code;
}

function seedPrepare(
  overrides: { prepareId?: string; phoneDeviceId?: string; expiresAt?: string; size?: number } = {},
): void {
  createRepositories(db).files.createPrepare({
    prepareId: overrides.prepareId ?? PREPARE_ID,
    phoneDeviceId: overrides.phoneDeviceId ?? 'phone-1',
    rootId: ROOT_ID,
    fileEntryId: FILE_ENTRY,
    relativePath: REL_PATH,
    expectedSize: overrides.size ?? 0,
    createdAt: CLOCK,
    expiresAt: overrides.expiresAt ?? FUTURE,
  });
}

beforeEach(async () => {
  identity = await generateDesktopIdentity();
  db = openDatabase(':memory:');
  destinationRoot = await mkdtemp(join(tmpdir(), 'fsync-upl-'));
  const repositories = createRepositories(db);
  repositories.devices.insert({
    phoneDeviceId: 'phone-1',
    phoneDisplayName: 'Pixel',
    tokenHash: hashToken(TOKEN),
    pairedAt: CLOCK,
  });
  repositories.roots.create({
    mappingId: MAPPING_ID,
    phoneDeviceId: 'phone-1',
    destinationRoot,
    displayName: 'Camera',
    createdAt: CLOCK,
    phoneRootId: ROOT_ID,
    phoneRetentionPolicy: 'keep_on_phone',
    desktopDeletionPolicy: 'preserve_desktop_copy',
  });

  pairingWindow = createPairingWindow({
    now: () => new Date(CLOCK),
    generateSecret: () => 'A'.repeat(43),
  });
  app = createControlServer({
    tls: { key: identity.privateKeyPem, cert: identity.certificatePem },
    identity: { deviceId: identity.deviceId, name: 'Karn-PC' },
    repositories,
    pairingWindow,
    freeSpace: () => Promise.resolve(Number.MAX_SAFE_INTEGER),
    now: () => new Date(CLOCK),
  });
  baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });
});

afterEach(async () => {
  await app.close();
  db.close();
  await rm(destinationRoot, { recursive: true, force: true });
});

describe('tus upload transport (folded into the control server)', () => {
  it('accepts an authenticated resumable upload into per-destination staging and commits it', async () => {
    const payload = Buffer.from('x'.repeat(64 * 1024) + 'end-of-file');
    seedPrepare({ size: payload.length });

    const create = await tusCall(
      'POST',
      '/v1/uploads',
      authTus({
        'upload-length': String(payload.length),
        'upload-metadata': uploadMetadata(PREPARE_ID),
      }),
    );
    expect(create.status).toBe(201);
    const location = create.headers.location;
    if (typeof location !== 'string') throw new Error('tus creation returned no location');
    // The Location must be relative so the phone resolves it against its https base — an
    // absolute http:// URL would send follow-up PATCH/HEAD as plaintext to the TLS-only port.
    expect(location.startsWith('/v1/uploads/')).toBe(true);
    const uploadPath = new URL(location, baseUrl).pathname;
    expect(uploadPath).toBe(`/v1/uploads/${PREPARE_ID}`);
    // creation flipped the prepare to uploading
    expect(createRepositories(db).files.getPrepare(PREPARE_ID)?.state).toBe('uploading');

    // first chunk, then "Wi-Fi drops"; the client rediscovers the offset via HEAD
    const half = Math.floor(payload.length / 2);
    const patch1 = await tusCall(
      'PATCH',
      uploadPath,
      authTus({ 'upload-offset': '0', 'content-type': 'application/offset+octet-stream' }),
      payload.subarray(0, half),
    );
    expect(patch1.status).toBe(204);

    const head = await tusCall('HEAD', uploadPath, authTus());
    expect(head.status).toBe(200);
    expect(Number(head.headers['upload-offset'])).toBe(half);

    const patch2 = await tusCall(
      'PATCH',
      uploadPath,
      authTus({ 'upload-offset': String(half), 'content-type': 'application/offset+octet-stream' }),
      payload.subarray(half),
    );
    expect(patch2.status).toBe(204);
    expect(Number(patch2.headers['upload-offset'])).toBe(payload.length);

    // the staged file lives in THIS destination's staging, named by prepare id
    const stagedFilePath = join(destinationRoot, STAGING_DIR, PREPARE_ID);
    await expect(readFile(stagedFilePath)).resolves.toEqual(payload);
    // completion flipped the prepare to uploaded
    expect(createRepositories(db).files.getPrepare(PREPARE_ID)?.state).toBe('uploaded');

    // and the staged bytes commit atomically into the destination
    const result = await commitStagedFile({
      destinationRoot,
      stagedFilePath,
      relativePath: REL_PATH,
      expectedSize: payload.length,
      lastCommitted: null,
    });
    const expectedSha = createHash('sha256').update(payload).digest('hex');
    expect(result).toEqual({
      outcome: 'committed',
      finalPath: join(destinationRoot, 'Camera', 'VID_0001.mp4'),
      sha256: expectedSha,
      size: payload.length,
      conflictPath: null,
    });
    await expect(readFile(join(destinationRoot, 'Camera', 'VID_0001.mp4'))).resolves.toEqual(
      payload,
    );
  });

  it('accepts a creation POST whose content-type has no parser (Android client sends one)', async () => {
    // Regression: tus-java-client's creation POST carries a content-type Fastify has no
    // parser for, which failed with 415 before the catch-all content-type parser (spec 18.4).
    seedPrepare({ size: 10 });
    const res = await tusCall(
      'POST',
      '/v1/uploads',
      authTus({
        'upload-length': '10',
        'upload-metadata': uploadMetadata(PREPARE_ID),
        'content-type': 'application/octet-stream',
      }),
    );
    expect(res.status).toBe(201);
  });

  it('rejects an unauthenticated upload creation', async () => {
    seedPrepare({ size: 10 });
    const res = await tusCall('POST', '/v1/uploads', {
      ...TUS,
      [HEADER_PROTOCOL]: '1',
      'upload-length': '10',
      'upload-metadata': uploadMetadata(PREPARE_ID),
    });
    expect(res.status).toBe(401);
    expect(errorCode(res)).toBe('unauthorised');
  });

  it("rejects another device's prepare as upload_not_found", async () => {
    createRepositories(db).devices.insert({
      phoneDeviceId: 'phone-2',
      phoneDisplayName: 'Other',
      tokenHash: hashToken('other-token'),
      pairedAt: CLOCK,
    });
    seedPrepare({ phoneDeviceId: 'phone-2', size: 10 });
    const res = await tusCall(
      'POST',
      '/v1/uploads',
      authTus({ 'upload-length': '10', 'upload-metadata': uploadMetadata(PREPARE_ID) }),
    );
    expect(res.status).toBe(404);
    expect(errorCode(res)).toBe('upload_not_found');
  });

  it('rejects an expired prepare as upload_expired', async () => {
    seedPrepare({ size: 10, expiresAt: PAST });
    const res = await tusCall(
      'POST',
      '/v1/uploads',
      authTus({ 'upload-length': '10', 'upload-metadata': uploadMetadata(PREPARE_ID) }),
    );
    expect(res.status).toBe(410);
    expect(errorCode(res)).toBe('upload_expired');
  });

  it('rejects creation with a non-uuid prepare id as bad_request', async () => {
    const res = await tusCall(
      'POST',
      '/v1/uploads',
      authTus({ 'upload-length': '10', 'upload-metadata': uploadMetadata('not-a-uuid') }),
    );
    expect(res.status).toBe(400);
    expect(errorCode(res)).toBe('bad_request');
  });
});

describe('parseTusMetadata', () => {
  it('decodes base64 values of comma-separated key/value pairs', () => {
    const header = `prepareId ${Buffer.from('the-id').toString('base64')},filename ${Buffer.from('IMG.jpg').toString('base64')}`;
    expect(parseTusMetadata(header)).toEqual({ prepareId: 'the-id', filename: 'IMG.jpg' });
  });

  it('returns an empty object for an absent or empty header', () => {
    expect(parseTusMetadata(undefined)).toEqual({});
    expect(parseTusMetadata('')).toEqual({});
  });

  it('ignores valueless keys (tus allows them; we only read valued ones)', () => {
    expect(parseTusMetadata('is_confidential')).toEqual({});
  });
});
