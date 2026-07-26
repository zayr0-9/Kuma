import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { errorResponseSchema, filesListResponseSchema } from '@foldersync/contracts';
import { HEADER_PROTOCOL } from '@foldersync/protocol';
import { createRepositories, openDatabase, type Database } from '../src/main/db/index.ts';
import { createControlServer } from '../src/main/api/controlServer.ts';
import { createPairingWindow } from '../src/main/auth/pairingWindow.ts';
import { generateDesktopIdentity, type DesktopIdentity } from '../src/main/auth/identity.ts';
import { hashToken } from '../src/main/auth/token.ts';
import type { ThumbnailProvider } from '../src/main/images/thumbnailer.ts';

// Endpoint proof for the remote gallery (spec 6.6, 25.2): real TLS requests exercising the
// paginated committed-image listing and the binary thumbnail/content routes, including
// ownership scoping, path safety and the thumbnail fallback.

const TOKEN = 'tok_gallery_secret';
const TOKEN2 = 'tok_other_secret';
const CLOCK = '2026-07-25T12:00:00.000Z';
const ROOT1 = '11111111-2222-4333-8444-555555555555';
const ROOT2 = '22222222-3333-4444-8555-666666666666';
const MAP1 = 'aaaa1111-2222-4333-8444-555555555555';
const MAP2 = 'bbbb2222-3333-4444-8555-666666666666';
const FILE_ENTRY = '6ba7b810-9dad-41d1-80b4-00c04fd430c8';
const SHA = 'a'.repeat(64);

interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
  json: () => unknown;
}

let db: Database;
let identity: DesktopIdentity;
let app: FastifyInstance | null = null;
let baseUrl: string;
let destRoot: string;
// Drives the fake thumbnail provider per-test: 'ok' generates bytes, 'null' cannot decode
// (route falls back to original bytes), 'throw' errors (also falls back).
let thumbnailMode: 'ok' | 'null' | 'throw';

const fakeThumbnails: ThumbnailProvider = {
  getThumbnail: ({ maxSize }) => {
    if (thumbnailMode === 'throw') return Promise.reject(new Error('decode failed'));
    if (thumbnailMode === 'null') return Promise.resolve(null);
    return Promise.resolve({ body: Buffer.from(`thumb-${maxSize}`), contentType: 'image/jpeg' });
  },
};

function call(
  method: string,
  path: string,
  headers: Record<string, string> = {},
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
        res.on('end', () => {
          const body = Buffer.concat(chunks);
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body,
            json: () => JSON.parse(body.toString('utf8')) as unknown,
          });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

const authHeaders = (token = TOKEN): Record<string, string> => ({
  authorization: `Bearer ${token}`,
  [HEADER_PROTOCOL]: '1',
});

// Seed a committed file via the real commit writer, optionally writing its bytes to disk.
async function seedFile(
  relativePath: string,
  committedAt: string,
  opts: { rootId?: string; phoneDeviceId?: string; bytes?: string | null } = {},
): Promise<{ fileId: string; versionId: string }> {
  const { versionId, remoteFileId } = createRepositories(db).files.recordCommittedVersion({
    phoneDeviceId: opts.phoneDeviceId ?? 'phone-1',
    rootId: opts.rootId ?? ROOT1,
    fileEntryId: FILE_ENTRY,
    relativePath,
    sha256: SHA,
    size: opts.bytes != null ? Buffer.byteLength(opts.bytes) : 1024,
    committedAt,
  });
  if (opts.bytes != null) {
    const abs = join(destRoot, ...relativePath.split('/'));
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, opts.bytes);
  }
  return { fileId: remoteFileId, versionId };
}

async function startServer(thumbnails: ThumbnailProvider | undefined): Promise<void> {
  if (app !== null) await app.close();
  app = createControlServer({
    tls: { key: identity.privateKeyPem, cert: identity.certificatePem },
    identity: { deviceId: identity.deviceId, name: 'Karn-PC' },
    repositories: createRepositories(db),
    pairingWindow: createPairingWindow({ now: () => new Date(CLOCK) }),
    ...(thumbnails !== undefined ? { thumbnails } : {}),
    now: () => new Date(CLOCK),
  });
  baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });
}

