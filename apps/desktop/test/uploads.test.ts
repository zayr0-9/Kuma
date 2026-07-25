import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createUploadServer } from '../src/main/api/uploadServer.ts';
import { commitStagedFile } from '../src/main/sync/commit.ts';
import { STAGING_DIR } from '../src/main/storage/layout.ts';

// End-to-end proof for spike 6's integration requirement: a resumable tus upload
// over Fastify lands in staging, survives an interruption, and the staged bytes
// commit atomically into the destination.

const TUS_HEADERS = { 'Tus-Resumable': '1.0.0' };

let root: string;
let stagingDir: string;
let app: FastifyInstance;
let baseUrl: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'fsync-tus-'));
  stagingDir = join(root, STAGING_DIR);
  await mkdir(stagingDir, { recursive: true });
  app = createUploadServer(stagingDir);
  baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });
});

afterEach(async () => {
  await app.close();
});

async function createUpload(totalBytes: number): Promise<string> {
  const response = await fetch(`${baseUrl}/v1/uploads`, {
    method: 'POST',
    headers: { ...TUS_HEADERS, 'Upload-Length': String(totalBytes) },
  });
  expect(response.status).toBe(201);
  const location = response.headers.get('location');
  if (!location) throw new Error('tus creation returned no location');
  return new URL(location, baseUrl).toString();
}

async function patchBytes(uploadUrl: string, offset: number, bytes: Buffer): Promise<number> {
  const response = await fetch(uploadUrl, {
    method: 'PATCH',
    headers: {
      ...TUS_HEADERS,
      'Upload-Offset': String(offset),
      'Content-Type': 'application/offset+octet-stream',
    },
    body: new Uint8Array(bytes),
  });
  expect(response.status).toBe(204);
  return Number(response.headers.get('upload-offset'));
}

async function currentOffset(uploadUrl: string): Promise<number> {
  const response = await fetch(uploadUrl, { method: 'HEAD', headers: TUS_HEADERS });
  expect(response.status).toBe(200);
  return Number(response.headers.get('upload-offset'));
}

describe('tus over Fastify', () => {
  it('uploads in interrupted chunks, resumes via HEAD, and commits atomically', async () => {
    const payload = Buffer.from('x'.repeat(64 * 1024) + 'end-of-file');
    const uploadUrl = await createUpload(payload.length);

    // first chunk, then "Wi-Fi drops" — the client later rediscovers the offset
    const half = Math.floor(payload.length / 2);
    await patchBytes(uploadUrl, 0, payload.subarray(0, half));

    const resumeOffset = await currentOffset(uploadUrl);
    expect(resumeOffset).toBe(half);

    const finalOffset = await patchBytes(uploadUrl, resumeOffset, payload.subarray(half));
    expect(finalOffset).toBe(payload.length);

    // the staged upload is a plain file in staging, named by upload id
    const uploadId = new URL(uploadUrl).pathname.split('/').at(-1);
    if (!uploadId) throw new Error('no upload id in tus location');
    const stagedFilePath = join(stagingDir, uploadId);
    await expect(readFile(stagedFilePath)).resolves.toEqual(payload);

    const result = await commitStagedFile({
      destinationRoot: root,
      stagedFilePath,
      relativePath: 'Camera/VID_0001.mp4',
      expectedSize: payload.length,
      lastCommitted: null,
    });

    const expectedSha = createHash('sha256').update(payload).digest('hex');
    expect(result).toEqual({
      outcome: 'committed',
      finalPath: join(root, 'Camera', 'VID_0001.mp4'),
      sha256: expectedSha,
      size: payload.length,
      conflictPath: null,
    });
    await expect(readFile(join(root, 'Camera', 'VID_0001.mp4'))).resolves.toEqual(payload);
    // staged upload and its tus sidecar are gone
    await expect(readdir(stagingDir)).resolves.toEqual([]);
  });

  it('rejects a PATCH at the wrong offset (protocol conflict)', async () => {
    const payload = Buffer.from('abcdef');
    const uploadUrl = await createUpload(payload.length);
    await patchBytes(uploadUrl, 0, payload.subarray(0, 3));

    const response = await fetch(uploadUrl, {
      method: 'PATCH',
      headers: {
        ...TUS_HEADERS,
        'Upload-Offset': '0',
        'Content-Type': 'application/offset+octet-stream',
      },
      body: new Uint8Array(payload.subarray(0, 3)),
    });
    expect(response.status).toBe(409);
  });

  it('exposes upload metadata via HEAD before any bytes arrive', async () => {
    const uploadUrl = await createUpload(10);
    await expect(currentOffset(uploadUrl)).resolves.toBe(0);
  });
});
