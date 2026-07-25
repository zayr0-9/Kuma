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

### 2026-07-26T00:03+0100 — spike/3-4-android-discovery-pairing — Spikes 3 + 4: Android discovery + pinned-TLS pairing (implemented)

- **Done:** the "find and connect to the desktop" pair, one branch. **Spike 3** —
  `NsdDiscovery.kt` browses `_foldersync._tcp` via `NsdManager` (classic discover+resolve
  with a single-flight resolve queue to dodge the API-34 concurrent-resolve failure;
  multicast lock held only while discovering; TXT `v/id/name/tls` decoded as ASCII). Pull
  model: `startDiscovery`/`stopDiscovery`/`getDiscoveredDesktops`; the harness polls.
  **Spike 4** — `PinnedTls.kt` is a **custom single-key `X509TrustManager`** pinning
  `SHA-256(SPKI)` (base64url, decoded `URL_SAFE|NO_PADDING|NO_WRAP`, constant-time
  `MessageDigest.isEqual`) — NOT OkHttp `CertificatePinner` (which never runs for a
  self-signed cert); accept-only-pinned, hostname bypassed (key is the identity), never
  trust-all. `PairingManager.kt` parses the `foldersync://pair?…` QR (mirrors the contracts
  grammar), `POST /v1/pair` over the pinned client via **`org.json`** (no kotlinx-
  serialization plugin), and persists the paired desktop; `TokenVault.kt` encrypts the
  bearer token with **AndroidKeyStore AES/GCM**. `build.gradle` gained `implementation
'com.squareup.okhttp3:okhttp:4.9.2'` (byte-identical to RN's bundled okhttp — the
  expo-asset precedent). Module surface + TS DTOs + `discovery.ts`/`pairing.ts` wrappers +
  `app/spike-pairing.tsx` harness (discovery list + paste-QR pairing + paired list/remove).
  **No manifest change; no expo-camera.**
- **How it was grounded (ultracode):** a 4-agent research workflow read the desktop
  `identity.ts`/`controlServer.ts`/`advertise.ts` + golden fixtures and validated the risky
  Android APIs; 2 agents (discovery, TLS/keystore/gradle) succeeded, 2 (pairing, camera) hit
  the structured-output cap so I ground those directly. I independently verified the
  security-critical facts (pin = `base64url(sha256(spki))` = Kotlin
  `sha256(cert.publicKey.encoded)`; `/v1/pair` public, no protocol header). Then an
  **adversarial review subagent** checked the Kotlin against okhttp 4.9.2 / org.json /
  NsdManager / Keystore / Expo DSL in `node_modules`: **no blockers**, pinning confirmed
  correct, `warningsAsErrors` not applied on the consumer path. One fix applied
  (`stopDiscovery` returned `Unit?` → made definite `Unit`).
- **Design calls:** in-app camera QR scanning deferred to the Phase-1 pairing UI (spike's
  risk is the TLS handshake, not scanning) — paste the QR string; keeps the branch free of a
  native dep + config plugin. Discovery is pull (consistent with spike 2), events deferred.
  Token stored per single desktop (MVP one-phone-one-desktop); Room-backed multi-device is
  the engine's job.
- **Gates (headless):** typecheck, lint, 249 tests, `expo export`, prettier — all green.
- **Verification boundary:** Kotlin cannot compile here (spec 32.1). A cloud EAS dev build
  was triggered after push (see follow-ups) — first compile of the discovery + pairing
  Kotlin; a Samsung run confirms the pass conditions (discover the desktop; pair via QR
  paste; reject a wrong cert → `pin_mismatch`; survive IP change).
- **Files:** `modules/foldersync-native/android/src/main/java/expo/modules/foldersync/{NsdDiscovery,PinnedTls,TokenVault,PairingManager}.kt (new),FolderSyncModule.kt}`,
  `modules/foldersync-native/android/build.gradle`, `modules/foldersync-native/src/index.ts`,
  `apps/mobile/src/native/{discovery,pairing}.ts (new)`,
  `apps/mobile/app/{spike-pairing.tsx (new),_layout.tsx,index.tsx}`,
  ADRs `spike-3-mdns-discovery.md` + `spike-4-pinned-tls.md` (Android-half sections).
- **PR:** branch `spike/3-4-android-discovery-pairing` pushed — open + squash-merge.
- **Docs updated:** `agent_native.md`, `agent_mobile.md`, spike-3 + spike-4 ADRs, this record.
- **Update (device testing, ~00:55):** the first EAS build **compiled green** (discovery +
  pairing Kotlin all linked — no okhttp/NsdManager/Keystore issues; the grounding + review
  paid off). On device, two findings: (1) the app's `foldersync` deep-link scheme
  (app.config.ts) collides with the pairing QR's `foldersync://` scheme, so scanning with an
  EXTERNAL reader routes the link into the dev-client launcher and errors — **so I added
  in-app QR scanning** (`expo-camera ~57.0.3`, `CameraView`; config plugin + camera permission
  in app.config.ts) which reads the QR bytes directly, bypassing Android deep-linking. (2) To
  keep a dev client that predates expo-camera from crashing the whole screen (missing native
  `ExpoCamera`), the scanner is isolated in `src/components/QrScanner.tsx`, **lazy-loaded and
  gated on `requireOptionalNativeModule('ExpoCamera')`** — degrades to paste-only + discovery
  still work. Adding expo-camera **needs a fresh EAS build**; a second build was triggered.
- **Follow-ups:** verify the second EAS build (with expo-camera) goes green, install on the
  Samsung, then: **discovery** (Start discovery, desktop on same Wi-Fi → it appears);
  **pairing** (run the desktop, open its pairing window, tap **Scan QR** in the harness →
  point at the desktop QR → pairs); **reject** (point at a different self-signed cert on the
  same host:port → `pin_mismatch`). Record spike-3 + spike-4 pass conditions in their ADRs.
  Next Android spike: **5 (tus direct URI upload)**. Then the scan engine + Room DB and the
  phone's Phase-1 path.

### 2026-07-25T19:16+0100 — spike/2-foreground-service — Spike 2: native foreground service (Android half implemented)

- **Done:** the second Android spike. `FolderSyncService.kt` is a `connectedDevice`
  foreground service (spec 14.2 intended primary type) that runs a simulated per-second
  tick **independent of the JS runtime**, shows a notification with **Pause / Resume /
  Stop** actions, holds a partial wake lock only while working (released in `finally` +
  10-min safety timeout, spec 14.6), and persists its state (`running`/`paused`/`stopped`
  - tick count + timestamp) to a `SharedPreferences` cell with `commit()` on every change.
    `START_STICKY` plus reading the cell back on a null-intent restart means **correctness
    comes from the persisted state, not stickiness** (spec 14.5); `onTaskRemoved` keeps the
    service alive on swipe-away. The library `AndroidManifest.xml` now declares the service +
    permissions (spec 33.6). Module surface added: `startSyncService` (also resumes),
    `pauseSyncService`, `stopSyncService`, `getServiceStatus` (reads the cell — correct even
    after JS death); POST_NOTIFICATIONS requested best-effort on start (spec 14.4). TS: new
    `ServiceState`/`ServiceStatus` DTOs; `src/native/service.ts` wrapper; the not-linked
    guard was extracted to a shared `src/native/module.ts` (`requireNative`/`isNativeLinked`)
    reused by saf.ts + service.ts (DRY, agent.md §3), and the harness Button collapsed into a
    shared `src/components/SpikeButton.tsx` (used by both harnesses). New harness
    `app/spike-service.tsx` (Start/Pause/Resume/Stop + 1 s status polling + the 6-bullet
    manual-check list + a Samsung battery note). Gates green **as far as headless allows**:
    workspace typecheck + lint + 249 tests, and a real `expo export --platform android` (both
    spikes bundle). No new TS unit tests — the surface is Kotlin + device-verified.
- **Design call (ADR `spike-2-foreground-service.md`):** used `SharedPreferences` for the
  spike's durable cell, **not Room** — the spike's subject is the service lifecycle, and
  Room's Gradle/ksp wiring is a distinct risk area that lands with the scan engine, so a
  failed native build isolates one concern. The cell is a progress marker, not sync state;
  Room remains the committed source of truth (spec 16/11.5). Framework `Notification` API
  (version-guarded) over `NotificationCompat` to avoid an androidx-classpath assumption and
  minimise first-build risk. Status is pull-based; `serviceStatusChanged` (a freshness hint,
  spec 13.3) is deferred.
- **Verification boundary:** Kotlin cannot compile here (spec 32.1). A cloud EAS dev build
  was **triggered this session** (see follow-ups) and a Samsung run is owed to confirm the
  pass conditions (survives background/swipe-away/process pressure; coherent state after JS
  death; Android version + Samsung battery behaviour recorded). ADR carries the checklist.
- **Files:** `modules/foldersync-native/android/src/main/java/expo/modules/foldersync/{FolderSyncService.kt (new),FolderSyncModule.kt}`,
  `modules/foldersync-native/android/src/main/AndroidManifest.xml`,
  `modules/foldersync-native/src/index.ts`,
  `apps/mobile/src/native/{module.ts (new),service.ts (new),saf.ts}`,
  `apps/mobile/src/components/SpikeButton.tsx` (new),
  `apps/mobile/app/{spike-service.tsx (new),spike-saf.tsx,_layout.tsx,index.tsx}`,
  ADR `docs/architecture-decisions/spike-2-foreground-service.md` (new).
