# agent_desktop.md — Desktop companion scope

**Scope:** `apps/desktop/` — the Electron companion: Fastify control API, tus server,
SQLite metadata, DNS-SD advertisement, TLS identity/pairing, destination management.

**Spec sections to load before working here:** 20 (architecture), 21 (database), 22
(storage layout, path safety, staging GC), 23 (discovery), 24 (pairing/TLS), 25
(control protocol). UI changes also require [`agent_design.md`](agent_design.md).

## Hard rules

- **Process boundaries are security boundaries.** Renderer: unprivileged React only —
  `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, no raw
  `ipcRenderer`, no generic filesystem access, and it never sees bearer tokens, private
  keys, or the raw pairing secret (the pairing QR is rendered in main and passed as an
  image). Preload exposes only the narrow named methods in spec 20.1.
- Everything privileged lives in main (or worker threads for hashing). Fastify +
  `@tus/server` (never legacy `tus-node-server`); tus routes bypass Fastify body parsing.
- **Path safety (spec 22.1) on every incoming path** — traversal, absolute/UNC, NUL,
  Windows reserved names and `MAX_PATH`, symlink escape. Never trust a path from tus
  metadata; only from the validated prepare record.
- Commits: staging on the destination volume → size check → SHA-256 in worker →
  external-modification check → atomic rename. Never report `committed` early;
  serialise commits per `(rootId, relativePath)`. Adopt-in-place when destination hash
  equals staged hash (spec 6.5).
- Deletion means managed trash (`.foldersync-trash/`), gated on
  `expectedRemoteVersionId`; `retention_cleanup` delete requests are rejected.
- Staging is garbage-collected against `upload_prepare` on startup (spec 22.3);
  prepares live ~7 days and are renewable.
- Tokens stored hashed only; secrets redacted from logs; unexpected certificate change
  is a hard failure.
- `node:sqlite` is the database choice — verified unflagged in Electron 43's Node
  24 and accepted (`architecture-decisions/desktop-database-node-sqlite.md`). The
  packaged-app + Ubuntu/Windows verification is still outstanding; do not switch
  databases without superseding that ADR. The DB never lives inside a destination
  root (spec 22) — it opens in `app.getPath('userData')`.

## Current state

- Skeleton in place: electron-vite 5 (Electron 43.2.0, Vite 8, React 19) with the
  spec-20.1 security defaults wired (`contextIsolation`, `sandbox: true`, no
  `nodeIntegration`, window-open denied, CSP meta, CJS preload because sandboxed
  preloads cannot be ESM). Preload exposes only `runtimeVersions`. `pnpm dev:desktop`
  launches it; `pnpm --filter desktop build` is the headless verification.
- `src/main/storage/pathSafety.ts`: spec-22.1 destination validation —
  `resolveDestinationPath` (wire rules via contracts + win32 reserved
  names/invalid chars/trailing dot-space/MAX_PATH + containment re-check) and
  `parentsResolveInsideRoot` (symlink-escape check). 16 tests, including a real
  symlink-escape case. All filesystem writes must go through these.
- `skipLibCheck: true` in this package only (electron-vite d.ts imports optional
  peers); base config keeps lib checking on.
- **Spike 6 PASSED** (see `architecture-decisions/spike-6-desktop-atomic-commit.md`):
  the commit pipeline exists and is the required path for making files visible —
  `src/main/sync/commit.ts` (`commitStagedFile`: size/hash verify → conflict
  preserve or adopt-in-place → fsync → atomic rename; crash-recovery converges),
  `src/main/sync/stagingGc.ts` (spec 22.3), `src/main/storage/layout.ts`
  (managed dirs, reserved-path guard, trash/conflict timestamps),
  `src/main/storage/hash.ts`, `src/main/storage/durability.ts`, and
  `src/main/api/uploadServer.ts` (Fastify + @tus/server with hijacked raw
  responses — proven resumable end to end).
- **Spikes 3 and 4, desktop halves PASSED** (ADRs in `architecture-decisions/`):
  `src/main/discovery/advertise.ts` (ciao DNS-SD, TXT surface pinned to
  v/id/name/tls, verified by a bonjour-service browser) and
  `src/main/auth/identity.ts` + `identityStore.ts` (ECDSA P-256 identity,
  SPKI pin round-trips the wire schema, verified against a live TLS handshake
  incl. impersonator rejection; generate-once store, 0600 key file).
  `reflect-metadata` must stay imported before `@peculiar/x509`. Android halves
  of both spikes wait on the dev client.
- Dev-loop gotchas (learned from the first GUI run): `externalizeDepsPlugin` is
  mandatory on main+preload (without it the electron installer shim gets inlined
  into the sandboxed preload and dies on `child_process`); dev CSP allows inline
  scripts via `%VITE_CSP_SCRIPT_EXTRA%` env substitution only — production CSP
  stays strict; renderer console/preload errors relay to the terminal in dev.
- Dev-loop observability: renderer console and preload errors are relayed to the
  terminal in dev (main/index.ts) — a blank window must never be silent. CSP is
  env-driven: production stays strict; dev adds the React-refresh inline allowance
  and blob worker-src (.env.development). electron stays external in the preload
  build (externalizeDepsPlugin + explicit external) — bundling it pulls the npm
  installer shim, which dies in the sandbox.
- **Database layer built** (`src/main/db/`, spec 21): `openDatabase(path)` applies
  WAL/`foreign_keys`/`busy_timeout` and runs `user_version`-keyed migrations;
  `schema.ts` holds the v1 DDL for all eight spec-21.1 tables (STRICT); `row.ts`
  narrows `node:sqlite`'s `unknown` column values. Repositories exist for
  `desktop_identity`, `paired_device`, `root_mapping` (identity/devices/roots) via
  `createRepositories(db)`; the file-sync trio (`remote_file`, `upload_prepare`,
  `remote_version`), `deletion_event` and `event_log` have tables in v1 but their
  repositories land with the slices that exercise them (prepare/upload, deletion).
  17 tests in `test/db.test.ts`.
- Not yet built: control API endpoints (auth, prepare, delete), the HTTPS control
  server on the spike-4 identity, pairing endpoint/window. Hash worker-thread
  offload lands with the control API wiring; safeStorage key wrapping lands with
  main-process wiring. The DB summary row for `desktop_identity` is written when
  identity is wired into the main process (currently identity persists to files
  only via `identityStore.ts`).

## Update this file when

The API surface, database schema, storage layout, process placement, or security
posture changes — major decision changes need an ADR.
