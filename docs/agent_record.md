# agent_record.md — Rolling work log

Every agent session that changes this repo appends an entry here **before finishing**.

**Staleness rule: any entry older than 24 hours is stale — delete it.** At the start of
every session, remove all entries whose timestamp is more than 24 hours old. This file
is a rolling window for coordination between overlapping sessions, not history; durable
history lives in git commits and squash-merged PRs.

## Entry format

```markdown
### <ISO timestamp with offset> — <branch> — <short title>

- **Done:** what was completed (outcomes, not intentions)
- **Files:** key files touched
- **PR:** #NN (open | squash-merged) — omit for bootstrap/docs-only local work
- **Docs updated:** which agent_*.md files were updated, or "none needed"
- **Follow-ups:** anything left dangling that the next session must know
```

Entries are ordered newest-first.

---

### 2026-07-25T10:10+0100 — feature/phase1-pairing — Pairing endpoint + window + token issuance (spec 24.3/24.5)

- **Done:** `POST /v1/pair` end to end. `auth/pairingWindow.ts` — five-minute
  window, one 256-bit one-time secret, constant-time compare (`timingSafeEqual`
  with length guard), one-time consume, injectable clock + secret generator;
  `activeSecret()` stays main-process-only for QR rendering. `auth/token.ts` gained
  `generateBearerToken` (32 CSPRNG bytes base64url). Control server: pair route
  (public — phone has no token yet), validates body → checks mutual protocol
  support → consumes secret only if otherwise valid (never burns the window on a
  client error) → mints token → `devices.recordPairing` upsert (re-pair reissues,
  no PK collision). New generic protocol error code `bad_request` (added to
  `packages/protocol` + spec §25.3 list; additive, no version bump; existing error
  fixtures cover the envelope). 12 new tests (7 endpoint: happy path + token works +
  wrong secret + no window + one-time replay + protocol mismatch keeps window +
  malformed body + re-pair supersedes old token; 5 window unit). 75 desktop / 144
  workspace green; lint/typecheck/format clean.
- **Design notes:** consume-after-validate ordering keeps a client error from
  burning the one-time secret. `recordPairing` added to the devices repo as an
  upsert (kept `insert` for tests). Rate limiting (spec 24.6) deliberately deferred
  — 256-bit secret + hashed tokens make brute force infeasible, so it is not on the
  slice's critical path; tracked in `agent_desktop.md`. QR **image** rendering +
  renderer/IPC deferred to the desktop-UI slice; only the payload/secret plumbing
  exists.
- **Files:** `apps/desktop/src/main/auth/{pairingWindow,token}.ts`,
  `apps/desktop/src/main/api/controlServer.ts`,
  `apps/desktop/src/main/db/repositories/devices.ts`,
  `apps/desktop/test/{controlServer,pairingWindow}.test.ts`,
  `packages/protocol/src/errors.ts`, `docs/foldersync_implementation_spec.md`
  (§25.3 code list).
- **PR:** branch `feature/phase1-pairing` pushed — open + squash-merge in web UI.
- **Docs updated:** `agent_desktop.md`, `agent_protocol.md`, spec §25.3, this record.
- **Follow-ups:** next slice — `POST /v1/roots/register` (destination-overlap guard
  via `roots.listDestinations()` + pathSafety). Then `POST /v1/files/prepare`
  (+ file-sync repos + tus into the HTTPS server), `GET /v1/sync/status`, rate
  limiting, hash worker-thread offload, and the desktop-UI slice (pairing window +
  QR image render in main).

### 2026-07-25T09:56+0100 — feature/phase1-control-server — HTTPS control server + auth middleware (spec 24/25)

- **Done:** `createControlServer(context)` — HTTPS Fastify on the pinned desktop
  identity (spike-4 cert/key PEM). Single `onRequest` hook does request-id
  (normalise to uuid + echo via `x-request-id`), mandatory protocol-version gate on
  authed routes, and bearer auth (SHA-256 token hash → `paired_device`
  `findActiveByTokenHash`, revoked excluded, last-seen touched on success).
  `api/errors.ts` renders `ApiError` into the spec-25.3 envelope (validated against
  `errorResponseSchema`, no internal leakage). `auth/token.ts` `hashToken`.
  Endpoints: `GET /v1/health` (unauth) + `GET /v1/device` (authed). 10 new tests
  (`controlServer.test.ts`) make real TLS calls with the server cert as `ca` — a
  wrong cert would fail the handshake, so this also proves the pinned identity is
  served. 63 desktop / 132 workspace tests green; lint/typecheck/format clean.
