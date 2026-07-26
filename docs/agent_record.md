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

### 2026-07-26T11:52+0100 — feat/retention-cleanup — Retention cleanup: delete-after-verified-backup (spec 19)

- **Done:** the phone now frees its own space. `CleanupEngine.kt` runs after the transfer drain in
  `SyncEngine.runSync`, for `delete_after_verified_backup` roots only, following the spec-19.1
  ordering per file: re-query metadata just before deleting (19.4 — changed ⇒ cancel + re-upload),
  re-read the source and compute SHA-256 **independently** of the resumable upload (19.2 — a resume
  reads from an offset, so the transport digest is untrustworthy), compare to the desktop's committed
  hash (mismatch ⇒ never delete, re-upload current bytes + log), mark `retention_cleanup_expected`
  **before** `DocumentsContract.deleteDocument`, then record `cleaned`; a failed delete parks the
  file `cleanup_failed` (19.3 — surfaced, retryable via `retryCleanup`, never re-uploaded). Retention
  deletions **never propagate to the desktop**: `SyncStore.evaluateMissing` short-circuits any
  `retention_cleanup_expected` row to `cleaned` (also recovers a crash after delete but before
  recording success), and `isCandidate` keys on `remoteVersionId` so a `cleanup_failed` file is never
  re-uploaded merely for leaving the backed-up state. **No Room schema change** (the column already
  existed; new states are string values; counts are `COUNT` queries) → DB version stays 1, no
  migration. Module surface gained `cleanedCount`/`cleanupFailedCount` per root + `retryCleanup`;
  Folders shows "freed from phone" + a Retry affordance. Desktop unchanged — it already returns its
  hex `sha256`, and retention cleanup is phone-only by spec.
- **Files:** `CleanupEngine.kt` (new), `SyncEngine.kt`, `db/SyncStore.kt`, `db/SyncDaos.kt`,
  `FolderSyncModule.kt`, `modules/foldersync-native/src/index.ts`, `apps/mobile/src/native/engine.ts`,
  `apps/mobile/app/folders.tsx`.
- **Build:** compiles on EAS (build `a6be29e3`, KSP2/Room 2.7). Awaits device verification of the
  verify-then-delete happy path + the failed-delete retry path.
- **Gates:** `pnpm -r typecheck` + `eslint` clean across all 6 projects; contracts 72 + desktop 190
  tests green (unchanged — phone-only); prettier last.
- **PR:** `feat/retention-cleanup` off main — open + squash-merge.
- **Docs updated:** this record, `agent_native.md`.
- **Follow-ups:** device-verify retention cleanup; `deletion_event` propagation of user deletions to
  the desktop trash (`mirror_user_deletions`, spec 19) still deferred; auto-start service from
  Folders; batch Room writes for very large first scans; not yet stress-tested on a large folder.

### 2026-07-26T11:05+0100 — feat/phone-engine — Real phone engine: Room + scan + upload + Folders UI (spec 16-18, 5)

- **Done:** the spike transport is now the durable phone engine, and a bound destination is
  reusable instead of burned per attempt. **Room is the mobile source of truth (spec 16):**
  `sync_root`/`scan_run`/`file_entry`/`transfer_job`/`sync_event` entities, blocking DAOs, and a
  `SyncStore` facade owning the transactional transitions (spec 16.2). `deletion_event` +
  `paired_device` deferred (deletion is spec 19; pairing already persists via TokenVault).
  **Room + KSP** added to the Expo local module via a nested-buildscript KSP classpath
  (`symbol-processing-gradle-plugin` at `rootProject.ext.kspVersion` → **2.1.20-2.0.1**, the
  KSP2 version Expo's `KSPLookup` maps to the pinned Kotlin 2.1.20) + **Room 2.7.1** (first line
  with native KSP2 support). **`SyncEngine`** (spec 17-18): scan (generation, access re-check,
  BFS traverse, candidate detection, 45s quiescence, two-observation missing-file confirmation
  with a 15-min gap) + transfer drain, serialised on one lock (one upload/phone, spec 18.3).
  **`UploadManager` folded into `TusTransport`** — same proven pinned-TLS resumable tus, now
  driven by `transfer_job` rows; commit stamps `file_entry` transactionally. The **service loop
  drives `SyncEngine.runSync`** on its background worker; JS `syncNow` runs it on a detached
  thread; the notification reads only the in-memory snapshot (never Room on the main thread).
  Module surface: `addRoot` (register + persist), `listRoots`, `setRootEnabled`, `removeRoot`
  (+ desktop unbind), `syncNow`, `getTransfers`, `getSyncEvents`; the single-shot
  startUpload/getUploadStatus/cancelUpload are removed. **Desktop:** `POST /v1/roots/unbind`
  (endpoint + contract + repo `unbind()` + route + 6 tests) returns a bound mapping to
  `roots/available` — this is what kills the burns-a-fresh-folder friction. **Mobile UI:**
  `app/folders.tsx` (persisted roots w/ per-root status; add-folder = pick → choose destination
  - policies → bind → sync; pause/resume; remove) + `app/transfers.tsx` (live progress + queue +
    history); `src/native/engine.ts` typed wrapper; spike-upload screen removed.
