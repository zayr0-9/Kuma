import type { Database } from '../database.ts';
import { asRow, asText, asTextOrNull } from '../row.ts';
import type { PairedDeviceRow } from '../types.ts';

// paired_device holds one row per paired phone (spec 24.5). Only the SHA-256 of
// the bearer token is stored. A revoked pairing keeps its row (revoked_at set) so
// history survives, but authenticated lookups must exclude it.

function mapRow(raw: unknown): PairedDeviceRow | null {
  const r = asRow(raw);
  if (r === null) return null;
  return {
    phoneDeviceId: asText(r.phone_device_id),
    phoneDisplayName: asText(r.phone_display_name),
    tokenHash: asText(r.token_hash),
    pairedAt: asText(r.paired_at),
    lastSeenAt: asTextOrNull(r.last_seen_at),
    revokedAt: asTextOrNull(r.revoked_at),
  };
}

export interface PairedDeviceInput {
  phoneDeviceId: string;
  phoneDisplayName: string;
  tokenHash: string;
  pairedAt: string;
}

export interface DevicesRepository {
  insert(input: PairedDeviceInput): void;
  getByDeviceId(phoneDeviceId: string): PairedDeviceRow | null;
  // Auth hot path (spec 24.6): resolves a presented token (already hashed by the
  // caller) to an active pairing. The compared value is a hash, not the secret,
  // so an indexed equality lookup leaks nothing exploitable; revoked rows are
  // excluded here rather than in the caller.
  findActiveByTokenHash(tokenHash: string): PairedDeviceRow | null;
  touchLastSeen(phoneDeviceId: string, at: string): void;
  revoke(phoneDeviceId: string, at: string): void;
}

export function createDevicesRepository(db: Database): DevicesRepository {
  const insertStmt = db.prepare(`
    INSERT INTO paired_device
      (phone_device_id, phone_display_name, token_hash, paired_at, last_seen_at, revoked_at)
    VALUES (?, ?, ?, ?, NULL, NULL)
  `);
  const byIdStmt = db.prepare('SELECT * FROM paired_device WHERE phone_device_id = ?');
  const byTokenStmt = db.prepare(
    'SELECT * FROM paired_device WHERE token_hash = ? AND revoked_at IS NULL',
  );
  const touchStmt = db.prepare(
    'UPDATE paired_device SET last_seen_at = ? WHERE phone_device_id = ?',
  );
  const revokeStmt = db.prepare(
    'UPDATE paired_device SET revoked_at = ? WHERE phone_device_id = ? AND revoked_at IS NULL',
  );

  return {
    insert: (input) => {
      insertStmt.run(input.phoneDeviceId, input.phoneDisplayName, input.tokenHash, input.pairedAt);
    },
    getByDeviceId: (phoneDeviceId) => mapRow(byIdStmt.get(phoneDeviceId)),
    findActiveByTokenHash: (tokenHash) => mapRow(byTokenStmt.get(tokenHash)),
    touchLastSeen: (phoneDeviceId, at) => {
      touchStmt.run(at, phoneDeviceId);
    },
    revoke: (phoneDeviceId, at) => {
      revokeStmt.run(at, phoneDeviceId);
    },
  };
}
