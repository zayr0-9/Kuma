import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { base64Url32Schema, uuidSchema } from '@foldersync/contracts';
import { generateDesktopIdentity, type DesktopIdentity } from './identity.ts';

// Persistence for the desktop identity (spec 24.2): generated on first use,
// never regenerated on launch. The private key sits in its own 0600 file;
// wrapping it with Electron safeStorage happens when this is wired into the
// main process (the store's file layout does not change for that).

const IDENTITY_FILE = 'identity.json';
const PRIVATE_KEY_FILE = 'device-key.pem';

// The certificate reference stored in the desktop_identity summary row (spec 21.1):
// the file the certificate PEM lives in, never the key.
export function identityCertificateRef(directory: string): string {
  return join(directory, IDENTITY_FILE);
}

const identityFileSchema = z.object({
  deviceId: uuidSchema,
  certificatePem: z.string().min(1),
  spkiSha256: base64Url32Schema,
});

function errnoCode(error: unknown): string | undefined {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return undefined;
}

export async function loadOrCreateIdentity(directory: string): Promise<DesktopIdentity> {
  try {
    const meta = identityFileSchema.parse(
      JSON.parse(await readFile(join(directory, IDENTITY_FILE), 'utf8')),
    );
    const privateKeyPem = await readFile(join(directory, PRIVATE_KEY_FILE), 'utf8');
    return { ...meta, privateKeyPem };
  } catch (error) {
    if (errnoCode(error) !== 'ENOENT') throw error;
  }

  const identity = await generateDesktopIdentity();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(join(directory, PRIVATE_KEY_FILE), identity.privateKeyPem, { mode: 0o600 });
  await writeFile(
    join(directory, IDENTITY_FILE),
    JSON.stringify(
      {
        deviceId: identity.deviceId,
        certificatePem: identity.certificatePem,
        spkiSha256: identity.spkiSha256,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  return identity;
}
