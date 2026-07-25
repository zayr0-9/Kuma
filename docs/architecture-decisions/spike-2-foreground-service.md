# Spike 2 — Native foreground service

**Date:** 2026-07-25
**Status:** IMPLEMENTED — on-device verification pending the dev build carrying this module
**Spec reference:** section 35 (spike 2), section 14 (foreground service), 5.3 (notification), 33.6 (manifest ownership)

## What was built

- `FolderSyncService.kt` — an Android foreground service that runs a simulated per-second
  work tick independent of the JS runtime, shows a notification with **Pause / Resume /
  Stop** actions, and persists its state (`running`/`paused`/`stopped`, tick count,
  timestamp) to a `SharedPreferences` cell on every change.
- Library `AndroidManifest.xml` (spec 33.6) — the service declaration
  (`foregroundServiceType="connectedDevice"`, `exported=false`) and its permissions.
- Module control surface (`FolderSyncModule.kt`): `startSyncService` (also resumes),
  `pauseSyncService`, `stopSyncService`, `getServiceStatus`. POST_NOTIFICATIONS is requested
  best-effort on start (spec 14.4).
- TS surface + `apps/mobile/src/native/service.ts` wrapper, and a harness at
  `apps/mobile/app/spike-service.tsx` (Start/Pause/Resume/Stop + 1 s status polling + the
  manual-check list + a Samsung battery note).

## Decisions

- **`connectedDevice` service type (spec 14.2).** This is the intended primary type — the
  phone maintains a network connection to the paired desktop. The declared network
  permissions (`INTERNET`, `ACCESS_NETWORK_STATE`, `CHANGE_NETWORK_STATE`,
  `CHANGE_WIFI_MULTICAST_STATE`) satisfy its runtime prerequisites. Whether Play policy
  accepts this categorisation is **spike 7**, not this spike; spike 2 only proves the
  service runs.
- **`SharedPreferences` for the spike's durable state, not Room — deliberately.** The
  subject of spike 2 is the service _lifecycle_; Room is the committed source of truth for
  real sync state (spec 16, 11.5) and its Gradle/ksp wiring is a distinct risk area that
  lands with the scan engine. Keeping them in separate branches means a failed native build
  points at one concern, not two. The spike's cell is explicitly not sync state — it is a
  progress marker that proves "state stays coherent while the JS runtime is dead".
- **Correctness from persisted state, `START_STICKY` only to observe restart (spec 14.5).**
  On a null-intent (sticky) restart the service reads its state back from the cell and
  resumes. The spec's rule — "persisted queues, not sticky behaviour, provide correctness"
  — is honoured: stickiness is an observation lever here, not the correctness mechanism.
- **Framework `Notification` API with version guards, not `NotificationCompat`.** Avoids
  depending on `androidx.core` being on the module's compile classpath (it is a transitive
  `implementation` dep of expo-modules-core, not necessarily exposed), minimising
  first-build risk. `Notification.Builder(context, channelId)` and the 3-arg
  `startForeground(id, notification, type)` are guarded by SDK level.
- **Partial wake lock, held only while working, released in `finally` (spec 14.6),** with a
  10-minute safety timeout so a mid-work process kill cannot leak it.
- **Pull-based status.** `getServiceStatus` reads the persisted cell, so it is correct after
  the JS runtime (and this module instance) were torn down and the service restarted. The
  `serviceStatusChanged` event (a freshness hint only, spec 13.3) is deferred to the real
  engine.

## On-device verification (pass condition: service and persisted state remain coherent without the JS runtime)

The Kotlin cannot compile on this machine (spec 32.1); an EAS development build plus a run
on the physical Samsung confirms each spike bullet. Record results here:

- [ ] Start while the app is visible — notification appears, steps advance.
- [ ] Background the app (Home) — steps keep advancing; on return the count is continuous.
- [ ] Swipe the app away from Recents — notification stays, steps keep advancing.
- [ ] Pause / Resume / Stop from the notification actions all work.
- [ ] Kill from Recents / force process pressure, then reopen — `getServiceStatus` shows a
      coherent state and the tick count did not reset (persisted-cell coherence).
- [ ] Record the **Android version** and the **Samsung battery setting** for FolderSync, and
      whether the service survived aggressive battery management (spec 14.8).

## Deferred

- Room-backed durable queue (spec 16) — replaces the SharedPreferences cell with the scan
  engine.
- The real work: network callbacks, discovery loop, scan, upload, retention cleanup (spec
  14.1, 17–19). The tick is a stand-in.
- `BOOT_COMPLETED` restart decision per target SDK / service type (spec 14.3) — must be
  tested, not guessed.
- `CompanionDeviceManager` association to strengthen the `connectedDevice` classification
  (spec 14.2) — evaluate with spike 7.
- The user-facing OEM battery-guidance screen (spec 14.8) — this spike only _records_ the
  Samsung behaviour it must address.
- `serviceStatusChanged` event emission (spec 13.3).