- **Design notes:** DB layer merged on `main` first (PR #1, squash `0c43e00`), so
  this branches fresh from it — no stack. `createUploadServer` (spike-6 tus,
  plain HTTP) left untouched; folding tus into the HTTPS server with auth +
  prepare-keyed naming happens in the prepare/upload slice. Injectable `now` clock
  for deterministic last-seen. Failed-auth rate limiting (spec 24.6) deferred to
  the pairing slice where brute-force matters.
- **Files:** `apps/desktop/src/main/api/{controlServer,errors}.ts`,
  `apps/desktop/src/main/auth/token.ts`, `apps/desktop/test/controlServer.test.ts`.
- **PR:** branch pushed — squash-merge in web UI.
- **Docs updated:** `agent_desktop.md` (control-server current state + remaining),
  this record.
- **Follow-ups:** next slices (each its own branch/PR off `main`): pairing window +
  `POST /v1/pair` + token issuance + rate limiting; `POST /v1/roots/register` with
  overlap guard; `POST /v1/files/prepare` (+ status) + file-sync repos + tus into
  the HTTPS server; `GET /v1/sync/status`; worker-thread hashing.

### 2026-07-25T09:36+0100 — feature/phase1-desktop-db — Desktop database layer (spec 21)

- **Done:** desktop metadata database built on `node:sqlite`. §21.2 gate cleared —
  `node:sqlite` roundtrips in Electron 43's embedded Node 24.18.0 **with no flag**
  (`ELECTRON_RUN_AS_NODE=1`), and is unflagged in the local Node 26 that runs
  vitest, so tests exercise the real module. `src/main/db/`: `database.ts`
  (`openDatabase` → WAL + `foreign_keys` + `busy_timeout`, runs migrations; pure of
  `electron`, path injected via `resolveDatabasePath(userData)`), `migrations.ts`
  (`user_version`-keyed, transactional, append-only, idempotent), `schema.ts` (v1
  DDL, all 8 spec-21.1 tables, STRICT), `row.ts` (narrows `node:sqlite`'s `unknown`
  columns — also satisfies `no-base-to-string`), `types.ts` (row types reusing
  contract enums), and repositories for `desktop_identity`/`paired_device`/
  `root_mapping` via `createRepositories(db)`. 17 new tests (53 desktop, 122
  workspace). Lint/typecheck/format/test all green.
- **Design notes:** all 8 tables created in migration v1 (schema is one design
  unit); repos for the file-sync trio + deletion + event_log land with their
  feature slices, not speculatively. `root_mapping` models the spec-25.2 flow:
  desktop UI creates a pending mapping (null `phone_root_id`/policies), the phone
  binds via register. Token hashes only; revoked pairings excluded from auth
  lookup but retained. FK `ON DELETE CASCADE` from `paired_device`.
- **Files:** `apps/desktop/src/main/db/**`, `apps/desktop/test/db.test.ts`, ADR
  `architecture-decisions/desktop-database-node-sqlite.md`.
- **PR:** branch pushed — **first PR under the new protected-main workflow**
  (squash-merge in web UI; `gh` is work-only so no CLI PR).
- **Docs updated:** `agent_desktop.md` (current state + node:sqlite rule), new ADR,
  this record.
- **Follow-ups:** next desktop slices (each its own branch/PR): (1) HTTPS control
  server on the spike-4 identity + protocol/auth middleware + `/v1/health`,
  `/v1/device`; (2) pairing window/secret + `POST /v1/pair` + token issuance;
  (3) `POST /v1/roots/register` with destination-overlap guard (uses
  `roots.listDestinations()`); (4) `POST /v1/files/prepare` + status + the
  file-sync repos + tus `namingFunction`; (5) worker-thread hashing. The
  packaged-app and Ubuntu/Windows node:sqlite verification is still owed per the ADR.

### 2026-07-25T09:18+0100 — main (setup) — GitHub remote created via personal SSH alias

- **Done:** `origin` set to `git@github-personal:zayr0-9/Kuma.git` and `main`
  pushed (tracking `origin/main`). Root-caused and avoided the identity trap:
  `~/.ssh/config` pins `Host github.com` → `id_ed25519` (work key,
  `IdentitiesOnly yes`) which authenticates as **ksingh-max**; the personal alias
  is `Host github-personal` → `id_ed25519_personal` → **zayr0-9** (both verified
  live with `ssh -T`). GitHub's copy-paste URL (`git@github.com:zayr0-9/Kuma.git`)
  would have pushed with the work key — rewrote the host to `github-personal`.
  `gh` CLI is authed **only** as work ksingh-max, so repo settings
  (squash-merge-only + `protect-main` ruleset) are being done by Karan in the web
  UI rather than via a work-token API call.
- **Files:** none in-repo (git remote config + auto-memory only).
- **PR:** none (setup; no code change).
- **Docs updated:** this record; auto-memory `github-push-ssh-aliases-kuma` added,
  `personal-vs-work-github-identity` refreshed.
- **Follow-ups:** (1) CI's first-ever run should have triggered on the `main` push
  (`on: push: branches: [main]`) — check `github.com/zayr0-9/Kuma/actions`; it may
  be red on first run (`--frozen-lockfile` / `format:check`) — fix before gating.
  (2) After first green run, add `checks` as a required status check in the
  ruleset. (3) Web-UI settings: disable merge-commit + rebase-merge, enable
  auto-delete head branches, ruleset "Require a PR" with **0** required approvals
  (solo — 1 would lock out self-merge), block force pushes.

### 2026-07-25T09:10+0100 — fix/desktop-renderer-blank — Both apps verified live on real targets

- **Done:** desktop blank-window bug fixed — two causes: (1) CSP `script-src
'self'` blocked Vite's inline React-refresh preamble in dev (now env-driven:
  `%VITE_CSP_SCRIPT_EXTRA%`/`%VITE_CSP_DEV_DIRECTIVES%` via .env.development /
  .env.production, production CSP unchanged); (2) the preload bundle inlined the
  `electron` npm installer shim (requires `child_process` → dies in the sandbox)
  because `externalizeDepsPlugin()` was missing — now applied to main+preload
  with `external: ['electron']` as belt-and-braces. Added permanent dev
  observability: renderer `console-message` and `preload-error` relayed to the
  terminal (a blank window must never be silent). App.tsx degrades to a visible
  message if the bridge is absent. **Verified live:** desktop window renders
  "Electron 43.2.0, Node 24.18.0"; phone dev client loads the bundle and shows
  **"Native module: pong"** — full EAS→Kotlin→autolinking→bridge chain proven.
