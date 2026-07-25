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

### 2026-07-25T03:45+0100 — spike/desktop-atomic-commit — Spike 6 passed

- **Done:** desktop atomic-commit pipeline with 31 new tests (116 total):
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
