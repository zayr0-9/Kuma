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
- Deletion means managed trash (`.foldersync-trash/`) **only under
  `mirror_user_deletions`** — `preserve_desktop_copy` (and an unknown policy) keeps the
  copy, since the desktop is never a disposable mirror (spec 6.3). Gated on
  `expectedRemoteVersionId` (mismatch → `remote_version_conflict`, no action);
  `retention_cleanup` delete requests are rejected at the contract.
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
- Dev-loop gotchas (learned from the first GUI run): the preload keeps
  `externalizeDepsPlugin` (without it the electron installer shim gets inlined into
  the sandboxed preload and dies on `child_process`); **main** now sets a custom
  `rollupOptions.input` (to emit the hash worker, below), which drops the plugin's
  external list, so main externalizes deps with an explicit `external` predicate
  (bundle only relative/absolute source; externalize every bare + `node:` specifier)
  — verified by build size (index.js ~55 kB, deps not inlined). Dev CSP allows inline
  scripts via `%VITE_CSP_SCRIPT_EXTRA%` env substitution only — production CSP stays
  strict; renderer console/preload errors relay to the terminal in dev.
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
- **Main process wiring + worker-thread hashing built** (spec 20.1/20.2/22.3):
  `src/main/backend.ts` (`startBackend`) assembles the whole privileged backend
  independently of Electron so it starts/stops under vitest against a temp data dir —
  opens the DB (`app.getPath('userData')`), loads/persists the TLS identity
  (`loadOrCreateIdentity`) and writes its `desktop_identity` summary row, builds the
  commit coordinator, serves the HTTPS control server, starts DNS-SD advertising
  (skippable in tests), and runs startup staging GC (`files.listActivePrepares` →
  `garbageCollectStaging` per destination). `main/index.ts` is now the only
  electron-aware file: it calls `startBackend` on `whenReady` and closes it on
  `will-quit`. **Worker-thread hashing** is real: `storage/hashWorker.ts` streams the
  SHA-256; `storage/hash.ts` spawns it via `new Worker`. electron-vite's Node build
  does **not** transform `new Worker(new URL(...))`, so the worker is emitted as a
  second `rollupOptions.input` (`out/main/hashWorker.js`) and `hash.ts` resolves it
  dev/prod-aware (source `.ts` under vitest/Node, sibling `.js` beside `index.js` in
  the package) — **verified by a real `pnpm build`** (worker emitted with its body,
  deps stay external, index.js ~55 kB). 2 new tests (backend bootstrap: DB + identity
  persistence + TLS health + restart-reuses-identity); worker hashing is exercised by
  the existing commit tests. 132 desktop / 201 workspace green.
- **Files delete + sync status built** (spec 6.4/25.2/26.2): `POST /v1/files/delete`
  mirrors a phone-reported user/external deletion to the desktop copy. The mechanics
  live in `sync/deleteService.ts` (`createDeleteService.applyDeletion`, electron-free /
  unit-tested; the endpoint does only auth, path safety and outcome→HTTP mapping):
  idempotent by `eventId` (a replay returns the recorded outcome as `already_applied`),
  gated on `expectedRemoteVersionId` vs the current version (mismatch →
  `remote_version_conflict` with no action — spec 26.2 requires review), and
  **policy-aware** — only `mirror_user_deletions` trashes; `preserve_desktop_copy` (and
  a null/unknown policy) keeps the copy and records `preserved`. Trashing is an atomic
  rename into `.foldersync-trash/<ts>/<relpath>` (both directory entries fsynced); a
  source already gone (external race) still records `trashed`. `recordDeletion` writes
  the `deletion_event` row and flips `remote_file` → `trashed` in one transaction. The
  `retention_cleanup` cause is rejected at the contract (`bad_request`, spec 6.2), and
  the response `trashPath` is destination-root-relative — an absolute server path is
  never sent (spec 30). New `files` repo methods: `getDeletionEvent`, `recordDeletion`,
  `countPendingCommits`; new `layout.ts` helper `relativeTrashPath`. The response
  contract gained a `preserved` action; the DB `DeletionAppliedAction` now holds the
  real stored outcomes (`trashed`/`preserved`/`no_remote_file` — `already_applied` is a
  read-time replay response only). `GET /v1/sync/status` returns the authenticated
  device's bound mappings (unbound omitted) with per-destination free space
  (`destinationAvailable` false when statfs throws) and the commit backlog
  (`countPendingCommits` — prepares in `uploaded`/`verifying`/`committing`). 17 new
  tests (7 service matrix, 5 delete endpoint, 5 sync-status endpoint). 149 desktop /
  221 workspace green.