- **Gotcha for the dev loop:** macOS firewall had `node` set to "Block incoming
  connections", which reset the phone→Metro connection (symptom: QR scan →
  "connection reset"). Fix: System Settings → Network → Firewall → Options →
  node → Allow. `adb reverse tcp:8081 tcp:8081` over USB is the fallback.
- **Files:** `apps/desktop/electron.vite.config.ts`, `src/main/index.ts`,
  renderer (App/env.d.ts/index.html), `.env.development`, `.env.production`,
  `.gitignore`.
- **PR:** none possible yet (no remote) — squash-merged locally to `main`, branch deleted.
- **Docs updated:** `agent_desktop.md`, `agent_mobile.md`, this record.
- **Follow-ups:** with the dev client live, all four Android spike halves are
  unblocked (SAF, foreground service, NsdManager browse, pinned-TLS client).
  Phase 1 vertical slice can begin.

### 2026-07-25T04:15+0100 — spike/discovery-tls-desktop — Spikes 3 & 4 desktop halves passed

- **Done:** DNS-SD advertisement via @homebridge/ciao verified by a live
  bonjour-service browse (TXT surface locked to v/id/name/tls); desktop TLS
  identity (ECDSA P-256, ~10y self-signed cert, base64url SPKI pin compatible
  with `base64Url32Schema`) verified against a real TLS handshake including
  impersonator-pin rejection; generate-once identity store with 0600 key file.
  5 new tests (36 in desktop suite). ADRs: spike-3-mdns-discovery.md,
  spike-4-pinned-tls.md (both "desktop half PASSED"). Gotchas: reflect-metadata
  import required before @peculiar/x509; bonjour-service is `export =` so
  esModuleInterop enabled for desktop.
- **Files:** `apps/desktop/src/main/{discovery,auth}/**`, tests, ADRs, tsconfig.
- **PR:** none possible yet (no remote) — squash-merged locally to `main`, branch deleted.
- **Docs updated:** `agent_desktop.md`, this record, two ADRs.
- **Follow-ups:** Android halves (NsdManager browse, pinned trust manager, QR
  pairing) blocked on the dev client build. Next desktop slice: pairing window +
  `/v1/pair` + control-API auth on the identity from spike 4.

### 2026-07-25T04:30+0100 — fix/eas-android-build — First EAS build failure diagnosed and fixed