- **PR:** branch `spike/2-foreground-service` pushed — open + squash-merge.
- **Docs updated:** `agent_native.md` (service + manifest state), `agent_mobile.md`
  (`module.ts`/`service.ts` + service harness + SpikeButton), new ADR, this record.
- **Build update:** first EAS build (`8120ff53`) ERRORED at `processDebugManifest` — the
  library manifest comment contained `expo prebuild --clean`, and a literal `--` is illegal
  inside an XML comment (ManifestMerger2 parse error). Fixed in commit `8adf0e1` (reworded
  the comment; also moved `@Suppress("DEPRECATION")` to function scope). **Rebuild
  `32305140` is GREEN** — the first successful compile of ALL native Kotlin (SAF spike 1 +
  service spike 2). APK:
  `https://expo.dev/artifacts/eas/pfQOybazK0rCqrLB5mWSiYlG3dIBlnb2QUEKxgN_aB8.apk`.
  Lesson: never put `--` inside an XML comment in a library manifest.
- **Follow-ups:** install the green APK on the Samsung and run **both** spike harnesses from
  the home screen — record spike-1 (restart/reboot persistence, ~10k-file traverse time,
  controlled delete) and spike-2 (background/swipe-away/process-kill coherence, Android
  version + Samsung battery behaviour) pass conditions in their ADRs. The dev client carries
  both spikes, so this also closes spike 1's device checklist. Next Android spike: **5 (tus
  direct URI upload)**. Then the scan engine + Room DB (spec 16/17) and the phone's Phase-1
  wiring (pair → pick → scan → upload → resume → status).

### 2026-07-25T18:45+0100 — spike/1-saf-persistence-traversal — Spike 1: SAF persistence + traversal (Android half implemented)

- **Done:** the first Android/native slice — the SAF surface of the Kotlin module
  (`FolderSyncModule.kt`), its TS surface, a mobile wrapper, and a device harness. Kotlin
  now exposes `pickDirectory` (ACTION_OPEN_DOCUMENT_TREE with read/write/persistable/prefix
  flags → `takePersistableUriPermission` with only the granted flags; result plumbed via
  `OnActivityResult`, req `0x5AF1`), `listPersistedPermissions` (proves restart persistence
  from `persistedUriPermissions`), `checkAccess` (spec-12.3 root re-test),
  `traverseTree(uri, sampleLimit)`, `deleteDocument`, `releasePermission` (plus the original
  `ping`). **Traversal uses the fast `DocumentsContract` + `ContentResolver` bulk-cursor
  path** (one query per dir, 5-column projection, BFS with an explicit queue — not
  `DocumentFile.listFiles()`), returning aggregate counts / total bytes / wall-clock ms /
  unreadable-dir + skipped-entry counts + a capped sample; the bridge never carries 10k
  rows. Relative paths follow spec 12.6 (NFC, `/`, reject `.`/`..`/NUL → counted as
  skipped). No manifest permissions needed (SAF grants scoped access; never
  MANAGE_EXTERNAL_STORAGE). TS: `modules/foldersync-native/src/index.ts` grows the typed
  interface + DTOs (`PickedDirectory` union, `TraversalResult`, …); `apps/mobile/src/native/
saf.ts` wraps them (throws `NativeModuleUnavailableError` when unlinked). Harness at
  `app/spike-saf.tsx` (route + home link): pick / list grants / check access / traverse /
  per-file controlled delete behind a confirm dialog. Gates green **as far as headless
  allows**: workspace typecheck + lint + 249 tests, and a real `expo export --platform
android` (1191 modules → Hermes). No new TS unit tests — the surface is Kotlin +
  device-verified (spec 34.3), consistent with spikes 3/4/6 landing testable halves.
- **Verification boundary:** the Kotlin cannot compile on this machine (no Android
  toolchain, spec 32.1). **An EAS dev build carrying this module + a run on the physical
  Samsung is owed** to confirm the spike-1 pass conditions (restart persistence across
  process + reboot, complete traversal incl. a ~10k-file tree with a recorded `elapsedMs`,
  controlled deletion). The ADR carries the on-device checklist to fill in.
- **Design call:** the spike proves SAF _itself_ only — **Room persistence of roots/file
  entries is deliberately NOT here** (it lands with the scan engine, spec 16/17), nor is
  overlap detection (12.5), quiescence or the two-scan missing-file rule (17.3–17.5). The
  harness is a developer diagnostics screen (raw counts/absolute values per agent_design
  §4), not a product surface — the §5 parity checklist does not apply to it yet.
- **Files:** `modules/foldersync-native/android/src/main/java/expo/modules/foldersync/FolderSyncModule.kt`,
  `modules/foldersync-native/src/index.ts`, `apps/mobile/src/native/saf.ts` (new),
  `apps/mobile/app/spike-saf.tsx` (new), `apps/mobile/app/{_layout,index}.tsx`,
  ADR `docs/architecture-decisions/spike-1-saf-persistence-traversal.md` (new).
- **PR:** branch `spike/1-saf-persistence-traversal` pushed — open + squash-merge.
- **Docs updated:** `agent_native.md` (SAF surface + fast-cursor decision + verification
  boundary), `agent_mobile.md` (`src/native/saf.ts` + harness), new ADR, this record.
- **Follow-ups:** run the EAS dev build + device spike and record results in the ADR. Next
  Android spikes: **2 (foreground service)** and **5 (tus direct URI upload)**. Then the
  real scan engine + Room DB (spec 16/17) turn this traversal into persisted `file_entry`
  state and wire the phone into Phase 1 (pair → pick → scan → upload → resume → status).
  Desktop side of Phase 1 remains complete and merged.

### 2026-07-25T15:35+0100 — feature/phase1-pairing-completion — Pairing-completion push, main→renderer (spec 24.3/20.1)

- **Done:** a completed pairing now reaches the UI live, retiring the manual Refresh. The
  control server takes an optional `onPairingComplete(event)` callback, fired **only on a
  successful `POST /v1/pair`** — after the secret is consumed and the device persisted —
  with the phone's public identity only (`{deviceId, displayName, pairedAt}`); the issued
  token and the pairing secret never enter the event (spec 20.1). `backend.ts` fans it
  out through a plain listener `Set` (`backend.onPairingComplete(listener)` returns an
  unsubscribe; keeps the backend electron-free). `main/ui/ipc.ts` subscribes and
  `webContents.send`s `pairing:completed` to every window, unsubscribing on dispose.
  Preload exposes `folderSync.pairing.onPaired(listener) → unsubscribe`, stripping the
  `IpcRendererEvent` so the renderer only ever sees the payload. `PairingPanel` swaps the
  QR for **"Paired with {name}. Add a folder below to back it up."**; `DestinationsPanel`
  refreshes on the same event (manual Refresh kept as a fallback). Shared DTO
  `PairingCompletedEvent` + the `completed` channel added to `src/shared/pairing.ts`. 2
  new tests (controlServer: fires with the exact payload and asserts the serialised event
  contains neither the token nor the secret on success; stays silent on a wrong-secret
  and a malformed pair). 177 desktop / 249 workspace green; lint/typecheck/format clean.
  **Verified by a real `pnpm build`** (preload emits `pairing:completed`).
- **Design call:** the push is a one-way main→renderer event, distinct from the
  `invoke`-style request bridges — the backend stays electron-free by emitting to a
  listener set, and the only electron-aware piece (`webContents.send`) lives in the IPC
  glue. Fired post-persist so the renderer's refresh always sees the new device. The
  **manual-code** pairing fallback stays deferred (it would expose a typeable secret to
  the renderer, against the governing hard rule — needs a short-code scheme first).
- **Files:** `apps/desktop/src/shared/pairing.ts` (`completed` channel +
  `PairingCompletedEvent`), `apps/desktop/src/main/api/controlServer.ts`
  (`onPairingComplete` context + fire in pair route),
  `apps/desktop/src/main/backend.ts` (listener set + `onPairingComplete`),
  `apps/desktop/src/main/ui/ipc.ts` (subscribe + `webContents.send`),
  `apps/desktop/src/preload/index.ts` (`onPaired`),
  `apps/desktop/src/renderer/src/{PairingPanel.tsx,DestinationsPanel.tsx,env.d.ts}`,
  `apps/desktop/test/controlServer.test.ts`.
- **PR:** branch `feature/phase1-pairing-completion` pushed — open + squash-merge.
- **Docs updated:** `agent_design.md` §7 (pairing-completion built + wording),
  `agent_desktop.md` (pairing-completion state, trimmed "not yet built"), this record.
