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
  `src/main/storage/hash.ts`, `src/main/storage/durability.ts`, and the tus
  transport (Fastify + @tus/server with hijacked raw responses — proven resumable
  end to end; the standalone `uploadServer.ts` was later folded into the control
  server, see the upload-transport bullet below).
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
- **Control server built** (`src/main/api/controlServer.ts`, spec 24/25):
  `createControlServer(context)` serves an HTTPS Fastify instance on the pinned
  desktop identity (key/cert PEM from `identity.ts`). Cross-cutting middleware in a
  single `onRequest` hook: request-id (`x-request-id`, normalised to a uuid and
  echoed), mandatory protocol-version gate on authed routes
  (`protocol_version_unsupported`), and bearer auth — token SHA-256-hashed
  (`auth/token.ts` `hashToken`) and matched against `paired_device` via
  `findActiveByTokenHash` (revoked excluded), touching last-seen on success.
  `PUBLIC_ROUTES` (currently just `/v1/health`) skip auth. Errors go through
  `api/errors.ts` (`ApiError` → `buildErrorResponse`, validated against
  `errorResponseSchema`, never leaking internals). Endpoints implemented:
  `GET /v1/health` (unauth) and `GET /v1/device` (authed). 10 tests in
  `test/controlServer.test.ts` make real TLS requests (server cert supplied as
  `ca`, so a wrong cert fails the handshake — proves the pinned identity is served).
  Injectable `now` clock for deterministic last-seen.
- **Pairing built** (spec 24.3/24.5): `auth/pairingWindow.ts`
  (`createPairingWindow` — five-minute window, one 256-bit one-time secret,
  constant-time compare, one-time consume, injectable clock/secret; `activeSecret()`
  stays main-process only for QR rendering), `auth/token.ts` `generateBearerToken`
  (256-bit base64url), and `POST /v1/pair` on the control server (public route —
  the phone has no token yet). The handler validates the body, checks mutual
  protocol support, consumes the secret only if otherwise valid (never burns the
  window on a client error), mints a token, and upserts `paired_device` via
  `devices.recordPairing` (re-pairing reissues rather than colliding on the PK).
  New generic error code `bad_request` added to the protocol + spec. 12 new tests
  (7 endpoint incl. re-pair + one-time replay, 5 window unit).
- **Roots registration built** (spec 25.2/12.5): `POST /v1/roots/register` binds a
  phone root to a desktop-approved mapping (the phone sends a `mappingId`, never an
  absolute path). Checks: mapping exists and is owned by the authenticated device
  (else `root_not_mapped`, existence not leaked); one-mapping-to-one-root integrity
  (re-pointing is a `bad_request` conflict, re-binding the same pair is the allowed
  policy update); and destination overlap. `storage/destinationOverlap.ts`
  (`destinationsOverlap`/`findDestinationOverlap`, pure) rejects a destination equal
  to / ancestor of / descendant of an existing mapping's — case-insensitive on
  darwin/win32 (over-blocks rather than risks a shared-dir overwrite; realpath-based
  precision is a follow-up). The UI-approval step that creates the mapping row with
  its destination is simulated in tests via `roots.create`; the real IPC lands with
  the desktop-UI slice. 17 new tests (10 overlap unit, 7 endpoint).
- **Files prepare built** (spec 25.2/22.2/6.5): `POST /v1/files/prepare` reserves an
  upload or tells the phone to skip. The phone references a phone `rootId`; the
  destination is resolved server-side from the bound mapping via
  `roots.getByPhoneRoot` (unknown/foreign → `root_not_mapped`), the relative path
  passes `resolveDestinationPath` + the managed-dir guard (any failure →
  `invalid_relative_path`, the kind in `details`, never the resolved path; a
  wire-rule violation such as traversal is caught earlier by the contract as
  `bad_request`), and a disk-space gate (`freeSpace` injectable, defaults to
  `statfs`; file bytes + a conflict-copy estimate + margin) returns
  `insufficient_space`. Skip is returned only when the phone's
  `knownRemoteVersionId` equals the current committed version (idempotent
  re-prepare); a null/stale id falls through to upload, and adopt-in-place dedupes
  at commit time (spec 6.5). Prepares are idempotent per path — a live reservation
  is reused rather than orphaning staging — and default to a seven-day lifetime
  (spec 22.3). `GET /v1/files/prepare/:prepareId` reports status for the owning
  device only (foreign/unknown → `upload_not_found`), lazily flips a time-expired
  reservation to `expired`, and surfaces the committed version id + hash once
  present. New `db/repositories/files.ts` (`FilesRepository`) covers the
  `upload_prepare` / `remote_file` / `remote_version` trio; `resolveDestinationPath`
  now also returns the normalised `relativePath` used as the storage key. 20 new
  tests (14 endpoint, 6 repository).