- **Build + device:** the native engine compiled clean on EAS (build `2091ec4b`) and
  **whole-folder scan→upload is now device-verified** — a picked folder scans, its files queue,
  and they upload to `committed` end to end (the desktop `unbind` + phone `removeRoot` make a
  destination reusable). The APK from that build + Metro loads the new JS, so no second build was
  needed for the UI/desktop changes. Also added a **desktop-side Unbind button** on bound
  destination cards (`DestinationsPanel` + `destinations:unbind` IPC + `unbindDestination`
  controller + 3 tests).
- **Gates:** `pnpm -r typecheck` + `eslint` clean across all 6 projects; contracts 72 + desktop
  190 tests green (6 unbind endpoint + 3 unbind controller); prettier last.
- **PR:** `feat/phone-engine` off main — open + squash-merge.
- **Docs updated:** this record, `agent_native.md`, `agent_mobile.md`, ADR
  `room-ksp-expo-module.md`.
- **Follow-ups:** whole-folder sync works; not yet stress-tested on a large folder (batch Room
  writes for very large first scans). Deferred: retention cleanup / delete-after-verified-backup
  - `deletion_event` propagation (spec 19); auto-starting the service from Folders (today the
    user enables the service separately for background sync); quiescence defers files <45s old to
    the next scan; a desktop-initiated unbind leaves the phone's `sync_root` stale until the phone
    also removes the folder.

### 2026-07-26T10:20+0100 — fix/desktop-stable-port + fix/mobile-tus-transport — Spike 5 PASSED on device; three fixes

- **Done:** spike 5 is **device-verified** on the Samsung SM-S948B — a file uploads to
  `committed`, and **resume after a mid-transfer Wi-Fi toggle works** (the spike-5 pass
  condition). All four gating Android spikes (1 SAF, 2 service, 3 discovery, 4 pairing) + the
  resumable tus upload now pass on-device. The device run surfaced three desktop bugs the Node
  golden tests missed (Android `HttpsURLConnection` is much stricter), all fixed desktop-side —
  **no app rebuild was needed for the final fix**:
  1. **Stable port** — `startBackend` bound `port: 0` (OS-assigned), so each desktop restart
     stranded the paired phone at a dead port. Now a fixed `FOLDERSYNC_PORT` (default 51384).
  2. **Catch-all content-type parser** — tus-java-client's creation POST is
     `application/x-www-form-urlencoded`; Fastify 415'd it before the handler. `'*'` parser
     now bypasses body parsing for all tus requests (JSON routes keep their parser).
  3. **Relative tus Location** — `@tus/server` emitted an absolute `http://host/...` Location
     (blind to the pinned TLS), so the phone sent HEAD/PATCH as **plaintext to the HTTPS port**
     → `unexpected end of stream on com.android.okhttp`, zero server-side traffic. The desktop
     test masked it (re-attached the https base). Fixed with `relativeLocation: true`.
     Phone-side (`fix/mobile-tus-transport`, built into EAS `05b6d241`): the upload status now
     surfaces the **real transport exception** instead of a bare `network` (this is what made
     bugs 2+3 diagnosable on device), plus `Connection: close` + keep-alive off on tus requests.
- **How it was diagnosed:** added temporary `[TUSDEBUG]` logging to the desktop tus route +
  error handler (reloads from source, no rebuild) → narrowed create-415 → then a raw-TLS
  reproduction test captured the exact create response and revealed the `http://` Location.
  Each fix landed with a regression test (415 content-type; relative-Location assertion). The
  temporary logging has been **stripped**.
- **Gates:** desktop typecheck + lint + 181 tests (2 new regression tests) green; prettier last.
- **Branches / PRs:** `fix/desktop-stable-port` (stable port + content-type + relativeLocation;
  the intermediate DEBUG commits collapse on squash-merge — final tree is clean) and
  `fix/mobile-tus-transport` (transport diagnostics + Connection:close) — both off main, no file
  overlap. Open + squash-merge both.
- **Docs updated:** `spike-5-tus-upload.md` (marked PASSED + the three bugs), this record.
- **Follow-ups:** the real engine — **Room DB (spec 16) + scan engine (17) + upload engine (18)
  - phone UI (5)**. Fold `UploadManager` into it, and kill the spike-screen friction (a bound
    destination drops off `roots/available` with no phone-side rootId persistence and no desktop
    unbind — so each test attempt currently burns a fresh desktop folder). Room-backed
    `sync_root` + a "my roots" list + a desktop unbind close that. Its own branch (Room KSP risk).