- **Done:** EAS build `787a88d6` ERRORED with two gradle failures: (1)
  `foldersync-native` build.gradle lacked `compileSdk` — fixed by adding
  `useDefaultAndroidSdkVersions()` from ExpoModulesCorePlugin; (2)
  `SoftwareComponent 'release' not found` on `:expo` — root cause was duplicate
  expo/expo-modules-core instances from pnpm's isolated linker (expo-doctor
  confirmed). Fixed by `nodeLinker: hoisted` + `autoInstallPeers: false` in
  pnpm-workspace.yaml (pnpm 11 ignores .npmrc entirely — .npmrc deleted; all
  settings live in pnpm-workspace.yaml now). Also: EAS build env pinned to Node
  24.18.0 in eas.json (image default is Node 22 vs our engines >=24), typescript
  added to `expo.install.exclude`, dropped `useExpoPublishing()` from the module
  gradle (local module, never published). expo-doctor: 20/20 after removing
  `expo-modules-core` as a direct dep.
- **Files:** `pnpm-workspace.yaml`, `.npmrc` (deleted),
  `modules/foldersync-native/android/build.gradle`, `apps/mobile/eas.json`,
  `apps/mobile/package.json`, lockfile.
- **PR:** none possible yet (no remote) — squash-merged locally to `main`, branch deleted.
- **Docs updated:** `agent_mobile.md`, this record.
- **Update 04:35:** rebuild a3b0994e FINISHED — gradle wiring of foldersync-native verified; APK ready for install.
- **Follow-ups:** rebuild queued after merge — verify it turns green, then install
  the APK on the Samsung and check "Native module: pong". Hoisted layout is a
  workspace-wide change: desktop suite re-verified in this branch.

### 2026-07-25T04:05+0100 — feature/eas-project-setup — EAS project linked, first dev build queued

- **Done:** EAS project created and linked (`@sigma2/foldersync`, id
  `b86a340b-f58c-4903-aa6b-d00956359bcb`; personal Expo account). projectId wired
  into `app.config.ts` manually (eas-cli cannot edit dynamic TS configs).
  Android keystore generated by EAS in the cloud (non-interactive now works for
  this). First development build queued: build id
  `787a88d6-aad0-4ad1-a75c-96718469ebbf` — this is the first-ever verification of
  the native module's gradle wiring.
- **Files:** `apps/mobile/app.config.ts`.
- **PR:** none possible yet (no remote) — squash-merged locally to `main`, branch deleted.
- **Docs updated:** `agent_mobile.md`, this record.
- **Follow-ups:** when the build finishes, install the APK on the Samsung phone
  (QR/link from the build page), run `pnpm dev:mobile`, and confirm the home
  screen shows "Native module: pong". If the gradle wiring fails, iterate on
  `modules/foldersync-native/android/build.gradle`.

### 2026-07-25T03:45+0100 — spike/desktop-atomic-commit — Spike 6 passed

- **Done:** desktop atomic-commit pipeline with 15 new tests (31 in the desktop suite, 100 workspace-wide):
  `commitStagedFile` (verify size/sha → adopt-in-place | conflict-preserve |
  replace-if-unchanged → fsync → atomic rename), crash simulation before/after
  rename with deterministic recovery (`already_committed` via recorded sha),
  staging GC, reserved-path guard (`.foldersync-*` never addressable from the
  wire), and the Fastify + @tus/server integration proven with a real
  interrupted-and-resumed chunked upload committed byte-identically. ADR:
  `docs/architecture-decisions/spike-6-desktop-atomic-commit.md` (PASSED).
- **Files:** `apps/desktop/src/main/{sync,storage,api}/**`, tests, ADR.
- **PR:** none possible yet (no remote) — squash-merged locally to `main`, branch deleted.
- **Docs updated:** `agent_desktop.md`, this record, new ADR.
- **Follow-ups:** worker-thread hash offload + tus `namingFunction` tied to
  prepare ids land with the control-API slice. Spikes 1/2/5 need the EAS dev
  build (blocked on `eas login`); spikes 3/4 desktop halves are next candidates.

### 2026-07-25T03:20+0100 — feature/phase0-mobile-native-skeleton — Mobile + native module skeletons

- **Done:** `apps/mobile` Expo SDK 57.0.8 skeleton (Expo Router, expo-dev-client,
  app.config.ts, monorepo metro.config.js, eas.json development profile) and
  `modules/foldersync-native` Expo module skeleton (expo-module.config.json,
  library build.gradle, `FolderSyncModule.kt` with `ping()`, TS surface via
  `requireOptionalNativeModule`). Typed native wrapper at
  `apps/mobile/src/native/`. Verified: typecheck, eslint, prettier, and a headless
  `expo export --platform android` (Hermes bundle builds through the monorepo
  metro config). eslint config gained CommonJS globals for config files and
  ignores `.expo/`.