- **Desktop pairing UI built** (first renderer feature; spec 24.3/20.1): the renderer
  gets a `PairingPanel` that shows the QR a phone scans, the desktop's display name, and
  a countdown to the window's expiry. The **QR is rendered in the main process** and
  crosses to the renderer only as a PNG data URL — the raw secret never enters renderer
  state. Pieces: `src/shared/pairing.ts` (IPC channel names + the secret-free
  `PairingPresentation` DTO, shared by main/preload/renderer), `src/main/ui/pairingQr.ts`
  (`renderPairingQr` — payload via the contract builder + `qrcode.toDataURL`, pure /
  tested), `src/main/ui/pairingController.ts` (`createPairingController` — opens the
  window, renders from the fresh secret, returns image + expiry only; electron-free /
  tested, the no-secret-leak invariant asserted), `src/main/net/lanHost.ts`
  (`resolveLanHost` — first non-internal IPv4 for the QR host hint, tested),
  `src/main/ui/ipc.ts` (`registerPairingIpc` — the thin `ipcMain.handle` glue, disposed
  on quit). The preload exposes `folderSync.pairing.{start,cancel}` (ipcRenderer used
  only inside the bridge); `main/index.ts` registers the IPC after the backend starts.
  `qrcode` (1.5.4, pure JS) added and kept **external** in the main build (predicate
  already externalizes bare specifiers — verified in the bundle). Renderer CSP gained
  `img-src 'self' data:` for the QR. `backend.ts` now exposes `displayName`. 6 new tests
  (2 lanHost, 1 QR render, 3 controller); 155 desktop green. **Verified by a real
  `pnpm build`** (preload emits the channels, main keeps qrcode external, built HTML
  carries the new CSP).
- **Desktop destinations UI built** (spec 25.2/12.5): the renderer gets a
  `DestinationsPanel` listing each paired phone and the folders on this desktop it backs
  up into; a destination is added via the native folder picker and starts unbound until
  the phone links a folder (`bound` ← `phone_root_id`). The logic lives in an
  electron-free `main/ui/destinationsController.ts` (`createDestinationsController` —
  `listDevices`/`listDestinations`/`addDestination`, unit-tested): `addDestination`
  validates the destination is an absolute path and the device is paired, then runs the
  **destination-overlap check at creation** (`findDestinationOverlap`, spec 12.5 — the
  register endpoint enforces it again for the wire) and `roots.create`s the mapping
  (display name defaults to the folder basename). `main/ui/destinationsIpc.ts`
  (`registerDestinationsIpc`) is the electron glue: `devices:list`, `destinations:list`,
  `destinations:pickFolder` (`dialog.showOpenDialog`, `openDirectory`/`createDirectory`)
  and `destinations:add`; disposed on quit. New repo methods `devices.listActive()` and
  `roots.list()`; `backend.ts` now exposes `repositories` to the main-process UI layer
  (never to the renderer). Preload exposes `folderSync.devices.list` and
  `folderSync.destinations.{list,pickFolder,add}`; shared DTOs/channels in
  `src/shared/destinations.ts`. 7 new tests (destinationsController matrix: create,
  overlap, unknown device, invalid path, explicit name, bound reflection, active-device
  list). **Verified by a real `pnpm build`** (preload emits the new channels).