- **Follow-ups:** the renderer push round trip (QR → "Paired with {name}" + destinations
  auto-refresh) is owed a manual launch — the emit seam is unit-tested, the
  `webContents.send`/`onPaired`/React wiring is not (same boundary as the other UI
  slices). Next surfaces: the **history/events** view (spec §5 event rows — needs an
  `event_log` repo + IPC), the **manual-code** pairing fallback (short-code scheme), and
  destination **rename/remove** + phone-folder policy editing. Also open: safeStorage key
  wrapping, `Upload-Length` vs `expected_size`, periodic staging GC, a hash-worker pool,
  and splitting `controlServer.ts` into `api/routes/*` in the next slice that touches it.

### 2026-07-25T14:42+0100 — feature/phase1-desktop-ui-last-synced — Last-synced on the destination card (spec 25.2, design §5)

- **Done:** completes the §5 destination-card fields. A bound destination now shows
  **"Last backed up {relative}"** (e.g. "Last backed up 2 minutes ago") or **"No backups
  yet"** before its first commit. New repo read
  `files.getLastCommittedAt(phoneDeviceId, rootId)` — `MAX(remote_file.committed_at)`,
  ISO-UTC so MAX compares lexicographically; kept even for trashed files so it reflects
  the last time anything was written here; null before any commit. It feeds a new
  `lastSyncedAt` field on the existing `status:get` DTO — **no new IPC channel**, so the
  preload is unchanged. Rendered with a new pure `formatRelativeTime(iso, nowMs)` in
  `src/shared/format.ts` (`Date.now()` injected for testability; future/clock-skew and
  just-now both read "just now"; relative per §4, absolute stays in history/diagnostics).
  5 new tests (statusController: last-synced reflects the most recent commit, null before
  any; formatRelativeTime matrix incl. singular/plural, days, future, unparseable). 175
  desktop / 247 workspace green; lint/typecheck/format clean. **Verified by a real `pnpm
build`**.
- **Design call:** "last synced" is sourced from `remote_file.committed_at` (the current
  truth per path, retained through trash) rather than joining `remote_version` history —
  simpler, one table, and still honest about the last write. Wording is **"Last backed
  up"** (not "synced") to match the product's phone→desktop framing; recorded as the
  canonical rendering of the §5 field in agent_design §7.
- **Files:** `apps/desktop/src/main/db/repositories/files.ts` (`getLastCommittedAt`),
  `apps/desktop/src/shared/{status.ts,format.ts}` (`lastSyncedAt` field,
  `formatRelativeTime`), `apps/desktop/src/main/ui/statusController.ts` (populate it),
  `apps/desktop/src/renderer/src/DestinationsPanel.tsx` (render it),
  `apps/desktop/test/{statusController,format}.test.ts`.
- **PR:** branch `feature/phase1-desktop-ui-last-synced` pushed — open + squash-merge.
- **Docs updated:** `agent_design.md` §7 (last-synced wording), `agent_desktop.md`
  (last-synced state, trimmed "not yet built"), this record.
- **Follow-ups:** with the destination card complete, the next natural surface is either
  live **pairing-completion feedback** (main→renderer push to retire the manual Refresh,
  plus a **manual-code** pairing fallback) or the **history/events** view (spec §5 event
  rows — needs an `event_log` repo + IPC). Also still open: destination **rename/remove**
  and phone-folder policy editing; safeStorage key wrapping; `Upload-Length` vs
  `expected_size`; periodic staging GC; a hash-worker pool; the manual packaged-app
  launch (all `status:*` / `destinations:*` / `devices:*` / `pairing:*` round trips +
  worker via a real commit). Split `controlServer.ts` into `api/routes/*` in the next
  slice that touches it.

### 2026-07-25T14:35+0100 — feature/phase1-desktop-ui-sync-status — Desktop sync-status on the destination card (spec 25.2, design §5)

- **Done:** the destination card now shows live status. A new electron-free
  `main/ui/statusController.ts` (`createStatusController` → `getStatus`, unit-tested)
  assembles the desktop's own status view over `status:get`: for **every** destination
  `roots.list()` returns (bound or not, keyed by mappingId) it reports free space
  (`freeBytes` / `destinationAvailable` via injectable statfs — a failed statfs is
  surfaced as unavailable, not a throw), the two policies (null until the phone binds),
  and the per-destination commit backlog. This is deliberately richer than the
  phone-facing `GET /v1/sync/status` (device-scoped, bound-only) because the management
  UI shows a folder's free space before any phone links to it. `main/ui/statusIpc.ts`
  (`registerStatusIpc`) is the thin electron glue, disposed on quit; preload exposes
  `folderSync.status.get`. `DestinationsPanel` merges the status into each card:
  **"{size} free"** (e.g. "931 GB free"), **"· {n} waiting to commit"** appended when a
  backlog exists, the §1 canonical policy labels once bound, and **"Destination
  unavailable"** for an unreadable volume (a calm Needs-attention state, never implied
  loss). New repo method `files.countPendingCommitsForRoot`; the statfs default was
  extracted to `main/storage/diskSpace.ts` (`freeBytesOnVolume`) and now backs both the
  prepare disk-space gate and this view (DRY). `formatBytes` in `src/shared/format.ts`
  (pure, unit-tested). 8 new tests (statusController: free space for all destinations +
  policies only once bound, unavailable volume, per-root + total pending; formatBytes
  matrix). 170 desktop / 242 workspace green; lint/typecheck/format clean. **Verified by
  a real `pnpm build`** (preload emits `status:get`).
- **Design call:** the desktop status view intentionally diverges from the wire endpoint
  (all destinations incl. unbound + policies, keyed by mappingId) — the local UI is not
  a client of its own bearer-authed HTTP server. The card's remaining §5 field is **last
  synced** (needs commit timestamps surfaced per destination), left for a later slice.
- **Files:** `apps/desktop/src/shared/{status,format}.ts` (new),
  `apps/desktop/src/main/ui/{statusController,statusIpc}.ts` (new),
  `apps/desktop/src/main/storage/diskSpace.ts` (new; `controlServer.ts` now imports it),
  `apps/desktop/src/main/db/repositories/files.ts` (`countPendingCommitsForRoot`),
  `apps/desktop/src/main/index.ts` (register/dispose), `apps/desktop/src/preload/index.ts`,
  `apps/desktop/src/renderer/src/{DestinationsPanel.tsx,env.d.ts}`,
  `apps/desktop/test/{statusController,format}.test.ts` (new).
- **PR:** branch `feature/phase1-desktop-ui-sync-status` pushed — open + squash-merge.
- **Docs updated:** `agent_design.md` §7 (status card wording), `agent_desktop.md`
  (sync-status UI state, trimmed "not yet built"), this record.
- **Follow-ups:** the card's **last synced** field; live **pairing-completion feedback**
  (main→renderer push; manual Refresh meanwhile) + **manual-code** pairing fallback;
  destination **rename/remove** + phone-folder policy editing; safeStorage key wrapping;
  `Upload-Length` vs `expected_size`; periodic staging GC; a hash-worker pool; the manual
  packaged-app launch (pairing QR, folder picker, `status:*`/`destinations:*`/`devices:*`
  round trips, worker via a real commit). Split `controlServer.ts` into `api/routes/*` in
  the next slice that touches it.

### 2026-07-25T14:17+0100 — feature/phase1-desktop-ui-destinations — Desktop destinations UI + overlap-at-creation (spec 25.2/12.5)

- **Done:** the desktop can now add destinations. `DestinationsPanel`
  (`renderer/src/DestinationsPanel.tsx`) lists each paired phone and the folders on this
  desktop it backs up into; "Add folder" opens the native picker, and a destination
  starts unbound ("Waiting for a phone folder") until the phone links one. Logic lives in
  electron-free `main/ui/destinationsController.ts` (`createDestinationsController`:
  `listDevices` / `listDestinations` / `addDestination`, unit-tested): `addDestination`
  requires an absolute path + a paired device, runs the **destination-overlap check at
  creation** (`findDestinationOverlap`, spec 12.5 — closing the long-standing TODO; the
  register endpoint still enforces it for the wire), then `roots.create`s the mapping
  (display name defaults to the folder basename). `main/ui/destinationsIpc.ts`
  (`registerDestinationsIpc`) is the electron glue — `devices:list`, `destinations:list`,
  `destinations:pickFolder` (`dialog.showOpenDialog`) and `destinations:add`, disposed on
  quit. New repo methods `devices.listActive()` and `roots.list()`; `backend.ts` exposes
  `repositories` to the main-process UI layer (never the renderer). Preload adds
  `folderSync.devices.list` and `folderSync.destinations.{list,pickFolder,add}`; shared
  DTOs/channels in `src/shared/destinations.ts`. 7 new tests (create, overlap, unknown
  device, invalid path, explicit name, bound reflection, active-device list); 162 desktop
  / 234 workspace green; lint/typecheck/format clean. **Verified by a real `pnpm build`**
  (preload emits the new channels).
- **Design call:** destinations attach to a paired phone (root_mapping FK), so the panel
  is device-first: no devices → prompts to pair. No push events yet, so the panel offers
  a manual **Refresh** to pick up a newly paired phone (interim until pairing-completion
  feedback lands).
