import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { runMigrations } from './migrations.ts';

// Connection management for the desktop metadata database (spec 21). node:sqlite
// is used because Electron 43 embeds Node 24 and it needs no native-addon rebuild
// (spec 21.2 spike — see ADR). This module never imports `electron`, so it runs
// unchanged under vitest; the main process supplies the path via
// `resolveDatabasePath(app.getPath('userData'))`.

export type Database = DatabaseSync;

const DATABASE_FILENAME = 'foldersync.db';

// The database lives in the application data directory, never inside a destination
// root (spec 22). Pure join so callers stay testable.
export function resolveDatabasePath(userDataDir: string): string {
  return join(userDataDir, DATABASE_FILENAME);
}

// Opens (or creates) the database, applies durability/safety pragmas, runs pending
// migrations, and returns the ready connection. Pass ':memory:' in tests.
export function openDatabase(path: string): Database {
  const db = new DatabaseSync(path);
  // WAL for crash-safe concurrent reads during a commit; NORMAL sync is durable
  // under WAL. foreign_keys must be enabled per-connection. busy_timeout absorbs
  // brief lock contention between the control API and background reconciliation.
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  runMigrations(db);
  return db;
}
