// Schema version 1 — the full desktop metadata model (spec 21.1). All eight
// tables are created together because they are one design unit; later structural
// changes arrive as new numbered migrations, never by editing this string.
//
// Conventions:
// - STRICT tables so column affinity is enforced, not coerced.
// - UUIDs and ISO-8601 UTC timestamps are TEXT; sizes and epoch-millis are INTEGER.
// - Enum-valued columns (policies, states, causes) are TEXT validated in the DAL
//   against the shared contract constants — SQLite CHECK lists would drift from
//   `@foldersync/contracts`, which is the single source of truth.
// - The primary database never lives inside a destination root (spec 22); it is
//   opened in the application data directory.

export const SCHEMA_V1 = `
-- Singleton desktop identity summary (spec 21.1). The private key and certificate
-- live as restricted files / safeStorage-wrapped blobs, never in the database;
-- certificate_ref points at that file. public_key_pin is the base64url SPKI hash.
CREATE TABLE desktop_identity (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  device_id       TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  certificate_ref TEXT NOT NULL,
  public_key_pin  TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  rotated_at      TEXT
) STRICT;

-- One row per paired phone (spec 21.1, 24.5). Only the SHA-256 of the bearer
-- token is stored — never the plaintext. A revoked_at makes the pairing inert
-- without deleting its history.
CREATE TABLE paired_device (
  phone_device_id     TEXT PRIMARY KEY,
  phone_display_name  TEXT NOT NULL,
  token_hash          TEXT NOT NULL,
  paired_at           TEXT NOT NULL,
  last_seen_at        TEXT,
  revoked_at          TEXT
) STRICT;

-- Token-hash lookup is on the hot auth path (spec 24.6); index it. The value is
-- a hash, so indexing leaks nothing a compromised DB would not already expose.
CREATE INDEX idx_paired_device_token_hash ON paired_device (token_hash);

-- Mapping between a phone root and a desktop destination (spec 21.1, 25.2). The
-- destination is chosen in the desktop UI (phone_root_id / policies null until the
-- phone binds via POST /v1/roots/register); the phone can never send an absolute
-- path. Overlap between destinations is rejected in endpoint code (spec 12.5).
CREATE TABLE root_mapping (
  mapping_id                TEXT PRIMARY KEY,
  phone_device_id           TEXT NOT NULL REFERENCES paired_device (phone_device_id) ON DELETE CASCADE,
  phone_root_id             TEXT,
  destination_root          TEXT NOT NULL,
  destination_relative_base TEXT NOT NULL DEFAULT '',
  phone_retention_policy    TEXT,
  desktop_deletion_policy   TEXT,
  display_name              TEXT NOT NULL,
  created_at                TEXT NOT NULL,
  updated_at                TEXT NOT NULL,
  UNIQUE (phone_device_id, phone_root_id)
) STRICT;

-- The committed truth for one backed-up file (spec 21.1). current_version_id points
-- at the winning remote_version. state carries the section 26.1 lifecycle marker.
CREATE TABLE remote_file (
  id                     TEXT PRIMARY KEY,
  phone_device_id        TEXT NOT NULL REFERENCES paired_device (phone_device_id) ON DELETE CASCADE,
  root_id                TEXT NOT NULL,
  file_entry_id          TEXT NOT NULL,
  relative_path          TEXT NOT NULL,
  current_version_id     TEXT,
  sha256                 TEXT,
  size                   INTEGER,
  destination_mtime_ms   INTEGER,
  destination_identity   TEXT,
  committed_at           TEXT,
  state                  TEXT NOT NULL,
  UNIQUE (phone_device_id, root_id, relative_path)
) STRICT;

-- In-flight upload reservation (spec 21.1, 22.3). Prepares default to a seven-day
-- lifetime so a multi-GB transfer can resume across days; staging GC reconciles
-- against this table. tus_upload_id links to the bytes handled by @tus/server.
CREATE TABLE upload_prepare (
  prepare_id       TEXT PRIMARY KEY,
  phone_device_id  TEXT NOT NULL REFERENCES paired_device (phone_device_id) ON DELETE CASCADE,
  root_id          TEXT NOT NULL,
  file_entry_id    TEXT NOT NULL,
  relative_path    TEXT NOT NULL,
  expected_size    INTEGER NOT NULL,
  state            TEXT NOT NULL,
  tus_upload_id    TEXT,
  tus_location     TEXT,
  error_code       TEXT,
  created_at       TEXT NOT NULL,
  expires_at       TEXT NOT NULL
) STRICT;

-- Immutable history of committed versions (spec 21.1). A superseded_at stamps the
-- moment a newer version won the same path; nothing here is ever mutated in place.
CREATE TABLE remote_version (
  version_id        TEXT PRIMARY KEY,
  remote_file_id    TEXT NOT NULL REFERENCES remote_file (id) ON DELETE CASCADE,
  sha256            TEXT NOT NULL,
  size              INTEGER NOT NULL,
  original_relative_path TEXT NOT NULL,
  committed_at      TEXT NOT NULL,
  superseded_at     TEXT
) STRICT;

-- Applied remote deletions, keyed by the client event ID for idempotency
-- (spec 21.1, 25.2). retention_cleanup is never a remote delete (spec 6.2); the
-- schema stores the applied action and the trash path where content now lives.
CREATE TABLE deletion_event (
  event_id            TEXT PRIMARY KEY,
  remote_file_id      TEXT REFERENCES remote_file (id) ON DELETE SET NULL,
  expected_version_id TEXT,
  relative_path       TEXT NOT NULL,
  applied_action      TEXT NOT NULL,
  trash_path          TEXT,
  applied_at          TEXT NOT NULL
) STRICT;

-- Redacted operational history for diagnostics (spec 21.1, 31.1). Never contains
-- tokens, pins or raw pairing secrets.
CREATE TABLE event_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  at          TEXT NOT NULL,
  level       TEXT NOT NULL,
  category    TEXT NOT NULL,
  message     TEXT NOT NULL,
  details     TEXT
) STRICT;

CREATE INDEX idx_event_log_at ON event_log (at);
`;
