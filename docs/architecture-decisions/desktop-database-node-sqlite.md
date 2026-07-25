# Desktop database — `node:sqlite`

**Date:** 2026-07-25
**Status:** ACCEPTED (dev runtime verified; packaged-app + Ubuntu/Windows verification outstanding)
**Spec reference:** section 21 (desktop database), section 21.2 (SQLite choice)

## Decision

Use the built-in `node:sqlite` module (`DatabaseSync`) as the desktop metadata
store, as spec 21.2 prefers. Electron 43 embeds Node 24.18.0, so this avoids the
native-addon rebuild burden of `better-sqlite3` and ships zero extra binary
dependencies.

## What was verified

- **API present without a flag in the production runtime.** `node:sqlite` loads
  and round-trips a create/insert/select inside Electron 43's embedded Node
  (`ELECTRON_RUN_AS_NODE=1 electron -e ...` → `24.18.0 / 43.2.0`), with **no**
  `--experimental-sqlite` flag required. It is also unflagged in the local Node
  (v26) that runs vitest, so the test suite exercises the real module, not a mock.
- **Migrations, pragmas, constraints, persistence** — covered by
  `apps/desktop/test/db.test.ts` (17 tests): `user_version`-keyed migrations are
  idempotent; WAL + `foreign_keys = ON` + `busy_timeout` applied on open; STRICT
  tables; unique keys and foreign-key enforcement (including `ON DELETE CASCADE`);
  and rows surviving close/reopen against a real file with no re-migration.

## Still outstanding before this is "PASSED" (spec 21.2)

1. **Packaged-app read/write/migration test** — verify the same behaviour inside a
   built/asar-packaged Electron app, not just `electron-vite dev`. The database
   opens in `app.getPath('userData')`, which only exists in a real app context.
2. **Ubuntu** (personal native machine) and **Windows** if it enters the first
   supported release — run the same suite on each OS.
3. **Backup/export behaviour** — confirm the `node:sqlite` `backup()` API (present
   in the module's exported keys) meets the diagnostics-bundle need (spec 31.2).

Until (1)–(3) are done, the fallback in spec 21.2 stands: a maintained pure-WASM
SQLite build, or a carefully packaged native library — but do not switch without
superseding this ADR.

## Notes for implementers

- `openDatabase(path)` (`src/main/db/database.ts`) is deliberately Electron-free so
  it runs under vitest; the main process passes
  `resolveDatabasePath(app.getPath('userData'))`.
- `StatementSync.get()/all()` return `unknown`. Columns are narrowed through the
  `row.ts` helpers (`asText`/`asInt`/…), which turn a DDL/type mismatch into a loud
  error instead of a silent `[object Object]` and keep `no-base-to-string` happy.
- The private key and certificate are **not** in the database — they remain
  restricted files (`identityStore.ts`); `desktop_identity.certificate_ref` points
  at the cert file (spec 24.2).
