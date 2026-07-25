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