- **Files:** `apps/desktop/src/shared/destinations.ts` (new),
  `apps/desktop/src/main/ui/{destinationsController,destinationsIpc}.ts` (new),
  `apps/desktop/src/main/db/repositories/{devices,roots}.ts` (list methods),
  `apps/desktop/src/main/backend.ts` (expose repositories),
  `apps/desktop/src/main/index.ts` (register IPC), `apps/desktop/src/preload/index.ts`,
  `apps/desktop/src/renderer/**` (App/DestinationsPanel/env.d.ts),
  `apps/desktop/test/destinationsController.test.ts` (new).
- **PR:** branch `feature/phase1-desktop-ui-destinations` pushed — open + squash-merge.
- **Docs updated:** `agent_design.md` §7 (destinations surface + wording),
  `agent_desktop.md` (destinations UI/IPC state, trimmed "not yet built"), this record.
- **Follow-ups:** the **sync-status UI** (wire `GET /v1/sync/status` / a status IPC into
  the destination cards: free space, pending counts, policies — spec §5); pairing-
  completion push + manual-code fallback; destination rename/remove + phone-folder
  policy editing; safeStorage key wrapping; `Upload-Length` vs `expected_size`; periodic
  staging GC; a hash-worker pool; the manual packaged-app launch (pairing QR, folder
  picker + `destinations:*`/`devices:*` round trips, worker via a real commit). Split
  `controlServer.ts` into `api/routes/*` in the next slice that touches it.

### 2026-07-25T14:06+0100 — feature/phase1-desktop-ui-pairing — Desktop pairing UI: QR rendered in main (spec 24.3/20.1)

- **Done:** the first real renderer feature. `PairingPanel`
  (`renderer/src/PairingPanel.tsx`) shows the QR a phone scans, the desktop's display
  name (both sides show the same name, agent_design §5) and a countdown to the
  five-minute window. The **QR is rendered in the main process** and crosses to the
  renderer only as a PNG data URL — the raw pairing secret never enters renderer state
  (spec 24.3). Architecture: `src/shared/pairing.ts` (IPC channel names + a secret-free
  `PairingPresentation` DTO shared by main/preload/renderer), `main/ui/pairingQr.ts`
  (`renderPairingQr` — contract payload builder + `qrcode.toDataURL`, pure),
  `main/ui/pairingController.ts` (`createPairingController` — opens the window, renders
  from the fresh secret, returns image + expiry only; electron-free so the
  no-secret-leak invariant is unit-tested), `main/net/lanHost.ts` (`resolveLanHost` —
  first non-internal IPv4 for the QR host hint), `main/ui/ipc.ts` (`registerPairingIpc`
  — thin `ipcMain.handle` glue, disposed on quit). Preload exposes
  `folderSync.pairing.{start,cancel}` (ipcRenderer used only inside the bridge);
  `main/index.ts` registers the IPC after the backend starts. `qrcode` (1.5.4, pure JS)
  added and kept **external** in the main build; renderer CSP gained `img-src 'self'
data:` so the data-URL QR displays; `backend.ts` now exposes `displayName`. 6 new
  tests (2 lanHost, 1 QR render, 3 controller incl. the secret-never-leaks assertion);
  155 desktop green; lint/typecheck/format clean. **Verified by a real `pnpm build`**:
  preload emits the channels, main keeps qrcode external (require, not inlined), built
  HTML carries the new CSP.
- **Design call:** mappings require a paired device (root_mapping FK → paired_device),
  so pairing is correctly the first UI slice — destinations attach to a paired phone and
  come next. The renderer never getting the secret is the governing hard rule, so the §5
  **manual-code** fallback is deferred (it would expose a typeable secret; revisit with
  a short-code scheme), as is live **pairing-completion feedback** (a main→renderer push
  when a phone actually pairs).
- **Files:** `apps/desktop/src/shared/pairing.ts` (new),
  `apps/desktop/src/main/ui/{pairingQr,pairingController,ipc}.ts` (new),
  `apps/desktop/src/main/net/lanHost.ts` (new), `apps/desktop/src/main/backend.ts`
  (displayName), `apps/desktop/src/main/index.ts` (register IPC),
  `apps/desktop/src/preload/index.ts`, `apps/desktop/src/renderer/**`
  (App/PairingPanel/env.d.ts/index.html CSP), `apps/desktop/package.json` (+qrcode),
  `apps/desktop/test/{lanHost,pairingQr,pairingController}.test.ts` (new).
- **PR:** branch `feature/phase1-desktop-ui-pairing` pushed — open + squash-merge.
- **Docs updated:** `agent_design.md` §7 (pairing surface + wording), `agent_desktop.md`
  (pairing UI/IPC state, trimmed "not yet built"), this record.
- **Follow-ups:** the **destinations UI** (destination picker → `roots.create` with an
  overlap check at creation time, for a chosen paired device) + a `devices:list` IPC so
  the pairing surface can confirm success. Then pairing-completion push, manual-code
  fallback, safeStorage key wrapping, `Upload-Length` vs `expected_size`, periodic
  staging GC, a hash-worker pool, and the manual packaged-app launch (pairing QR
  actually renders + `pairing:*` round trip + worker via a real commit). Split
  `controlServer.ts` into `api/routes/*` in the next slice that touches it.

### 2026-07-25T13:28+0100 — feature/phase1-files-delete-status — Files delete (managed trash) + sync status (spec 6.4/25.2/26.2)

- **Done:** the last two control-API endpoints. `POST /v1/files/delete` mirrors a
  phone-reported user/external deletion to the desktop copy. Mechanics live in the new
  electron-free `sync/deleteService.ts` (`applyDeletion`); the endpoint does only auth,
  path safety and outcome→HTTP mapping. Behaviour: idempotent by `eventId` (replay →
  `already_applied` with the recorded trash path); version gate on
  `expectedRemoteVersionId` vs the current version (mismatch → `remote_version_conflict`,
  409, no action, spec 26.2); **policy-aware** — only `mirror_user_deletions` trashes,
  `preserve_desktop_copy`/null keeps the copy and records `preserved` (spec 6.3, the
  desktop is not a disposable mirror); trash is an atomic rename into
  `.foldersync-trash/<ts>/<relpath>` with both dir entries fsynced; an already-gone
  source (external race) still records `trashed`. `retention_cleanup` is rejected at the
  contract (`bad_request`, spec 6.2). `recordDeletion` writes the `deletion_event` row
  and flips `remote_file` → `trashed` in one transaction. Response `trashPath` is
  destination-root-relative — no absolute server path on the wire (spec 30).
  `GET /v1/sync/status` returns the authenticated device's bound mappings (unbound
  omitted) with per-destination free space (`destinationAvailable` false when statfs
  throws) and the commit backlog (`countPendingCommits`). New `files` repo methods
  (`getDeletionEvent`, `recordDeletion`, `countPendingCommits`) and `layout.ts` helper
  `relativeTrashPath`. Contract gained a `preserved` action; DB `DeletionAppliedAction`
  is now the real stored outcomes (`already_applied` is a read-time replay response
  only). 17 new tests (7 service matrix, 5 delete endpoint, 5 sync-status endpoint), 3
  new golden fixtures. 149 desktop / 221 workspace green; lint/typecheck/format clean.
- **Verification:** before this slice the user ran `electron-vite preview` on the
  built output — the packaged renderer boots (Electron 43.2.0 / Node 24.18.0), closing
  the main-wiring build-config risk. Still owed: the worker path spawned in the
  packaged process via a real commit (needs an upload round-trip).
- **Files:** `apps/desktop/src/main/sync/deleteService.ts` (new),
  `apps/desktop/src/main/api/controlServer.ts` (two endpoints + service),
  `apps/desktop/src/main/db/repositories/files.ts` (delete/count methods),
  `apps/desktop/src/main/db/{types.ts,repositories/index.ts}`,
  `apps/desktop/src/main/storage/layout.ts` (`relativeTrashPath`),
  `packages/contracts/src/files.ts` (`preserved` action),
  `apps/desktop/test/{deleteService,controlServer}.test.ts`,
  `packages/test-fixtures/fixtures/file-delete-response/*` (3 new).
- **PR:** branch `feature/phase1-files-delete-status` pushed — open + squash-merge.
- **Docs updated:** `agent_desktop.md` (delete/status state, deletion hard rule), this
  record.
- **Follow-ups:** the desktop-UI slice (pairing window + QR image render in main +
  destination-picker IPC with an overlap check at mapping creation). Then safeStorage
  key wrapping for the private key, `Upload-Length` vs `expected_size` enforcement,
  periodic (not just startup) staging GC, a hash-worker pool, and a packaged-app launch
  driving a real commit to close the worker verification. `controlServer.ts` is now
  ~575 lines — split into `api/routes/*` registrars in the next slice that touches it.

### 2026-07-25T11:48+0100 — feature/phase1-main-wiring — Backend wired into Electron main + worker-thread hashing (spec 20.1/20.2/22.3)

