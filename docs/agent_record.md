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
