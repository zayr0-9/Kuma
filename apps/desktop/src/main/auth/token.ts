import { createHash, randomBytes } from 'node:crypto';

// Bearer tokens are stored only as a SHA-256 hash, never in plaintext (spec 24.5,
// 24.6). A presented token is hashed the same way for the auth lookup; because the
// compared value is already a hash, the indexed equality lookup in the DB leaks
// nothing exploitable about the token itself.
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

// The long-lived device bearer token minted at pairing (spec 24.5): 256 bits of
// CSPRNG entropy, URL-safe. 32 bytes → 43 base64url chars, satisfying the
// pairResponse `deviceToken` minimum of 32.
export function generateBearerToken(): string {
  return randomBytes(32).toString('base64url');
}