- **Done:** the tested-but-unwired backend now runs. `src/main/backend.ts`
  (`startBackend`) assembles it independently of Electron — opens the DB, loads/
  persists the TLS identity + writes its `desktop_identity` summary row, builds the
  commit coordinator, serves the HTTPS control server, starts DNS-SD advertising
  (skippable in tests), and runs startup staging GC (new `files.listActivePrepares`
  → `garbageCollectStaging` per destination). `main/index.ts` stays the only
  electron-aware file: `startBackend` on `whenReady`, clean `close` on `will-quit`.
  **Worker-thread hashing landed for real** (spec 20.2): `storage/hashWorker.ts`
  streams SHA-256, `storage/hash.ts` offloads to it. Key finding: electron-vite's
  Node build does **not** apply Vite's browser-worker transform to
  `new Worker(new URL(...))` — it left the literal `./hashWorker.ts` in the bundle
  with no chunk emitted (would break the packaged app). Fixed by emitting the worker
  as a second `rollupOptions.input` (`out/main/hashWorker.js`) and resolving it
  dev/prod-aware in `hash.ts` (source `.ts` under vitest/Node 26, sibling `.js` beside
  `index.js` in the package). Setting a custom `input` drops
  `externalizeDepsPlugin`'s external list (fastify/ciao inlined → 2.1 MB), so main now
  externalizes via an explicit predicate (bundle only relative/absolute source). **All
  verified by a real `pnpm build`**: worker emitted with its body, deps external,
  index.js ~55 kB. 2 new tests (backend bootstrap over TLS + restart-reuses-identity);
  worker hashing exercised by the existing commit tests. 132 desktop / 201 workspace
  green; lint/typecheck/format clean.
- **Verification boundary:** the build is verified headlessly; a full packaged-app
  **launch** (real Electron, worker actually spawned in the packaged process) is not
  possible headlessly and is owed — same class as the manual GUI runs the user did for
  the blank-renderer fix. The dev/test worker path and the build emission are both
  proven; only the packaged runtime launch is unverified.
- **Files:** `apps/desktop/src/main/backend.ts` (new), `apps/desktop/src/main/index.ts`
  (start/stop backend), `apps/desktop/electron.vite.config.ts` (worker input +
  explicit main external), `apps/desktop/src/main/storage/{hash,hashWorker}.ts`
  (worker), `apps/desktop/src/main/auth/identityStore.ts` (`identityCertificateRef`),
  `apps/desktop/src/main/db/repositories/files.ts` (`listActivePrepares`),
  `apps/desktop/test/backend.test.ts` (new).
- **PR:** branch `feature/phase1-main-wiring` pushed — open + squash-merge.
- **Docs updated:** `agent_desktop.md` (main-wiring + worker state, revised
  externalize note), this record.
- **Follow-ups:** next slice — `POST /v1/files/delete` (managed-trash deletion,
  gated on `expectedRemoteVersionId`, `retention_cleanup` rejected) and
  `GET /v1/sync/status`. Then the desktop-UI slice (pairing window + QR image render
  in main + destination-picker IPC), safeStorage key wrapping, `Upload-Length` vs
  `expected_size`, periodic staging GC, and a packaged-app launch to close the worker
  verification. Split `controlServer.ts` into `api/routes/*` when delete/status land.

### 2026-07-25T11:20+0100 — feature/phase1-commit-on-finish — Commit on upload finish + version persistence (spec 18.5/6.5)

- **Done:** the upload→visible loop is closed. `sync/commitService.ts`
  (`commitPrepare`) resolves a finished prepare's mapping, sets `verifying`, runs the
  spike-6 `commitStagedFile` (verify size → hash → adopt / conflict-preserve / atomic
  replace), persists a durable version via the new
  `files.recordCommittedVersion` (one transaction: upsert `remote_file`, supersede the
  prior `remote_version`, insert the new immutable one), and flips the prepare to
  `committed` — or `failed` with a wire error code (size/hash mismatch →
  `source_changed`, path → `invalid_relative_path`, staged gone → `upload_not_found`,
  mapping gone → `destination_unavailable`). `sync/commitCoordinator.ts` serialises
  commits per `(rootId, relativePath)` (spec 18.5) with a per-key promise chain and is
  driven from `onUploadFinish` **off the request path** (the tus 204 is not held for a
  multi-GB hash; the phone polls status). The control server takes an optional
  `commitCoordinator` (the main process supplies one; absent → uploads rest in
  `uploaded`, the prior behaviour). Proven end to end: a real TLS tus upload →
  finish-hook → coordinator → bytes visible at the destination with a durable version.
  The plain `insertRemoteFile`/`insertRemoteVersion` stand-ins were replaced by
  `recordCommittedVersion`. 15 new tests (7 service, 4 coordinator, 1 full-loop, 2 repo
  supersede + net refactors); 130 desktop / 199 workspace green; lint/typecheck/format
  clean.
- **Worker-thread hashing — implemented, then deliberately reverted:** it passes on
  Node 26 (native `.ts` worker via `new URL(..., import.meta.url)`), but its
  production form needs electron-vite Node-worker bundling, and that can only be
  designed/verified once the Electron main process actually imports this backend —
  nothing does yet (`main/index.ts` imports only electron + node:path; `pnpm build`
  bundles the window skeleton, 2 modules). Shipping a hash proven only in the test
  runtime, with no way to verify the packaged path in this slice, is the wrong call
  for integrity-critical hashing. It lands with the **main-wiring slice**, verified by
  a real build. (The original `hash.ts` comment already scoped worker offload to
  "when this is wired into the Electron main process" — consistent.)
- **Files:** `apps/desktop/src/main/sync/{commitService,commitCoordinator}.ts` (new),
  `apps/desktop/src/main/db/repositories/files.ts` (recordCommittedVersion replaces
  the insert stand-ins), `apps/desktop/src/main/db/{index,repositories/index}.ts`,
  `apps/desktop/src/main/api/{controlServer,uploadRouting}.ts` (optional
  `commitCoordinator` wired through `onUploadFinish`),
  `apps/desktop/test/{commitService,commitCoordinator,commitOnFinish}.test.ts` (new),
  `apps/desktop/test/{controlServer,db}.test.ts` (seed via `recordCommittedVersion`).
- **PR:** branch `feature/phase1-commit-on-finish` pushed — open + squash-merge.
- **Docs updated:** `agent_desktop.md`, this record.
- **Follow-ups:** next slice — **wire the backend into the Electron main process**
  (open the DB, load/persist the desktop identity + summary row, start the control
  server + DNS-SD advert, create the commit coordinator) **and land worker-thread
  hashing there** with electron-vite worker bundling verified by a real build. Then
  `POST /v1/files/delete`, `GET /v1/sync/status`, `Upload-Length`-vs-`expected_size`
  enforcement, rate limiting, and the desktop-UI slice. When `controlServer.ts` grows
  past the current ~425 lines with delete/status, split into `api/routes/*`.

### 2026-07-25T11:00+0100 — feature/phase1-tus-fold — tus transport folded into the control server + per-destination staging (spec 18.4/18.5)

- **Done:** tus uploads now run over the authenticated HTTPS control server.
  `api/uploadRouting.ts` (`registerUploadRoutes`) mounts tus with the same
  `onRequest` auth (bearer + protocol gate); the staged file is named by its
  **prepare id** (`namingFunction` reads it from tus `Upload-Metadata` — a validated
  uuid bound to an owned prepare, never a client path), so staging GC reconciles
  against `upload_prepare`. Because one `@tus/server` `FileStore` binds one directory
  but staging must live on each destination volume for the atomic rename (spec
  22/6.5), there is **one tus server per destination staging dir**, cached and routed
  per-request by resolving the prepare first (owned + non-terminal + unexpired, all
  checked before `reply.hijack()` so a rejection returns the JSON error envelope:
  `unauthorised` / `upload_not_found` / `upload_expired` / `bad_request`).
  `onUploadCreate` → `uploading` + links tus id/location (`files.markUploading`);
  `onUploadFinish` → `uploaded`. Verified end to end: a real resumable TLS upload
  (chunk → HEAD-resume → chunk) lands at `<dest>/.foldersync-staging/<prepareId>`
  and commits byte-identically via the spike-6 `commitStagedFile`. The standalone
  `uploadServer.ts` + `uploads.test.ts` were retired (superseded). 9 new tests
  (5 endpoint, 3 metadata unit, 1 repo) replace the 3 retired; 118 desktop / 187
  workspace green; lint/typecheck/format clean.
- **Design notes / deferrals (ADR `desktop-tus-per-destination-staging.md`):** the
  per-destination `Map<stagingDir, TusServer>` is the accepted design; central
  staging + cross-volume copy was rejected (breaks the atomic-rename guarantee), as
  was a custom multi-root datastore (more code than caching the maintained
  `@tus/file-store`). **Commit trigger deferred:** the finish hook only marks
  `uploaded`; the commit slice must consume it (verify → hash → atomic rename →
  persist `remote_file`/`remote_version` → `committed`, serialised per `(rootId,
relativePath)` per spec 18.5) — and **worker-thread hashing** rides with it, since
  that is the request path where large-file SHA-256 competes with the event loop.
  Also deferred: enforcing `Upload-Length` against the prepare's `expected_size`.
