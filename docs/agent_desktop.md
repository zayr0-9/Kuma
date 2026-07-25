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
- `node:sqlite` is the database choice **pending the packaged-app spike** (spec 21.2) —
  record an ADR if it falls through.

## Current state

- Not yet scaffolded. Spikes 3, 4 and 6 (spec 35) land here first.

## Update this file when

The API surface, database schema, storage layout, process placement, or security
posture changes — major decision changes need an ADR.
