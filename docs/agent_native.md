# agent_native.md — Android native module scope

**Scope:** `modules/foldersync-native/` — the Kotlin Expo module: SAF storage access,
Room database, foreground service, discovery, tus uploads, retention cleanup.

**Spec sections to load before working here:** 12 (SAF), 13 (module boundary), 14
(foreground service), 15 (local-network permissions), 16 (Room), 17–19 (scan/upload/
cleanup engines), 26–27 (state machines, renames).

## Hard rules

- **Room is the source of truth** for all sync state. Every crash-survivable state
  transition happens in a transaction (spec 16.2). The service must operate with the
  JS runtime dead.
- SAF only: `ACTION_OPEN_DOCUMENT_TREE` + persisted URI grants. Never
  `MANAGE_EXTERNAL_STORAGE`. Every scan re-verifies root accessibility; inaccessible
  is `access_lost`, never "all files deleted".
- Deletion invariants (release blockers, spec 34.5): no deletions from failed/partial
  scans; two-scan missing confirmation with the 15-minute floor; retention cleanup is
  marked expected _before_ deleting and never propagates to the desktop; phone-side
  SHA-256 must match the desktop hash before any retention deletion (spec 19.2).
- TLS: pinned trust manager accepting only the paired desktop's key. A trust-all
  manager, even temporarily "for debugging", is forbidden.
- Discovery via `NsdManager` in the service; never via JS. Multicast lock held only
  while discovering; wake locks only while scanning/transferring, released in `finally`.
- Uploads: official tus-java/tus-android clients streaming directly from `content://`
  URIs — never copy files into app cache. One active upload (MVP).
- WorkManager is for maintenance/recovery only, never the primary transfer engine.

## Testing here

Unit tests: path construction, scan generations, missing confirmation, cleanup
suppression, backoff, pin comparison, Room migrations. Instrumentation tests on the
physical Samsung device (spec 34.3). Kotlin DTOs are validated against the golden
fixtures in `packages/test-fixtures` (see [`agent_protocol.md`](agent_protocol.md)).

## Current state

- Skeleton in place: `expo-module.config.json`, library `build.gradle` following
  the create-expo-module local template, empty library `AndroidManifest.xml`
  (future home of service/permission declarations, spec 33.6), and
  `FolderSyncModule.kt` exposing only `ping()`. TS surface in `src/index.ts` via
  `requireOptionalNativeModule` (null on stale dev clients).
- **The Kotlin/Gradle side has never been compiled** — no Android toolchain on
  this machine by design (spec 32.1). The first EAS development build is the
  verification of the gradle wiring; expect iteration there.
- Spikes 1, 2 and 5 (spec 35) land here next, before any broad implementation.

## Update this file when

The Room schema, service states, module API surface, or any engine behaviour changes —
and record major decision changes as ADRs in `docs/architecture-decisions/`.