- **Sync-status on the destination card built** (spec 25.2, agent_design §5): each card
  now merges in per-destination status from a new `status:get` IPC — free space,
  the two policies once bound, and the commit backlog. The logic is an electron-free
  `main/ui/statusController.ts` (`createStatusController` → `getStatus`, unit-tested):
  it reports **every** destination `roots.list()` returns (bound or not, keyed by
  mappingId) with its `freeBytes`/`destinationAvailable` (statfs, injectable — a failed
  statfs is surfaced as unavailable, not a throw), its policies (null until bound), and
  its `pendingCommits`. This is deliberately richer than the phone-facing
  `GET /v1/sync/status` (device-scoped, bound-only) because the management UI shows a
  folder's free space before any phone links to it. New repo method
  `files.countPendingCommitsForRoot(phoneDeviceId, rootId)` (per-destination backlog;
  the global `countPendingCommits()` is the top-line total). The statfs default was
  extracted to `main/storage/diskSpace.ts` (`freeBytesOnVolume`) and now backs both the
  prepare disk-space gate and this view. `main/ui/statusIpc.ts` (`registerStatusIpc`) is
  the thin electron glue for `status:get`, disposed on quit. Preload exposes
  `folderSync.status.get`; shared DTO/channel in `src/shared/status.ts`, `formatBytes` in
  `src/shared/format.ts` (pure, unit-tested). 8 new tests (statusController: free space
  for every destination + policies only once bound, unavailable volume, per-root and
  total pending; formatBytes matrix). 170 desktop / 242 workspace green. **Verified by a
  real `pnpm build`** (preload emits `status:get`).
- **Last-synced on the destination card built** (spec 25.2, agent_design §5): a bound
  destination now shows **"Last backed up {relative}"** (or **"No backups yet"** before
  the first commit), completing the §5 card fields. New repo read
  `files.getLastCommittedAt(phoneDeviceId, rootId)` (`MAX(remote_file.committed_at)`,
  kept even for trashed files so it reflects the last time anything was written; null
  before any commit) feeds a new `lastSyncedAt` field on the `status:get` DTO — no new
  IPC channel. Rendered via `formatRelativeTime` in `src/shared/format.ts` (pure,
  `Date.now()`-injected, unit-tested; relative per §4, absolute stays in
  history/diagnostics). 5 new tests (statusController last-synced; formatRelativeTime
  matrix). 175 desktop / 247 workspace green. **Verified by a real `pnpm build`**.
- Not yet built: the **manual-code** pairing fallback and live **pairing-completion
  feedback** (main→renderer push on a successful pair; the destinations panel offers a
  manual Refresh meanwhile); destination **rename/remove** and
  the phone-folder policy editing; enforcing `Upload-Length` against the prepare's
  `expected_size`;
  periodic (not just startup) staging GC; commit crash-recovery re-derivation through
  the service (commit.ts already handles it with a recorded sha); failed-auth /
  pairing **rate limiting** (spec 24.6, deferred — 256-bit secret + hashed tokens make
  it non-blocking); safeStorage key wrapping for the private key; a hash-worker pool
  (one worker per call today); splitting `controlServer.ts` (now ~575 lines) into
  `api/routes/*` registrars. `GET /v1/device` still reads the in-memory identity
  summary. A packaged/preview launch **boots** (the user verified `electron-vite
preview`: the renderer renders, Electron 43.2.0 / Node 24.18.0) — still owed by a
  manual launch: the pairing panel rendering its QR + the `pairing:*` round trip, the
  destinations panel's folder picker + `destinations:*` / `devices:*` round trips, and
  the worker path spawned in the packaged process via a real commit. The builds are
  verified; those runtime paths are not.

## Update this file when

The API surface, database schema, storage layout, process placement, or security
posture changes — major decision changes need an ADR.
