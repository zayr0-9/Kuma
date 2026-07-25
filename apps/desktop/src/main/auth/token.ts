import { createHash } from 'node:crypto';

// Bearer tokens are stored only as a SHA-256 hash, never in plaintext (spec 24.5,
// 24.6). A presented token is hashed the same way for the auth lookup; because the
// compared value is already a hash, the indexed equality lookup in the DB leaks
// nothing exploitable about the token itself.
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
