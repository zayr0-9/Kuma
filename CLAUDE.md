# FolderSync — agent entry point

All project documentation lives in `docs/`. This file exists only so agents load the
rules automatically. Read in this order, before any work:

1. **`docs/agent.md`** — mandatory repo rules: git workflow (fetch main → branch → PR →
   squash-merge, never commit to main), strict types / no `any`, reuse-before-writing,
   documentation discipline.
2. **`docs/agent_<scope>.md`** for the area you are touching (mobile, native, desktop,
   protocol, testing — index in agent.md).
3. **`docs/agent_design.md`** before any UI change on either app.

The behavioural single source of truth is `docs/foldersync_implementation_spec.md`.
Log your session in `docs/agent_record.md` and purge entries older than 24 hours.
Engineering taste rules: `docs/engineering-taste/`.
