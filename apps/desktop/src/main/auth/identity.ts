import 'reflect-metadata'; // @peculiar/x509's DI container requires the polyfill
import { createHash, randomUUID } from 'node:crypto';
import * as x509 from '@peculiar/x509';

// Desktop TLS identity (spec 24.2): stable device id, ECDSA P-256 key, long-lived
// self-signed certificate, and the SHA-256 SPKI pin that is the trust anchor for
// pairing. Identity is generated once and never regenerated on launch — that is
// the store's job to guarantee (identityStore.ts).

x509.cryptoProvider.set(crypto);

const TEN_YEARS_MS = 10 * 365 * 24 * 60 * 60 * 1000;

export interface DesktopIdentity {
  deviceId: string;
  certificatePem: string;
  privateKeyPem: string;
  // base64url SHA-256 of the SubjectPublicKeyInfo — the pin carried in the
  // pairing QR (matches contracts base64Url32Schema)
  spkiSha256: string;
}

export async function generateDesktopIdentity(
  deviceId: string = randomUUID(),
): Promise<DesktopIdentity> {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);

  const notBefore = new Date();
  const notAfter = new Date(notBefore.getTime() + TEN_YEARS_MS);
  const certificate = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: randomUUID().split('-').join(''),
    name: `CN=FolderSync ${deviceId}`,
    notBefore,
    notAfter,
    signingAlgorithm: { name: 'ECDSA', hash: 'SHA-256' },
    keys,
    extensions: [
      new x509.BasicConstraintsExtension(false, undefined, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature, true),
    ],
  });

  const spki = await crypto.subtle.exportKey('spki', keys.publicKey);
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', keys.privateKey);

  return {
    deviceId,
    certificatePem: certificate.toString('pem'),
    privateKeyPem: x509.PemConverter.encode(pkcs8, 'PRIVATE KEY'),
    spkiSha256: createHash('sha256').update(Buffer.from(spki)).digest('base64url'),
  };
}

// The pin is derivable from the certificate alone — this is what a client does
// with the certificate presented during the TLS handshake (spec 24.4).
export function spkiSha256FromCertificate(pemOrDer: string | Buffer): string {
  const source = typeof pemOrDer === 'string' ? pemOrDer : new Uint8Array(pemOrDer);
  const certificate = new x509.X509Certificate(source);
  return createHash('sha256')
    .update(Buffer.from(certificate.publicKey.rawData))
    .digest('base64url');
}
