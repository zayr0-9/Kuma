import type { Database } from '../database.ts';
import { asRow, asText, asTextOrNull } from '../row.ts';
import type { DesktopIdentityRow } from '../types.ts';

// desktop_identity is a singleton (id = 1). The private key/certificate live as
// restricted files (see identityStore.ts); this table holds only the summary the
// control API needs — device id, display name, cert reference and SPKI pin.

function mapRow(raw: unknown): DesktopIdentityRow | null {
  const r = asRow(raw);
  if (r === null) return null;
  return {
    deviceId: asText(r.device_id),
    displayName: asText(r.display_name),
    certificateRef: asText(r.certificate_ref),
    publicKeyPin: asText(r.public_key_pin),
    createdAt: asText(r.created_at),
    rotatedAt: asTextOrNull(r.rotated_at),
  };
}

export interface DesktopIdentityInput {
  deviceId: string;
  displayName: string;
  certificateRef: string;
  publicKeyPin: string;
  createdAt: string;
  rotatedAt?: string | null;
}

export interface IdentityRepository {
  get(): DesktopIdentityRow | null;
  // Upserts the singleton. created_at is set only on first insert; a later call
  // (e.g. certificate rotation, spec 24.7) updates the other fields and rotated_at
  // without disturbing created_at.
  set(input: DesktopIdentityInput): void;
}

export function createIdentityRepository(db: Database): IdentityRepository {
  const getStmt = db.prepare('SELECT * FROM desktop_identity WHERE id = 1');
  const setStmt = db.prepare(`
    INSERT INTO desktop_identity
      (id, device_id, display_name, certificate_ref, public_key_pin, created_at, rotated_at)
    VALUES (1, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET
      device_id = excluded.device_id,
      display_name = excluded.display_name,
      certificate_ref = excluded.certificate_ref,
      public_key_pin = excluded.public_key_pin,
      rotated_at = excluded.rotated_at
  `);

  return {
    get: () => mapRow(getStmt.get()),
    set: (input) => {
      setStmt.run(
        input.deviceId,
        input.displayName,
        input.certificateRef,
        input.publicKeyPin,
        input.createdAt,
        input.rotatedAt ?? null,
      );
    },
  };
}
