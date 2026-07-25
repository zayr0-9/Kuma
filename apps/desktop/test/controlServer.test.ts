import { request as httpsRequest } from 'node:https';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  deviceResponseSchema,
  errorResponseSchema,
  healthResponseSchema,
} from '@foldersync/contracts';
import { HEADER_PROTOCOL, HEADER_REQUEST_ID } from '@foldersync/protocol';
import { openDatabase, createRepositories, type Database } from '../src/main/db/index.ts';
import { createControlServer } from '../src/main/api/controlServer.ts';
import { generateDesktopIdentity, type DesktopIdentity } from '../src/main/auth/identity.ts';
import { hashToken } from '../src/main/auth/token.ts';

// Integration proof for the control-server slice (spec 24, 25): a real TLS request
// against the pinned desktop identity, exercising the request-id / protocol /
// bearer-auth middleware and the health + device endpoints.

const TOKEN = 'tok_super_secret_value';
const CLOCK = '2026-07-25T12:00:00.000Z';
const A_UUID = '11111111-2222-4333-8444-555555555555';

interface Response {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  json: () => unknown;
}

let db: Database;
let identity: DesktopIdentity;
let app: FastifyInstance;
let baseUrl: string;

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

  app = createControlServer({
    tls: { key: identity.privateKeyPem, cert: identity.certificatePem },
    identity: { deviceId: identity.deviceId, name: 'Karn-PC' },
    repositories,
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