- **Files:** `apps/desktop/src/main/api/uploadRouting.ts` (new),
  `apps/desktop/src/main/api/controlServer.ts`,
  `apps/desktop/src/main/db/repositories/files.ts`,
  `apps/desktop/src/main/api/uploadServer.ts` (deleted),
  `apps/desktop/test/uploads.test.ts` (deleted),
  `apps/desktop/test/uploadRouting.test.ts` (new), `apps/desktop/test/db.test.ts`,
  ADR `docs/architecture-decisions/desktop-tus-per-destination-staging.md` (new) +
  supersession note on `spike-6-desktop-atomic-commit.md`.
- **PR:** branch `feature/phase1-tus-fold` pushed — open + squash-merge.
- **Docs updated:** `agent_desktop.md`, two ADRs, this record.
- **Follow-ups:** next slice — **commit-on-finish + worker-thread hashing**: drive
  the commit pipeline from the finish hook (serialised per path), offload SHA-256 to
  a worker thread, and persist the version rows (the real upsert-and-supersede that
  `insertRemoteFile`/`insertRemoteVersion` stand in for). Then `POST /v1/files/delete`,
  `GET /v1/sync/status`, rate limiting, and the desktop-UI slice. `controlServer.ts`
  is ~420 lines — still fine, but split into `api/routes/*` when delete/status land.

### 2026-07-25T10:40+0100 — feature/phase1-files-prepare — Files prepare + status + file-sync repositories (spec 25.2/22.2/6.5)

- **Done:** `POST /v1/files/prepare` and `GET /v1/files/prepare/:prepareId` end to
  end, plus `db/repositories/files.ts` (`FilesRepository`) covering the
  `upload_prepare` / `remote_file` / `remote_version` trio. Prepare resolves the
  phone `rootId` to a bound mapping (unknown/foreign → `root_not_mapped`, existence
  not leaked), runs path safety + the managed-dir guard (failure →
  `invalid_relative_path` with the kind in `details`; a wire-rule violation such as
  traversal is caught earlier by the contract as `bad_request`), gates on disk space
  (`freeSpace` injectable, defaults to `statfs`; bytes + conflict-copy estimate +
  64 MiB margin → `insufficient_space` 507), is idempotent per path (reuses a live,
  unexpired, non-terminal reservation instead of orphaning staging), and defaults to
  a seven-day lifetime (spec 22.3). Skip is returned only when
  `knownRemoteVersionId` equals the current committed version; null/stale falls
  through to upload (adopt-in-place dedupes at commit, spec 6.5). Status is
  owner-only (foreign/unknown → `upload_not_found`), lazily flips a time-expired
  reservation to `expired` (persisted), and surfaces the committed version id + hash
  once present. `resolveDestinationPath` now also returns the normalised
  `relativePath` (the storage key). 20 new tests (14 endpoint, 6 repository).
  112 desktop / 181 workspace green; lint/typecheck/format clean.
- **Design notes / deferrals:** the tus fold into the HTTPS server is **deferred to
  its own slice** — one `@tus/server` `FileStore` has a single directory, but
  staging must live inside each destination volume for the atomic rename (spec 22),
  so per-root routing is an unresolved design decision (likely an ADR). Prepare
  therefore returns the correct, stable `tusEndpoint` (`/v1/uploads`) even though the
  mount lands next. Worker-thread hash offload (spec 20.2) rides with the
  commit-verify slice where it is exercised, not here. The skip decision is
  version-id based (the request carries no content hash), which is the correct
  idempotency guard; content-level dedup is the commit-time adopt-in-place path that
  already exists in `sync/commit.ts`. `controlServer.ts` is now ~415 lines — split
  routes into `api/routes/*` registrars in the next slice that touches it.
- **Files:** `apps/desktop/src/main/db/repositories/files.ts` (new),
  `apps/desktop/src/main/db/repositories/index.ts`, `apps/desktop/src/main/db/index.ts`,
  `apps/desktop/src/main/api/controlServer.ts`,
  `apps/desktop/src/main/storage/pathSafety.ts`,
  `apps/desktop/test/{controlServer,db,pathSafety}.test.ts`.
- **PR:** branch `feature/phase1-files-prepare` pushed — open + squash-merge.
- **Docs updated:** `agent_desktop.md`, this record.
- **Follow-ups:** next slice — **fold the tus mount into the control server** (auth
  via the existing `onRequest` hook, prepare-keyed `namingFunction` validating the
  metadata `prepareId` against an active owned prepare) + resolve per-root staging
  (ADR) + worker-thread hashing wired through commit. Then `POST /v1/files/delete`,
  `GET /v1/sync/status`, rate limiting (spec 24.6), and the desktop-UI slice.

### 2026-07-25T10:21+0100 — feature/phase1-roots-register — Roots registration + destination-overlap guard (spec 25.2/12.5)

- **Done:** `POST /v1/roots/register` binds a phone root to a desktop-approved
  mapping (phone sends `mappingId`, never a path). Guards: mapping exists and is
  owned by the authed device (else `root_not_mapped`, existence not leaked);
  one-mapping↔one-root integrity (re-point = `bad_request` conflict; re-bind same
  pair = allowed policy update per §25.2 "or updates"); destination overlap.
  `storage/destinationOverlap.ts` (pure `destinationsOverlap`/`findDestinationOverlap`)
  rejects equal / ancestor / descendant destinations (§12.5); case-insensitive on
  darwin/win32 (over-blocks rather than risking a shared-dir overwrite). 17 new
  tests (10 overlap unit incl. platform case-sensitivity + sibling/prefix
  non-overlap; 7 endpoint incl. ownership, overlap with conflicting-id detail,
  idempotent update, re-point conflict, malformed body). 92 desktop / 161 workspace
  green; lint/typecheck/format clean.
- **Design notes:** overlap enforced at register (the spec-25.2 gate); the
  desktop-UI mapping-approval step that sets a mapping's destination is simulated in
  tests via `roots.create` and will also overlap-check at creation when the IPC
  lands. `details.conflictingMappingId` surfaced on the overlap error. Register
  handler kept inline in `controlServer.ts` for now; will split routes into modules
  when prepare/delete land (file is ~260 lines).
- **Files:** `apps/desktop/src/main/storage/destinationOverlap.ts`,
  `apps/desktop/src/main/api/controlServer.ts`,
  `apps/desktop/test/{destinationOverlap,controlServer}.test.ts`.
- **PR:** branch `feature/phase1-roots-register` pushed — open + squash-merge.
- **Docs updated:** `agent_desktop.md`, this record.
- **Follow-ups:** next slice — `POST /v1/files/prepare` (+ status): the file-sync
  repos (`remote_file`/`upload_prepare`/`remote_version`), upload|skip decision via
  hash lookup, tus folded into the HTTPS server with a prepare-keyed
  `namingFunction`, and worker-thread hashing. Then `POST /v1/files/delete`,
  `GET /v1/sync/status`, rate limiting, and the desktop-UI slice. When
  `controlServer.ts` grows further, split into `api/routes/*` registrars.

### 2026-07-25T10:10+0100 — feature/phase1-pairing — Pairing endpoint + window + token issuance (spec 24.3/24.5)

- **Done:** `POST /v1/pair` end to end. `auth/pairingWindow.ts` — five-minute
  window, one 256-bit one-time secret, constant-time compare (`timingSafeEqual`
  with length guard), one-time consume, injectable clock + secret generator;
  `activeSecret()` stays main-process-only for QR rendering. `auth/token.ts` gained
  `generateBearerToken` (32 CSPRNG bytes base64url). Control server: pair route
  (public — phone has no token yet), validates body → checks mutual protocol
  support → consumes secret only if otherwise valid (never burns the window on a
  client error) → mints token → `devices.recordPairing` upsert (re-pair reissues,
  no PK collision). New generic protocol error code `bad_request` (added to
  `packages/protocol` + spec §25.3 list; additive, no version bump; existing error
  fixtures cover the envelope). 12 new tests (7 endpoint: happy path + token works +
  wrong secret + no window + one-time replay + protocol mismatch keeps window +
  malformed body + re-pair supersedes old token; 5 window unit). 75 desktop / 144
  workspace green; lint/typecheck/format clean.
- **Design notes:** consume-after-validate ordering keeps a client error from
  burning the one-time secret. `recordPairing` added to the devices repo as an
  upsert (kept `insert` for tests). Rate limiting (spec 24.6) deliberately deferred
  — 256-bit secret + hashed tokens make brute force infeasible, so it is not on the
  slice's critical path; tracked in `agent_desktop.md`. QR **image** rendering +
  renderer/IPC deferred to the desktop-UI slice; only the payload/secret plumbing
  exists.
- **Files:** `apps/desktop/src/main/auth/{pairingWindow,token}.ts`,
  `apps/desktop/src/main/api/controlServer.ts`,
  `apps/desktop/src/main/db/repositories/devices.ts`,
  `apps/desktop/test/{controlServer,pairingWindow}.test.ts`,
  `packages/protocol/src/errors.ts`, `docs/foldersync_implementation_spec.md`
  (§25.3 code list).
- **PR:** branch `feature/phase1-pairing` pushed — open + squash-merge in web UI.
- **Docs updated:** `agent_desktop.md`, `agent_protocol.md`, spec §25.3, this record.
- **Follow-ups:** next slice — `POST /v1/roots/register` (destination-overlap guard
  via `roots.listDestinations()` + pathSafety). Then `POST /v1/files/prepare`
  (+ file-sync repos + tus into the HTTPS server), `GET /v1/sync/status`, rate
  limiting, hash worker-thread offload, and the desktop-UI slice (pairing window +
  QR image render in main).

