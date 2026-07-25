# Desktop tus staging — one server per destination volume

**Date:** 2026-07-25
**Status:** ACCEPTED
**Spec reference:** sections 18.4, 18.5, 22, 22.3, 6.5

## Context

The phone uploads file bytes with tus (`@tus/server` over the Fastify control
server). The commit sequence (spec 18.5, spike 6) makes a file visible with a
single atomic `rename()` from staging into the destination. `rename()` is atomic
only **within one filesystem**, so staging must live on the same volume as its
destination — `<destination>/.foldersync-staging/` (spec 22). A cross-volume move
is not atomic and would risk a partially written visible file, which spec 6.5
forbids ("if the filesystem cannot atomically move within the destination volume:
fail safely and do not acknowledge").

`@tus/server` binds **one** `FileStore`, and a `FileStore` writes to **one**
directory. FolderSync has **many** destinations, each potentially on a different
volume. So a single tus server cannot serve all destinations while keeping staging
on each destination's volume.

## Decision

Run **one tus server per destination staging directory**, created lazily and cached
in a `Map<stagingDir, TusServer>`. Every incoming tus request is routed to the
right server by resolving its **prepare** first:

- The staged file is named by its **prepare id** (`namingFunction` returns the
  prepare id from tus metadata). The id is a validated uuid bound to a prepare the
  authenticated device owns — never a client-chosen path. This also lets staging GC
  reconcile the directory against `upload_prepare` (spec 22.3) and lets commit find
  the file.
- On **creation** (`POST /v1/uploads`) the prepare id is read from the
  `Upload-Metadata` header (tus assigns the URL only after naming); on every other
  verb it is the last path segment of `/v1/uploads/:id`.
- The route handler validates the prepare (owned, non-terminal, unexpired) and
  resolves its mapping's destination **before** `reply.hijack()`, so a rejected
  upload gets the structured JSON error envelope (`unauthorised`,
  `upload_not_found`, `upload_expired`, `bad_request`) instead of a hung socket.
- Authorisation is the same `onRequest` hook as every other non-public route
  (bearer token + protocol-version gate); the tus client attaches both headers
  (spec 18.2).

## Alternatives considered

- **Central staging directory, copy to the destination volume at commit** —
  rejected: the copy across volumes is not atomic and defeats spec 6.5's
  same-volume-rename guarantee; it also doubles the write of every multi-GB file.
- **A custom multi-root `DataStore`** — rejected for the MVP: more code to maintain
  than a small server cache, and it would re-implement what the maintained
  `@tus/file-store` already does correctly per directory.

## Consequences

- One `TusServer` + `FileStore` is held per active destination for the process
  lifetime. Destinations are few (one per mapped root), so the cache is small.
- This supersedes the standalone `api/uploadServer.ts` from spike 6 (single
  `stagingDir`, no auth). The transport now lives in `api/uploadRouting.ts`, folded
  into the authenticated control server; the end-to-end resumable-upload proof moved
  to `apps/desktop/test/uploadRouting.test.ts`.
- Not yet wired: the commit trigger on upload finish (the hook sets the prepare to
  `uploaded`; the commit slice consumes it), worker-thread hashing, and enforcing
  `Upload-Length` against the prepare's `expected_size`.
