import type { DatabaseSync } from 'node:sqlite';
import { SCHEMA_V1 } from './schema.ts';

// Schema migrations keyed on SQLite's `user_version`. Each migration runs exactly
// once, in order, inside its own transaction; a failure rolls back that migration
// and leaves user_version untouched so a retry re-applies from the same point.
// Migrations are append-only — never edit a shipped one; add the next number.

export interface Migration {
  readonly version: number;
  readonly up: (db: DatabaseSync) => void;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    up: (db) => {
      db.exec(SCHEMA_V1);
    },
  },
];

function currentUserVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined;
  return row ? Number(row.user_version) : 0;
}

// Applies every migration newer than the database's current user_version and
// returns the resulting version. Safe to call on every startup — a fully migrated
// database is a no-op.
export function runMigrations(db: DatabaseSync): number {
  const applied = new Set(MIGRATIONS.map((m) => m.version));
  if (applied.size !== MIGRATIONS.length) {
    throw new Error('Duplicate migration version numbers');
  }

  let version = currentUserVersion(db);
  const pending = MIGRATIONS.filter((m) => m.version > version).sort(
    (a, b) => a.version - b.version,
  );

  for (const migration of pending) {
    db.exec('BEGIN');
    try {
      migration.up(db);
      // PRAGMA cannot be parameterised; the value is a trusted integer literal.
      db.exec(`PRAGMA user_version = ${migration.version}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    version = migration.version;
  }

  return version;
}

export const LATEST_SCHEMA_VERSION = MIGRATIONS.reduce((max, m) => Math.max(max, m.version), 0);