- **Upload transport folded** (spec 18.4/18.5; ADR
  `desktop-tus-per-destination-staging.md`): `api/uploadRouting.ts`
  (`registerUploadRoutes`) mounts tus on the authenticated control server. Auth is
  the same `onRequest` hook (bearer + protocol gate); the staged file is named by
  its **prepare id** (`namingFunction` from tus metadata — a validated uuid bound to
  an owned prepare, never a client path), so staging GC reconciles against
  `upload_prepare`. Because one `@tus/server` `FileStore` binds one directory but
  staging must live on each destination volume for the atomic rename (spec 22/6.5),
  there is **one tus server per destination staging dir**, cached and routed
  per-request by resolving the prepare first (owned + non-terminal + unexpired →
  else `unauthorised`/`upload_not_found`/`upload_expired`/`bad_request`, all before
  `reply.hijack()`). `onUploadCreate` flips the prepare to `uploading` and links the
  tus id/location (`files.markUploading`); `onUploadFinish` sets `uploaded`. The
  standalone `uploadServer.ts` was retired. 9 new tests (5 endpoint incl. a real
  resumable TLS upload → per-destination staging → atomic commit, 3 metadata unit,
  1 repo) replace the 3 retired `uploadServer.ts` tests. 118 desktop / 187
  workspace green.
- **Commit on finish built** (spec 18.5): a finished upload becomes visible.
  `sync/commitService.ts` (`createCommitService.commitPrepare`) resolves the
  prepare's mapping, drives `verifying`, runs the spike-6 `commitStagedFile` (verify
  size → hash → adopt-in-place | conflict-preserve | atomic replace), then persists
  the durable version via `files.recordCommittedVersion` (transactional
  upsert-of-`remote_file` + supersede-prior + insert new immutable `remote_version`)
  and flips the prepare to `committed`, or to `failed` with a wire error code (size /
  hash mismatch → `source_changed`, path issues → `invalid_relative_path`, staged
  bytes gone → `upload_not_found`, mapping gone → `destination_unavailable`).
  `sync/commitCoordinator.ts` serialises commits per `(rootId, relativePath)` (spec
  18.5) via a per-key promise chain and is driven from `onUploadFinish` off the
  request path (the tus 204 is never held for a multi-GB hash; the phone polls
  prepare status). The control server accepts an optional `commitCoordinator` (the
  main process supplies one; without it a finished upload rests in `uploaded`). The
  plain `insertRemoteFile`/`insertRemoteVersion` stand-ins were replaced by
  `recordCommittedVersion`. 15 new tests (7 service, 4 coordinator, 1 full-loop TLS
  upload→commit→visible, 2 repo supersede, +1 net from refactors). 130 desktop / 199
  workspace green.
- Not yet built: **hash worker-thread offload** (spec 20.2) — implemented and
  test-green on Node 26, but reverted here because its production form needs
  electron-vite Node-worker bundling that can only be designed/verified once the
  Electron main process actually imports this backend (nothing does yet; the whole
  control-server/DB/sync stack is built-and-tested but not wired into `main/index.ts`,
  so `pnpm build` bundles only the window skeleton). It lands with that main-wiring
  slice, verified by a real build. Also pending: enforcing `Upload-Length` against
  the prepare's `expected_size`; commit crash-recovery re-derivation through the
  service (commit.ts already handles it with a recorded sha); failed-auth / pairing
  **rate limiting** (spec 24.6, deferred — 256-bit secret + hashed tokens make it
  non-blocking); the desktop-side mapping-approval IPC (destination picker →
  `roots.create` with an overlap check at creation time too); `POST /v1/files/delete`;
  `GET /v1/sync/status`; safeStorage key wrapping; the QR **image** rendering +
  renderer/IPC (only the payload/secret plumbing exists). The DB summary row for
  `desktop_identity` is written when identity is wired into the main process (identity
  currently persists to files only via `identityStore.ts`); `GET /v1/device` reads the
  in-memory identity summary.

## Update this file when

The API surface, database schema, storage layout, process placement, or security
posture changes — major decision changes need an ADR.
