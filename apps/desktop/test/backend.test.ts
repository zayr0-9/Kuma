import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { healthResponseSchema, uuidSchema } from '@foldersync/contracts';
import { openDatabase, resolveDatabasePath, createRepositories } from '../src/main/db/index.ts';
import { startBackend, type Backend } from '../src/main/backend.ts';

// The backend bootstrap started headlessly (no Electron) against a temp data
// directory: the database opens, the TLS identity persists with its summary row,
// the control server serves over TLS, and a restart reuses the same identity.

const CLOCK = '2026-07-25T12:00:00.000Z';

let userDataDir: string;
let backend: Backend | null;

async function start(): Promise<Backend> {
  return startBackend({
    userDataDir,
    displayName: 'Test-PC',
    host: '127.0.0.1',
    enableDiscovery: false,
    now: () => new Date(CLOCK),
  });
}

// GET /v1/health over TLS, pinning the server's own certificate (read from the
// identity file it just persisted) as the CA.
async function health(cert: string, url: string): Promise<{ status: number; body: unknown }> {
  const target = new URL('/v1/health', url);
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        method: 'GET',
        hostname: target.hostname,
        port: target.port,
        path: target.pathname,
        ca: cert,
        checkServerIdentity: () => undefined,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            body: JSON.parse(Buffer.concat(chunks).toString()),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

beforeEach(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), 'fsync-backend-'));
  backend = null;
});

afterEach(async () => {
  if (backend !== null) await backend.close();
  await rm(userDataDir, { recursive: true, force: true });
});

describe('startBackend', () => {
  it('opens the database, persists the identity, and serves health over TLS', async () => {
    backend = await start();

    expect(uuidSchema.safeParse(backend.deviceId).success).toBe(true);
    expect(backend.port).toBeGreaterThan(0);

    // the database file was created in the data directory
    await expect(access(resolveDatabasePath(userDataDir))).resolves.toBeUndefined();

    // the identity summary row was written (spec 21.1)
    const meta = JSON.parse(await readFile(join(userDataDir, 'identity.json'), 'utf8')) as {
      certificatePem: string;
    };
    const db = openDatabase(resolveDatabasePath(userDataDir));
    const identityRow = createRepositories(db).identity.get();
    db.close();
    expect(identityRow?.deviceId).toBe(backend.deviceId);
    expect(identityRow?.displayName).toBe('Test-PC');
    expect(identityRow?.publicKeyPin).toBe(backend.spkiSha256);

    // the control server serves over its pinned TLS identity
    const res = await health(meta.certificatePem, backend.url);
    expect(res.status).toBe(200);
    expect(healthResponseSchema.parse(res.body)).toEqual({ status: 'ok', protocolVersion: 1 });
  });

  it('reuses the same identity across a restart (never regenerated)', async () => {
    const first = await start();
    const firstDeviceId = first.deviceId;
    const firstPin = first.spkiSha256;
    await first.close();

    backend = await start();
    expect(backend.deviceId).toBe(firstDeviceId);
    expect(backend.spkiSha256).toBe(firstPin);
  });
});