- **Files:** `apps/mobile/**`, `modules/foldersync-native/**`, `eslint.config.mjs`.
- **PR:** none possible yet (no remote) — squash-merged locally to `main`, branch deleted.
- **Docs updated:** `agent_mobile.md`, `agent_native.md` (current state), this record.
- **Follow-ups:** Kotlin/Gradle never compiled (no local toolchain) — the first
  `eas build --platform android --profile development` verifies it and needs
  `eas login` with the personal Expo account. Android package id
  `dev.zayr.foldersync` is a placeholder. Phase 0 is now complete except CI has
  never run (no remote); next: Spike 6 (desktop staging → hash → atomic commit)
  or the EAS build to validate the native chain.

### 2026-07-25T03:06+0100 — feature/phase0-desktop-skeleton — Desktop skeleton + path safety

- **Done:** `apps/desktop` electron-vite skeleton (Electron 43.2.0 — the spec's
  research baseline — Vite 8, React 19) with spec-20.1 security defaults; preload
  exposes only `runtimeVersions`; CJS preload (sandboxed preloads can't be ESM);
  CSP meta. Spec-22.1 path safety implemented in `src/main/storage/pathSafety.ts`
  with 16 tests (win32 reserved names, MAX_PATH, control chars, containment,
  symlink escape via real temp dirs). `electron-vite build` verified headless.
  85 tests green workspace-wide; typecheck/lint/format clean.
- **Files:** `apps/desktop/**`, `pnpm-workspace.yaml` (allowBuilds for
  electron/esbuild).
- **PR:** none possible yet (no remote) — squash-merged locally to `main`, branch deleted.
- **Docs updated:** `agent_desktop.md` (current state), this record.
- **Follow-ups:** GUI launch not exercised in this session — run `pnpm dev:desktop`
  once manually. Next slices: mobile Expo skeleton + native module skeleton, then
  Spike 6 (staging → hash → atomic commit) can start desktop-side.

### 2026-07-25T03:00+0100 — feature/phase0-protocol-contracts — Protocol + contracts packages

- **Done:** `packages/protocol` (version/header/endpoint/error/discovery constants),
  `packages/contracts` (Zod schemas for all spec-25 endpoints, policy enums, canonical
  wire-path parser with NFC normalisation, pairing-QR build/parse),
  `packages/test-fixtures` (37 golden fixtures, 15 directories). 69 tests green;
  typecheck, eslint (flat config, type-checked rules, `no-explicit-any` error) and
  prettier all pass. CI workflow added (`.github/workflows/ci.yml`). Exact dependency
  pins enforced via `saveExact: true` in pnpm-workspace.yaml (pnpm 11 ignores
  `.npmrc save-exact` — root cause of initial caret ranges).
- **Files:** `packages/*`, `eslint.config.mjs`, `.prettierignore`,
  `.github/workflows/ci.yml`, `pnpm-workspace.yaml`, root `package.json`.
- **PR:** none possible yet (no remote) — squash-merged locally to `main`, branch deleted.
- **Docs updated:** `agent_protocol.md` (current state), this record.
- **Follow-ups:** TypeScript pinned to 5.9.3 everywhere — pnpm resolved 7.0.2 (native
  tsc) for one package before pinning; revisit TS 7 deliberately later. Next Phase-0
  slices: desktop skeleton (electron-vite + Fastify + path-safety), mobile skeleton
  (Expo), native module skeleton.

### 2026-07-25T02:39+0100 — main (bootstrap exception) — Repo and dev-env bootstrap

- **Done:** pnpm workspace root (package.json, pnpm-workspace.yaml, tsconfig.base.json,
  .npmrc save-exact, .prettierrc, .editorconfig, .gitignore); docs/ created with master
  agent.md, this record, agent_design.md, scoped agent_*.md files, and the distilled
  engineering-taste corpus; implementation spec moved to docs/; git repo initialised on
  `main` with personal identity (zayr0-9 noreply email); android-platform-tools (adb)
  installed via Homebrew.
- **Files:** everything — initial commit.
- **PR:** none (bootstrap exception; all future work is branch → PR → squash-merge).
- **Docs updated:** all created fresh.
- **Follow-ups:** GitHub remote not yet created — gh CLI is authenticated only as the
  work account; add the personal `zayr0-9` account (`gh auth login`) before creating
  the remote. No packages scaffolded yet — Phase 0 (spec section 36) is next: mobile
  and desktop skeletons, contracts package, CI. The temporary `engineering-taste/` copy
  at the repo root is gitignored and can be deleted once no longer needed.