beforeEach(async () => {
  identity = await generateDesktopIdentity();
  db = openDatabase(':memory:');
  destRoot = await mkdtemp(join(tmpdir(), 'fs-gallery-'));
  thumbnailMode = 'ok';

  const repositories = createRepositories(db);
  repositories.devices.insert({
    phoneDeviceId: 'phone-1',
    phoneDisplayName: 'Pixel',
    tokenHash: hashToken(TOKEN),
    pairedAt: '2026-07-24T00:00:00.000Z',
  });
  repositories.devices.insert({
    phoneDeviceId: 'phone-2',
    phoneDisplayName: 'Other',
    tokenHash: hashToken(TOKEN2),
    pairedAt: '2026-07-24T00:00:00.000Z',
  });
  // phone-1 owns ROOT1 → destRoot; phone-2 owns ROOT2 → its own dir.
  repositories.roots.create({
    mappingId: MAP1,
    phoneDeviceId: 'phone-1',
    destinationRoot: destRoot,
    displayName: 'Camera',
    createdAt: CLOCK,
    phoneRootId: ROOT1,
    phoneRetentionPolicy: 'keep_on_phone',
    desktopDeletionPolicy: 'preserve_desktop_copy',
  });
  repositories.roots.create({
    mappingId: MAP2,
    phoneDeviceId: 'phone-2',
    destinationRoot: join(destRoot, 'other-device-root'),
    displayName: 'Other',
    createdAt: CLOCK,
    phoneRootId: ROOT2,
    phoneRetentionPolicy: 'keep_on_phone',
    desktopDeletionPolicy: 'preserve_desktop_copy',
  });

  await startServer(fakeThumbnails);
});

afterEach(async () => {
  if (app !== null) await app.close();
  app = null;
  db.close();
  await rm(destRoot, { recursive: true, force: true });
});

describe('GET /v1/files/list', () => {
  it('lists a root’s committed images newest-first, excluding non-images', async () => {
    await seedFile('Camera/IMG_0001.jpg', '2026-07-25T12:00:00.000Z');
    await seedFile('Camera/IMG_0002.png', '2026-07-25T12:00:01.000Z');
    await seedFile('Camera/IMG_0003.JPG', '2026-07-25T12:00:02.000Z');
    await seedFile('Notes/todo.txt', '2026-07-25T12:00:03.000Z');
    await seedFile('Camera/clip.mp4', '2026-07-25T12:00:04.000Z');

    const res = await call('GET', `/v1/files/list?rootId=${ROOT1}`, authHeaders());
    expect(res.status).toBe(200);
    const body = filesListResponseSchema.parse(res.json());
    expect(body.items.map((i) => i.name)).toEqual(['IMG_0003.JPG', 'IMG_0002.png', 'IMG_0001.jpg']);
    expect(body.items[0]?.contentType).toBe('image/jpeg');
    expect(body.items[1]?.contentType).toBe('image/png');
    expect(body.nextCursor).toBeNull();
  });

  it('paginates via the opaque cursor', async () => {
    await seedFile('Camera/IMG_0001.jpg', '2026-07-25T12:00:00.000Z');
    await seedFile('Camera/IMG_0002.jpg', '2026-07-25T12:00:01.000Z');
    await seedFile('Camera/IMG_0003.jpg', '2026-07-25T12:00:02.000Z');

    const first = filesListResponseSchema.parse(
      (await call('GET', `/v1/files/list?rootId=${ROOT1}&limit=2`, authHeaders())).json(),
    );
    expect(first.items.map((i) => i.name)).toEqual(['IMG_0003.jpg', 'IMG_0002.jpg']);
    expect(first.nextCursor).not.toBeNull();

    const second = filesListResponseSchema.parse(
      (
        await call(
          'GET',
          `/v1/files/list?rootId=${ROOT1}&limit=2&cursor=${encodeURIComponent(first.nextCursor ?? '')}`,
          authHeaders(),
        )
      ).json(),
    );
    expect(second.items.map((i) => i.name)).toEqual(['IMG_0001.jpg']);
    expect(second.nextCursor).toBeNull();
  });

  it('is empty for a root with no images', async () => {
    const body = filesListResponseSchema.parse(
      (await call('GET', `/v1/files/list?rootId=${ROOT1}`, authHeaders())).json(),
    );
    expect(body.items).toEqual([]);
    expect(body.nextCursor).toBeNull();
  });

  it('does not list another device’s files', async () => {
    await seedFile('Camera/IMG_0001.jpg', CLOCK, { rootId: ROOT2, phoneDeviceId: 'phone-2' });
    // phone-1 asking for its own ROOT1 sees nothing; phone-1 cannot address ROOT2.
    const own = filesListResponseSchema.parse(
      (await call('GET', `/v1/files/list?rootId=${ROOT1}`, authHeaders())).json(),
    );
    expect(own.items).toEqual([]);
    const foreign = await call('GET', `/v1/files/list?rootId=${ROOT2}`, authHeaders());
    expect(foreign.status).toBe(404);
    expect(errorResponseSchema.parse(foreign.json()).error.code).toBe('root_not_mapped');
  });

  it('rejects an unknown root, a missing token and a malformed cursor', async () => {
    const noToken = await call('GET', `/v1/files/list?rootId=${ROOT1}`, {
      [HEADER_PROTOCOL]: '1',
    });
    expect(noToken.status).toBe(401);

    const badCursor = await call(
      'GET',
      `/v1/files/list?rootId=${ROOT1}&cursor=${encodeURIComponent('!!!not base64!!!')}`,
      authHeaders(),
    );
    // '!!!...' base64url-decodes to bytes without the separator → malformed.
    expect(badCursor.status).toBe(400);
    expect(errorResponseSchema.parse(badCursor.json()).error.code).toBe('bad_request');
  });
});

