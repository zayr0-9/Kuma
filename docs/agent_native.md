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

- Gradle wiring: `expo-module.config.json`, library `build.gradle` following the
  create-expo-module local template, empty library `AndroidManifest.xml` (SAF needs
  no permissions; service/permission declarations land with spike 2, spec 33.6).
  TS surface in `src/index.ts` via `requireOptionalNativeModule` (null on stale dev
  clients).
- **Spike 1 (SAF persistence + traversal) implemented** — `FolderSyncModule.kt`
  exposes `pickDirectory`, `listPersistedPermissions`, `checkAccess`,
  `traverseTree`, `deleteDocument`, `releasePermission` (plus the original `ping`).
  Traversal uses the fast `DocumentsContract` + `ContentResolver` bulk-cursor path
  (not `DocumentFile.listFiles()`) for the 10,000-file target; relative paths follow
  spec 12.6 (NFC, `/`, reject `.`/`..`/NUL). Design + on-device checklist:
  [`architecture-decisions/spike-1-saf-persistence-traversal.md`](architecture-decisions/spike-1-saf-persistence-traversal.md).
  Room persistence of roots/file entries is deliberately NOT here yet — it lands
  with the scan engine (spec 16, 17).
- **The Kotlin/Gradle side has never been compiled** — no Android toolchain on
  this machine by design (spec 32.1). The first EAS development build carrying this
  module is the verification of both the gradle wiring and the SAF Kotlin; expect
  iteration there, and record the spike-1 pass conditions on the physical device.
- Spikes 2 (foreground service) and 5 (tus direct URI upload, spec 35) land here
  next, before any broad implementation.

## Update this file when

The Room schema, service states, module API surface, or any engine behaviour changes —
and record major decision changes as ADRs in `docs/architecture-decisions/`.