### 2026-07-25T09:56+0100 — feature/phase1-control-server — HTTPS control server + auth middleware (spec 24/25)

- **Done:** `createControlServer(context)` — HTTPS Fastify on the pinned desktop
  identity (spike-4 cert/key PEM). Single `onRequest` hook does request-id
  (normalise to uuid + echo via `x-request-id`), mandatory protocol-version gate on
  authed routes, and bearer auth (SHA-256 token hash → `paired_device`
  `findActiveByTokenHash`, revoked excluded, last-seen touched on success).
  `api/errors.ts` renders `ApiError` into the spec-25.3 envelope (validated against
  `errorResponseSchema`, no internal leakage). `auth/token.ts` `hashToken`.
  Endpoints: `GET /v1/health` (unauth) + `GET /v1/device` (authed). 10 new tests
  (`controlServer.test.ts`) make real TLS calls with the server cert as `ca` — a
  wrong cert would fail the handshake, so this also proves the pinned identity is
  served. 63 desktop / 132 workspace tests green; lint/typecheck/format clean.
- **Design notes:** DB layer merged on `main` first (PR #1, squash `0c43e00`), so
  this branches fresh from it — no stack. `createUploadServer` (spike-6 tus,
  plain HTTP) left untouched; folding tus into the HTTPS server with auth +
  prepare-keyed naming happens in the prepare/upload slice. Injectable `now` clock
  for deterministic last-seen. Failed-auth rate limiting (spec 24.6) deferred to
  the pairing slice where brute-force matters.
- **Files:** `apps/desktop/src/main/api/{controlServer,errors}.ts`,
  `apps/desktop/src/main/auth/token.ts`, `apps/desktop/test/controlServer.test.ts`.
- **PR:** branch pushed — squash-merge in web UI.
- **Docs updated:** `agent_desktop.md` (control-server current state + remaining),
  this record.
- **Follow-ups:** next slices (each its own branch/PR off `main`): pairing window +
  `POST /v1/pair` + token issuance + rate limiting; `POST /v1/roots/register` with
  overlap guard; `POST /v1/files/prepare` (+ status) + file-sync repos + tus into
  the HTTPS server; `GET /v1/sync/status`; worker-thread hashing.

### 2026-07-25T09:36+0100 — feature/phase1-desktop-db — Desktop database layer (spec 21)

- **Done:** desktop metadata database built on `node:sqlite`. §21.2 gate cleared —
  `node:sqlite` roundtrips in Electron 43's embedded Node 24.18.0 **with no flag**
  (`ELECTRON_RUN_AS_NODE=1`), and is unflagged in the local Node 26 that runs
  vitest, so tests exercise the real module. `src/main/db/`: `database.ts`
  (`openDatabase` → WAL + `foreign_keys` + `busy_timeout`, runs migrations; pure of
  `electron`, path injected via `resolveDatabasePath(userData)`), `migrations.ts`
  (`user_version`-keyed, transactional, append-only, idempotent), `schema.ts` (v1
  DDL, all 8 spec-21.1 tables, STRICT), `row.ts` (narrows `node:sqlite`'s `unknown`
  columns — also satisfies `no-base-to-string`), `types.ts` (row types reusing
  contract enums), and repositories for `desktop_identity`/`paired_device`/
  `root_mapping` via `createRepositories(db)`. 17 new tests (53 desktop, 122
  workspace). Lint/typecheck/format/test all green.
- **Design notes:** all 8 tables created in migration v1 (schema is one design
  unit); repos for the file-sync trio + deletion + event_log land with their
  feature slices, not speculatively. `root_mapping` models the spec-25.2 flow:
  desktop UI creates a pending mapping (null `phone_root_id`/policies), the phone
  binds via register. Token hashes only; revoked pairings excluded from auth
  lookup but retained. FK `ON DELETE CASCADE` from `paired_device`.
- **Files:** `apps/desktop/src/main/db/**`, `apps/desktop/test/db.test.ts`, ADR
  `architecture-decisions/desktop-database-node-sqlite.md`.
- **PR:** branch pushed — **first PR under the new protected-main workflow**
  (squash-merge in web UI; `gh` is work-only so no CLI PR).
- **Docs updated:** `agent_desktop.md` (current state + node:sqlite rule), new ADR,
  this record.
- **Follow-ups:** next desktop slices (each its own branch/PR): (1) HTTPS control
  server on the spike-4 identity + protocol/auth middleware + `/v1/health`,
  `/v1/device`; (2) pairing window/secret + `POST /v1/pair` + token issuance;
  (3) `POST /v1/roots/register` with destination-overlap guard (uses
  `roots.listDestinations()`); (4) `POST /v1/files/prepare` + status + the
  file-sync repos + tus `namingFunction`; (5) worker-thread hashing. The
  packaged-app and Ubuntu/Windows node:sqlite verification is still owed per the ADR.

### 2026-07-25T09:18+0100 — main (setup) — GitHub remote created via personal SSH alias

- **Done:** `origin` set to `git@github-personal:zayr0-9/Kuma.git` and `main`
  pushed (tracking `origin/main`). Root-caused and avoided the identity trap:
  `~/.ssh/config` pins `Host github.com` → `id_ed25519` (work key,
  `IdentitiesOnly yes`) which authenticates as **ksingh-max**; the personal alias
  is `Host github-personal` → `id_ed25519_personal` → **zayr0-9** (both verified
  live with `ssh -T`). GitHub's copy-paste URL (`git@github.com:zayr0-9/Kuma.git`)
  would have pushed with the work key — rewrote the host to `github-personal`.
  `gh` CLI is authed **only** as work ksingh-max, so repo settings
  (squash-merge-only + `protect-main` ruleset) are being done by Karan in the web
  UI rather than via a work-token API call.
- **Files:** none in-repo (git remote config + auto-memory only).
- **PR:** none (setup; no code change).
- **Docs updated:** this record; auto-memory `github-push-ssh-aliases-kuma` added,
  `personal-vs-work-github-identity` refreshed.
- **Follow-ups:** (1) CI's first-ever run should have triggered on the `main` push
  (`on: push: branches: [main]`) — check `github.com/zayr0-9/Kuma/actions`; it may
  be red on first run (`--frozen-lockfile` / `format:check`) — fix before gating.
  (2) After first green run, add `checks` as a required status check in the
  ruleset. (3) Web-UI settings: disable merge-commit + rebase-merge, enable
  auto-delete head branches, ruleset "Require a PR" with **0** required approvals
  (solo — 1 would lock out self-merge), block force pushes.

### 2026-07-25T09:10+0100 — fix/desktop-renderer-blank — Both apps verified live on real targets

- **Done:** desktop blank-window bug fixed — two causes: (1) CSP `script-src
'self'` blocked Vite's inline React-refresh preamble in dev (now env-driven:
  `%VITE_CSP_SCRIPT_EXTRA%`/`%VITE_CSP_DEV_DIRECTIVES%` via .env.development /
  .env.production, production CSP unchanged); (2) the preload bundle inlined the
  `electron` npm installer shim (requires `child_process` → dies in the sandbox)
  because `externalizeDepsPlugin()` was missing — now applied to main+preload
  with `external: ['electron']` as belt-and-braces. Added permanent dev
  observability: renderer `console-message` and `preload-error` relayed to the
  terminal (a blank window must never be silent). App.tsx degrades to a visible
  message if the bridge is absent. **Verified live:** desktop window renders
  "Electron 43.2.0, Node 24.18.0"; phone dev client loads the bundle and shows
  **"Native module: pong"** — full EAS→Kotlin→autolinking→bridge chain proven.
- **Gotcha for the dev loop:** macOS firewall had `node` set to "Block incoming
  connections", which reset the phone→Metro connection (symptom: QR scan →
  "connection reset"). Fix: System Settings → Network → Firewall → Options →
  node → Allow. `adb reverse tcp:8081 tcp:8081` over USB is the fallback.
- **Files:** `apps/desktop/electron.vite.config.ts`, `src/main/index.ts`,
  renderer (App/env.d.ts/index.html), `.env.development`, `.env.production`,
  `.gitignore`.
- **PR:** none possible yet (no remote) — squash-merged locally to `main`, branch deleted.
- **Docs updated:** `agent_desktop.md`, `agent_mobile.md`, this record.
- **Follow-ups:** with the dev client live, all four Android spike halves are
  unblocked (SAF, foreground service, NsdManager browse, pinned-TLS client).
  Phase 1 vertical slice can begin.

### 2026-07-25T04:15+0100 — spike/discovery-tls-desktop — Spikes 3 & 4 desktop halves passed