### 2026-07-26T01:40+0100 — spike/5-tus-upload-roots-binding — Spike 5: tus direct URI upload + roots binding (implemented)

- **Done:** the phone can pick a folder, **bind** it to a desktop destination, and **upload**
  one file over resumable tus, end-to-end against the real desktop. Native (`UploadEngine.kt`):
  `UriTusUpload` streams a SAF `content://` URI via `ContentResolver` (no cache copy; size from
  a file descriptor — spec 18.1); `PinnedTusClient` overrides `prepareConnection` to pin TLS on
  every tus connection (never trust-all — spec 18.2); `SharedPrefsTusUrlStore` persists the
  upload URL so **resume survives a process kill**; `UploadManager` drives ONE upload (spec 18.3)
  on a worker thread with a **pull-model** status snapshot (prepare → tus w/ retry-resume → poll
  commit, spec 18.5). `ControlClient.kt` does the authenticated control calls (pinned OkHttp +
  Bearer from `TokenVault` + protocol/request-id): `listAvailableDestinations`, `registerRoot`,
  `prepareUpload`, `getPrepareStatus`. `PinnedTls.kt` refactored to one `PinnedSsl` shared by
  OkHttp + the tus `HttpsURLConnection`; `PairingManager` gained native-only `pairedTarget()`
  (carries the pin) + `phoneDeviceId()`. Dep: **`io.tus.java.client:tus-java-client:0.5.0`**
  (pure-Java, dependency-free — NOT `tus-android-client`, whose stale support-lib deps risk an
  AndroidX clash on EAS; custom Base64, no API-26 trap). **Desktop:** new
  `GET /v1/roots/available` (contract `rootsAvailableResponseSchema` + route + 3 tests) lists the
  device's **unbound** mappings so the phone can bind — the wire that turns the desktop's "Add
  folder"/"Waiting for a phone folder" into a bindable target. Mobile: TS DTOs +
  `src/native/upload.ts` + `app/spike-upload.tsx` harness (folder → destination → upload +
  progress bar).
- **How it was grounded:** read the exact desktop wire behaviour first — `controlServer.ts`
  (auth: `x-foldersync-protocol`+Bearer on every non-public route; `roots/register` needs a
  desktop-approved `mappingId` bound to the device), `uploadRouting.ts` (tus mount naming by
  `prepareId` metadata), `roots.ts`/`destinationsController.ts` (mappings created per paired
  device, unbound until register), `files.ts`/`roots.ts` contracts, `backend.ts` (commit
  coordinator IS wired → uploads reach `committed`). Verified the **tus-java-client 0.5.0** API
  against source (getTusInputStream caches → a **fresh `TusUpload` per attempt** + stable
  fingerprint + persistent URL store is the correct resume shape). An **adversarial
  compile/security review subagent** ran over the new Kotlin before the build.
- **Gates (headless):** typecheck (6 projects), lint, tests (contracts 72 + desktop 180 incl. 3
  new `roots/available` tests) — all green. prettier last.
- **Verification boundary:** Kotlin cannot compile here (spec 32.1). A cloud EAS dev build was
  triggered after push — first compile of the tus/ControlClient/UploadManager Kotlin; a Samsung
  run confirms the pass conditions (bind kumatest; small file → committed; multi-GB + Wi-Fi
  toggle → resumes; kill+reopen → resumes; no cache copy).
- **Files:** `modules/foldersync-native/android/src/main/java/expo/modules/foldersync/{ControlClient,UploadEngine}.kt (new),{PinnedTls,PairingManager,FolderSyncModule}.kt`,
  `modules/foldersync-native/android/build.gradle`, `modules/foldersync-native/src/index.ts`,
  `apps/mobile/src/native/upload.ts (new)`, `apps/mobile/app/{spike-upload.tsx (new),index.tsx}`,
  `packages/protocol/src/endpoints.ts`, `packages/contracts/src/{roots,index}.ts`,
  `apps/desktop/src/main/api/controlServer.ts`, `apps/desktop/test/controlServer.test.ts`,
  ADR `spike-5-tus-upload.md`.
- **PR:** branch `spike/5-tus-upload-roots-binding` pushed — open + squash-merge.
- **Docs updated:** `agent_native.md`, `agent_mobile.md`, `spike-5-tus-upload.md`, this record.
- **Follow-ups:** verify the EAS build goes green + run the spike-5 checklist on the Samsung
  (record pass conditions in the ADR). Then the big one: **Room DB (spec 16) + scan engine
  (spec 17) + real upload engine (spec 18) + phone UI (spec 5)** — turn these spike pieces into
  the actual backup, on its own branch so Room's KSP/annotation-processor risk is isolated.

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