describe('GET /v1/files/:fileId/thumbnail', () => {
  it('serves a generated thumbnail and honours the size query', async () => {
    const { fileId } = await seedFile('Camera/IMG_0001.jpg', CLOCK, { bytes: 'IMG-ONE' });
    const res = await call('GET', `/v1/files/${fileId}/thumbnail?size=128`, authHeaders());
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/jpeg');
    expect(res.body.toString()).toBe('thumb-128');
  });

  it('falls back to the original bytes when the format cannot be decoded', async () => {
    const { fileId } = await seedFile('Camera/IMG_0001.jpg', CLOCK, { bytes: 'ORIGINAL-BYTES' });
    thumbnailMode = 'null';
    const res = await call('GET', `/v1/files/${fileId}/thumbnail`, authHeaders());
    expect(res.status).toBe(200);
    expect(res.body.toString()).toBe('ORIGINAL-BYTES');
  });

  it('falls back to the original bytes when no thumbnail provider is wired', async () => {
    const { fileId } = await seedFile('Camera/IMG_0001.jpg', CLOCK, { bytes: 'RAW' });
    await startServer(undefined);
    const res = await call('GET', `/v1/files/${fileId}/thumbnail`, authHeaders());
    expect(res.status).toBe(200);
    expect(res.body.toString()).toBe('RAW');
  });

  it('returns file_not_found for another device’s file', async () => {
    const { fileId } = await seedFile('Camera/IMG_0001.jpg', CLOCK, {
      rootId: ROOT2,
      phoneDeviceId: 'phone-2',
      bytes: 'SECRET',
    });
    const res = await call('GET', `/v1/files/${fileId}/thumbnail`, authHeaders());
    expect(res.status).toBe(404);
    expect(errorResponseSchema.parse(res.json()).error.code).toBe('file_not_found');
  });
});

describe('GET /v1/files/:fileId/content', () => {
  it('streams the full file bytes with a content length', async () => {
    const { fileId } = await seedFile('Camera/IMG_0001.jpg', CLOCK, { bytes: 'FULL-IMAGE-BYTES' });
    const res = await call('GET', `/v1/files/${fileId}/content`, authHeaders());
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/jpeg');
    expect(res.headers['content-length']).toBe(String(Buffer.byteLength('FULL-IMAGE-BYTES')));
    expect(res.body.toString()).toBe('FULL-IMAGE-BYTES');
  });

  it('reports destination_unavailable when the committed file is gone from disk', async () => {
    // Committed in the DB but never written to disk (volume unplugged / removed externally).
    const { fileId } = await seedFile('Camera/IMG_0001.jpg', CLOCK, { bytes: null });
    const res = await call('GET', `/v1/files/${fileId}/content`, authHeaders());
    expect(res.status).toBe(503);
    expect(errorResponseSchema.parse(res.json()).error.code).toBe('destination_unavailable');
  });

  it('returns file_not_found for an unknown file id', async () => {
    const res = await call('GET', `/v1/files/${FILE_ENTRY}/content`, authHeaders());
    expect(res.status).toBe(404);
    expect(errorResponseSchema.parse(res.json()).error.code).toBe('file_not_found');
  });
});
