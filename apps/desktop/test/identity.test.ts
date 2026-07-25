import { mkdtemp, stat } from 'node:fs/promises';
import { createServer, type Server } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from 'node:tls';
import { afterEach, describe, expect, it } from 'vitest';
import { base64Url32Schema } from '@foldersync/contracts';
import { generateDesktopIdentity, spkiSha256FromCertificate } from '../src/main/auth/identity.ts';
import { loadOrCreateIdentity } from '../src/main/auth/identityStore.ts';

// Spike 4, desktop half: identity generation, pin stability, and the pin check a
// client performs against the certificate presented in a real TLS handshake —
// including rejecting an impersonator on the same address. The phone half (QR
// pairing, Android trust manager) needs the dev client.

let server: Server | null = null;

afterEach(() => {
  server?.close();
  server = null;
});

async function handshakePeerDer(port: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const socket = connect({ port, host: '127.0.0.1', rejectUnauthorized: false }, () => {
      const peer = socket.getPeerCertificate();
      socket.end();
      resolve(peer.raw);
    });
    socket.on('error', reject);
  });
}

describe('desktop TLS identity', () => {
  it('generates a wire-compatible pin that is derivable from the certificate alone', async () => {
    const identity = await generateDesktopIdentity();
    expect(base64Url32Schema.safeParse(identity.spkiSha256).success).toBe(true);
    expect(spkiSha256FromCertificate(identity.certificatePem)).toBe(identity.spkiSha256);
  });

  it('produces distinct pins for distinct identities', async () => {
    const [a, b] = await Promise.all([generateDesktopIdentity(), generateDesktopIdentity()]);
    expect(a.spkiSha256).not.toBe(b.spkiSha256);
  });

  it('a TLS client can verify — and refute — the pin from a live handshake', async () => {
    const identity = await generateDesktopIdentity();
    const impersonator = await generateDesktopIdentity();

    server = createServer({ cert: identity.certificatePem, key: identity.privateKeyPem });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('no server port');

    const presentedDer = await handshakePeerDer(address.port);
    const presentedPin = spkiSha256FromCertificate(presentedDer);

    // the phone's rule (spec 24.4): connect only if the presented key matches
    // the pinned one — anything else is a hard failure
    expect(presentedPin).toBe(identity.spkiSha256);
    expect(presentedPin).not.toBe(impersonator.spkiSha256);
  });

  it('store generates once and never regenerates (spec 24.2)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fsync-identity-'));
    const first = await loadOrCreateIdentity(dir);
    const second = await loadOrCreateIdentity(dir);

    expect(second).toEqual(first);

    const keyStat = await stat(join(dir, 'device-key.pem'));
    expect(keyStat.mode & 0o777).toBe(0o600);
  });
});