- **Done:** DNS-SD advertisement via @homebridge/ciao verified by a live
  bonjour-service browse (TXT surface locked to v/id/name/tls); desktop TLS
  identity (ECDSA P-256, ~10y self-signed cert, base64url SPKI pin compatible
  with `base64Url32Schema`) verified against a real TLS handshake including
  impersonator-pin rejection; generate-once identity store with 0600 key file.
  5 new tests (36 in desktop suite). ADRs: spike-3-mdns-discovery.md,
  spike-4-pinned-tls.md (both "desktop half PASSED"). Gotchas: reflect-metadata
  import required before @peculiar/x509; bonjour-service is `export =` so
  esModuleInterop enabled for desktop.
- **Files:** `apps/desktop/src/main/{discovery,auth}/**`, tests, ADRs, tsconfig.
- **PR:** none possible yet (no remote) — squash-merged locally to `main`, branch deleted.
- **Docs updated:** `agent_desktop.md`, this record, two ADRs.
- **Follow-ups:** Android halves (NsdManager browse, pinned trust manager, QR
  pairing) blocked on the dev client build. Next desktop slice: pairing window +
  `/v1/pair` + control-API auth on the identity from spike 4.

### 2026-07-25T04:30+0100 — fix/eas-android-build — First EAS build failure diagnosed and fixed

- **Done:** EAS build `787a88d6` ERRORED with two gradle failures: (1)
  `foldersync-native` build.gradle lacked `compileSdk` — fixed by adding
  `useDefaultAndroidSdkVersions()` from ExpoModulesCorePlugin; (2)
  `SoftwareComponent 'release' not found` on `:expo` — root cause was duplicate
  expo/expo-modules-core instances from pnpm's isolated linker (expo-doctor
  confirmed). Fixed by `nodeLinker: hoisted` + `autoInstallPeers: false` in
  pnpm-workspace.yaml (pnpm 11 ignores .npmrc entirely — .npmrc deleted; all
  settings live in pnpm-workspace.yaml now). Also: EAS build env pinned to Node
  24.18.0 in eas.json (image default is Node 22 vs our engines >=24), typescript
  added to `expo.install.exclude`, dropped `useExpoPublishing()` from the module
  gradle (local module, never published). expo-doctor: 20/20 after removing
  `expo-modules-core` as a direct dep.
- **Files:** `pnpm-workspace.yaml`, `.npmrc` (deleted),
  `modules/foldersync-native/android/build.gradle`, `apps/mobile/eas.json`,
  `apps/mobile/package.json`, lockfile.
- **PR:** none possible yet (no remote) — squash-merged locally to `main`, branch deleted.
- **Docs updated:** `agent_mobile.md`, this record.
- **Update 04:35:** rebuild a3b0994e FINISHED — gradle wiring of foldersync-native verified; APK ready for install.
- **Follow-ups:** rebuild queued after merge — verify it turns green, then install
  the APK on the Samsung and check "Native module: pong". Hoisted layout is a
  workspace-wide change: desktop suite re-verified in this branch.

### 2026-07-25T04:05+0100 — feature/eas-project-setup — EAS project linked, first dev build queued

- **Done:** EAS project created and linked (`@sigma2/foldersync`, id
  `b86a340b-f58c-4903-aa6b-d00956359bcb`; personal Expo account). projectId wired
  into `app.config.ts` manually (eas-cli cannot edit dynamic TS configs).
  Android keystore generated by EAS in the cloud (non-interactive now works for
  this). First development build queued: build id
  `787a88d6-aad0-4ad1-a75c-96718469ebbf` — this is the first-ever verification of
  the native module's gradle wiring.
- **Files:** `apps/mobile/app.config.ts`.
- **PR:** none possible yet (no remote) — squash-merged locally to `main`, branch deleted.
- **Docs updated:** `agent_mobile.md`, this record.
- **Follow-ups:** when the build finishes, install the APK on the Samsung phone
  (QR/link from the build page), run `pnpm dev:mobile`, and confirm the home
  screen shows "Native module: pong". If the gradle wiring fails, iterate on
  `modules/foldersync-native/android/build.gradle`.

### 2026-07-25T03:45+0100 — spike/desktop-atomic-commit — Spike 6 passed

- **Done:** desktop atomic-commit pipeline with 15 new tests (31 in the desktop suite, 100 workspace-wide):
  `commitStagedFile` (verify size/sha → adopt-in-place | conflict-preserve |
  replace-if-unchanged → fsync → atomic rename), crash simulation before/after
  rename with deterministic recovery (`already_committed` via recorded sha),
  staging GC, reserved-path guard (`.foldersync-*` never addressable from the
  wire), and the Fastify + @tus/server integration proven with a real
  interrupted-and-resumed chunked upload committed byte-identically. ADR:
  `docs/architecture-decisions/spike-6-desktop-atomic-commit.md` (PASSED).
- **Files:** `apps/desktop/src/main/{sync,storage,api}/**`, tests, ADR.
- **PR:** none possible yet (no remote) — squash-merged locally to `main`, branch deleted.
- **Docs updated:** `agent_desktop.md`, this record, new ADR.
- **Follow-ups:** worker-thread hash offload + tus `namingFunction` tied to
  prepare ids land with the control-API slice. Spikes 1/2/5 need the EAS dev
  build (blocked on `eas login`); spikes 3/4 desktop halves are next candidates.

### 2026-07-25T03:20+0100 — feature/phase0-mobile-native-skeleton — Mobile + native module skeletons

- **Done:** `apps/mobile` Expo SDK 57.0.8 skeleton (Expo Router, expo-dev-client,
  app.config.ts, monorepo metro.config.js, eas.json development profile) and
  `modules/foldersync-native` Expo module skeleton (expo-module.config.json,
  library build.gradle, `FolderSyncModule.kt` with `ping()`, TS surface via
  `requireOptionalNativeModule`). Typed native wrapper at
  `apps/mobile/src/native/`. Verified: typecheck, eslint, prettier, and a headless
  `expo export --platform android` (Hermes bundle builds through the monorepo
  metro config). eslint config gained CommonJS globals for config files and
  ignores `.expo/`.
- **Files:** `apps/mobile/**`, `modules/foldersync-native/**`, `eslint.config.mjs`.
- **PR:** none possible yet (no remote) — squash-merged locally to `main`, branch deleted.
- **Docs updated:** `agent_mobile.md`, `agent_native.md` (current state), this record.
- **Follow-ups:** Kotlin/Gradle never compiled (no local toolchain) — the first
  `eas build --platform android --profile development` verifies it and needs
  `eas login` with the personal Expo account. Android package id
  `dev.zayr.foldersync` is a placeholder. Phase 0 is now complete except CI has
  never run (no remote); next: Spike 6 (desktop staging → hash → atomic commit)
  or the EAS build to validate the native chain.

### 2026-07-25T03:06+0100 — feature/phase0-desktop-skeleton — Desktop skeleton + path safety

- **Done:** `apps/desktop` electron-vite skeleton (Electron 43.2.0 — the spec's
  research baseline — Vite 8, React 19) with spec-20.1 security defaults; preload
  exposes only `runtimeVersions`; CJS preload (sandboxed preloads can't be ESM);
  CSP meta. Spec-22.1 path safety implemented in `src/main/storage/pathSafety.ts`
  with 16 tests (win32 reserved names, MAX_PATH, control chars, containment,
  symlink escape via real temp dirs). `electron-vite build` verified headless.
  85 tests green workspace-wide; typecheck/lint/format clean.
- **Files:** `apps/desktop/**`, `pnpm-workspace.yaml` (allowBuilds for
  electron/esbuild).
- **PR:** none possible yet (no remote) — squash-merged locally to `main`, branch deleted.
- **Docs updated:** `agent_desktop.md` (current state), this record.
- **Follow-ups:** GUI launch not exercised in this session — run `pnpm dev:desktop`
  once manually. Next slices: mobile Expo skeleton + native module skeleton, then
  Spike 6 (staging → hash → atomic commit) can start desktop-side.

### 2026-07-25T03:00+0100 — feature/phase0-protocol-contracts — Protocol + contracts packages

- **Done:** `packages/protocol` (version/header/endpoint/error/discovery constants),
  `packages/contracts` (Zod schemas for all spec-25 endpoints, policy enums, canonical
  wire-path parser with NFC normalisation, pairing-QR build/parse),
  `packages/test-fixtures` (37 golden fixtures, 15 directories). 69 tests green;
  typecheck, eslint (flat config, type-checked rules, `no-explicit-any` error) and
  prettier all pass. CI workflow added (`.github/workflows/ci.yml`). Exact dependency
  pins enforced via `saveExact: true` in pnpm-workspace.yaml (pnpm 11 ignores
  `.npmrc save-exact` — root cause of initial caret ranges).
- **Files:** `packages/*`, `eslint.config.mjs`, `.prettierignore`,
  `.github/workflows/ci.yml`, `pnpm-workspace.yaml`, root `package.json`.
- **PR:** none possible yet (no remote) — squash-merged locally to `main`, branch deleted.
- **Docs updated:** `agent_protocol.md` (current state), this record.
- **Follow-ups:** TypeScript pinned to 5.9.3 everywhere — pnpm resolved 7.0.2 (native
  tsc) for one package before pinning; revisit TS 7 deliberately later. Next Phase-0
  slices: desktop skeleton (electron-vite + Fastify + path-safety), mobile skeleton
  (Expo), native module skeleton.

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
