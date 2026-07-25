# agent.md — Repository rules (master)

**Read this file before doing anything else. These rules are mandatory, not advisory.**

FolderSync is an Android-to-desktop LAN backup product. The behavioural single source of
truth is [`docs/foldersync_implementation_spec.md`](foldersync_implementation_spec.md) —
follow it rather than improvising a different sync model. Section 38 of the spec lists
absolute implementation rules; they apply on top of everything here.

## 1. Git workflow (strict)

1. **Never commit directly to `main`.** The only exception was the initial bootstrap commit.
2. Before starting any work: `git fetch origin main` and branch from `origin/main`:
   `git switch -c <type>/<short-slug> origin/main`
   Types: `feature/`, `fix/`, `docs/`, `chore/`, `spike/`.
3. One branch per feature or task. Do not reuse branches across unrelated tasks.
4. Open a PR against `main` for every change. The PR description states what changed,
   why, and which scoped agent docs were updated.
5. **Squash-merge only.** Never merge-commit, never rebase-merge. Delete the branch
   after merge.
6. Commits use the repo-local identity (`zayr0-9`, personal noreply email). Never
   commit with a work identity or work email.
7. Keep PRs reviewable: one concern per PR. If a refactor is needed to land a feature,
   land the refactor as its own PR first.

## 2. Type discipline (strict)

- `tsconfig.base.json` strictness is non-negotiable; packages may extend it but never
  weaken it.
- **`any` is a defect until proven otherwise.** Prefer `unknown` plus narrowing. Every
  surviving `any` carries a one-line comment justifying why no better type exists.
- A type assertion (`as`) at a call-site is a symptom of a wrong type at an upstream
  boundary (Zod schema, native module surface, DTO). Fix the boundary, don't cast.
- Dependencies are pinned exactly (`save-exact=true` is set in `.npmrc`); the lockfile
  is always committed.

## 3. Reuse before writing

Before writing a new utility, hook, helper, or component: search `packages/` and the
app you are in for an existing one. Two near-identical helpers differing only by a
value must collapse into one parameterised helper. See
[`docs/engineering-taste/`](engineering-taste/README.md) — read the topic files for the
area you are changing before any substantial change.

## 4. Documentation discipline

All project markdown lives in `docs/`. The docs are scoped so no single file becomes a
dumping ground:

| File | Scope |
|---|---|
| [`agent.md`](agent.md) | This file — repo-wide rules. |
| [`agent_record.md`](agent_record.md) | Rolling 24-hour work log. See rules inside. |
| [`agent_design.md`](agent_design.md) | Design language: UX/UI consistency across mobile and desktop. Read before ANY UI change. |
| [`agent_mobile.md`](agent_mobile.md) | `apps/mobile` — Expo/React Native app. |
| [`agent_native.md`](agent_native.md) | `modules/foldersync-native` — Kotlin module and Android service. |
| [`agent_desktop.md`](agent_desktop.md) | `apps/desktop` — Electron companion. |
| [`agent_protocol.md`](agent_protocol.md) | `packages/contracts`, `packages/protocol`, `packages/test-fixtures` — wire contracts. |
| [`agent_testing.md`](agent_testing.md) | Test strategy and release-blocking invariants. |
| [`engineering-taste/`](engineering-taste/README.md) | Living rulebook of engineering taste. |

**Rules:**

- Before changing code in a scope, read that scope's `agent_<scope>.md`.
- **After making changes, update the relevant scoped file(s) if the change altered
  anything they describe** (structure, decisions, current state, gotchas). If nothing
  they describe changed, no update is needed — do not pad them.
- Log every working session in `agent_record.md` (format and staleness rules are in
  that file).
- New scoped docs follow the `agent_<scope>.md` naming pattern and get a row in the
  table above.
- Do not create a giant catch-all doc. If a scoped file grows past ~200 lines, split it.

## 5. Engineering taste

`docs/engineering-taste/` is the project's living taste rulebook (seeded from distilled,
genericised principles; see its README for how rules graduate). When you correct a
pattern in review or notice a repeated convention, add a candidate rule there. Agents
must not contradict an `active` rule without superseding it explicitly.

## 6. Non-negotiables from the spec (summary — spec section 38 is authoritative)

- Never add `MANAGE_EXTERNAL_STORAGE`; use the system directory picker.
- Sync engine truth lives in Kotlin/Room, never in the JS runtime.
- Never a trust-all TLS client; identity is the pinned key.
- All mutations idempotent; validate all incoming protocol data.
- Deletion invariants: a failed scan never emits deletions; retention cleanup never
  propagates as desktop deletion; desktop deletion means trash, not erasure; the phone
  copy is never deleted before a durable, hash-verified desktop commit.
- Every deletion invariant has a test; destructive safety tests are release blockers.
- Record any change to a major decision as an ADR in `docs/architecture-decisions/`.
