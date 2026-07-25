# Spike 6 — Desktop atomic commit

**Date:** 2026-07-25
**Status:** PASSED
**Spec reference:** section 35 (spike 6), sections 6.5, 18.5, 22, 28.2

Note: spikes 1–5 require the physical phone and an EAS development build; spike 6
was run first because it is fully verifiable on the desktop alone. The ordering
deviation has no dependency impact.

## What was proven

All verified by automated tests (`apps/desktop/test/commit.test.ts`,
`apps/desktop/test/uploads.test.ts` — 31 tests):

1. **Staging on the destination volume** — uploads land in
   `<destination>/.foldersync-staging/`, guaranteeing same-volume atomic rename.
2. **Verification before visibility** — size check, streaming SHA-256, and
   staged-file fsync all happen before the rename; a size or hash mismatch fails
   the commit without touching the destination.
3. **Atomic move** — one `rename()` makes the file visible. The destination never
   exposes a partial file: after a simulated crash before the rename, the
   destination has no file; after a simulated crash after the rename, it has the
   complete file.
4. **Deterministic recovery** — re-running the commit converges in both crash
   cases: before-rename → commits normally; after-rename → `already_committed`
   (detected via the sha256 recorded by the earlier attempt). Orphaned staging
   files are reclaimed by `garbageCollectStaging` (spec 22.3).
5. **External modification preserved** — a destination that no longer matches the
   last committed version is moved to `.foldersync-conflicts/<timestamp>/<path>`
   before the new version commits (spec 6.5/28.2).
6. **Adopt-in-place** — a destination whose content hash equals the staged hash is
   adopted without a conflict copy or replacement (the re-pair scenario, spec 6.5).
7. **Fastify + @tus/server integration** — tus mounted on Fastify with a
   non-consuming content-type parser for `application/offset+octet-stream` and
   `reply.hijack()` before handing `req.raw`/`reply.raw` to `tus.handle()`.
   A chunked upload with an interruption resumed via HEAD offset discovery and
   committed byte-identically (64 KB + tail payload).

> **Superseded (2026-07-25):** the standalone `api/uploadServer.ts` and its
> `apps/desktop/test/uploads.test.ts` used here were retired when tus was folded
> into the authenticated control server with per-destination staging routing (see
> `desktop-tus-per-destination-staging.md`). The same resumable-upload-then-commit
> proof now lives in `apps/desktop/test/uploadRouting.test.ts`.

## Decisions recorded

- **Reserved-path guard added:** wire paths whose first segment starts with
  `.foldersync-` are rejected at commit (`isReservedRelativePath`) — the wire
  rules alone do not forbid uploading into the managed directories.
- **Windows replace fallback:** POSIX `rename` atomically replaces; Windows
  cannot, so `renameOverwriting` falls back to move-aside-then-rename (brief
  not-present window, never a partial file). The fallback branch is untested
  until Windows is a target (spec phase 6).
- **Hashing is in-process streaming for now.** Worker-thread offload (spec 20.2)
  is an integration concern for the Electron main process, not a correctness
  concern; deferred to the control-API slice.
- **Durability approximation:** staged file fsync before rename + parent-dir
  fsync after. On macOS, true platter durability would need `F_FULLFSYNC`, which
  Node does not expose directly; revisit if commit-durability bugs ever surface.
- **tus upload naming:** `@tus/file-store` default ids for now; the prepare-flow
  slice will supply a `namingFunction` tied to prepare ids (spec 22 shows
  `<prepare-id>.upload`).

## Pass condition

"Destination never exposes partial committed files and recovery is deterministic"
— met, per the crash-simulation and recovery tests.
