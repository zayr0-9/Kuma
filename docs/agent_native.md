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
  create-expo-module local template. TS surface in `src/index.ts` via
  `requireOptionalNativeModule` (null on stale dev clients).
- **Library `AndroidManifest.xml` now declares the foreground service + permissions**
  (spec 33.6 — the library manifest is their source of truth, merged into the app).
  Service type is `connectedDevice` (spec 14.2 intended primary); permissions:
  FOREGROUND_SERVICE(+\_CONNECTED_DEVICE), POST_NOTIFICATIONS, WAKE_LOCK, INTERNET,
  ACCESS/CHANGE_NETWORK_STATE, CHANGE_WIFI_MULTICAST_STATE.
- **Spike 1 (SAF persistence + traversal) implemented** — `FolderSyncModule.kt`
  exposes `pickDirectory`, `listPersistedPermissions`, `checkAccess`,
  `traverseTree`, `deleteDocument`, `releasePermission` (plus the original `ping`).
  Traversal uses the fast `DocumentsContract` + `ContentResolver` bulk-cursor path
  (not `DocumentFile.listFiles()`) for the 10,000-file target; relative paths follow
  spec 12.6 (NFC, `/`, reject `.`/`..`/NUL). Design + on-device checklist:
  [`architecture-decisions/spike-1-saf-persistence-traversal.md`](architecture-decisions/spike-1-saf-persistence-traversal.md).
  Room persistence of roots/file entries is deliberately NOT here yet — it lands
  with the scan engine (spec 16, 17).
- **Spike 2 (foreground service) implemented** — `FolderSyncService.kt` is a
  `connectedDevice` foreground service running a simulated per-second tick
  independent of the JS runtime, with a Pause/Resume/Stop notification, a partial
  wake lock held only while working (spec 14.6), and state persisted to a
  `SharedPreferences` cell (the spike's durable store; Room replaces it with the
  scan engine — the Room+ksp gradle wiring is intentionally its own branch so a
  failed build isolates one concern). Module surface: `startSyncService` (also
  resumes), `pauseSyncService`, `stopSyncService`, `getServiceStatus` (reads the
  persisted cell — correct even after JS death). Design + on-device checklist:
  [`architecture-decisions/spike-2-foreground-service.md`](architecture-decisions/spike-2-foreground-service.md).
  **Spikes 1 + 2 are device-verified** (Samsung).
- **Spikes 3 (DNS-SD discovery) + 4 (pinned-TLS pairing) implemented** —
  `NsdDiscovery.kt` browses `_foldersync._tcp` via `NsdManager` (classic
  discover+resolve, single-flight resolve queue, multicast lock; pull model
  `startDiscovery`/`stopDiscovery`/`getDiscoveredDesktops`). Pairing:
  `PinnedTls.kt` (custom single-key `X509TrustManager` pinning `SHA-256(SPKI)` — NOT
  `CertificatePinner`, which can't validate a self-signed cert — accept-only-pinned,
  never trust-all), `PairingManager.kt` (`startPairingFromQr` parses the QR grammar,
  `POST /v1/pair` over the pinned client via **`org.json`**, persists the paired
  desktop), `TokenVault.kt` (bearer token encrypted at rest via **AndroidKeyStore
  AES/GCM**). `build.gradle` gained `implementation 'com.squareup.okhttp3:okhttp:4.9.2'`
  (byte-identical to RN's bundled okhttp; not on the local module's compile classpath
  otherwise). No manifest change. Design + on-device checklists:
  [spike-3](architecture-decisions/spike-3-mdns-discovery.md),
  [spike-4](architecture-decisions/spike-4-pinned-tls.md). In-app camera QR scanning is
  deferred to the Phase-1 pairing UI (paste the QR string for the spike).
- **Build status:** spikes 1 + 2 compiled green on EAS and passed on-device. Spikes 3 + 4
  are written but the Kotlin has never compiled here (no Android toolchain, spec 32.1) —
  the next EAS build is their first compile; record their pass conditions on the Samsung.
- Spike 5 (tus direct URI upload, spec 35) lands here next. Then the real scan
  engine + Room DB (spec 16, 17) turn spike 1's traversal and spike 2's tick into
  persisted `file_entry`/queue state, and the service's real work (discovery loop,
  scan, upload, cleanup — spec 14.1) replaces the tick. The discovery + pinned-TLS
  clients here become that engine's building blocks.

## Update this file when

The Room schema, service states, module API surface, or any engine behaviour changes —
and record major decision changes as ADRs in `docs/architecture-decisions/`.
