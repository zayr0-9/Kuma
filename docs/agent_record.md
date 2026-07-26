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

### 2026-07-26T16:48+0100 — feat/remote-gallery-mobile — Remote gallery: native fetch/download + mobile grid & pan/zoom viewer (spec 6.6, client half)

- **Done:** the phone half of the remote gallery, **stacked on `feat/remote-gallery-api`**.
  Opening **View photos** on a Folders card browses that folder's backed-up images from the
  desktop (paginated, lazy thumbnails); a full-screen viewer swipes between images, pinch/pans and
  double-tap-zooms, and downloads them back into the phone's photo library.
  - **Native (Kotlin):** `ControlClient.listRemoteImages(rootId, cursor, limit)` + `streamGet(path,
consume)` (binary GET over the pinned client → a sink; bytes never touch JS, spec 30). New
    `RemoteMedia` caches thumbnails / full images under `cacheDir/foldersync/{thumbs,images}` keyed
    by version id (returns `file://` URIs) and `download()` streams into **MediaStore**
    `Pictures/FolderSync` (IS_PENDING-bracketed; no storage permission on API 29+). Four
    `AsyncFunction`s + the `foldersync-native` TS surface.
  - **Mobile:** `app/gallery.tsx` (FlatList thumbnail grid + a reanimated/gesture-handler
    pinch/pan/double-tap viewer; horizontal paging disabled while zoomed so a pan moves the image),
    `src/native/gallery.ts` wrapper, **View photos** on the Folders card, a `gallery` route +
    `GestureHandlerRootView` in `_layout.tsx`. New native deps `react-native-gesture-handler`
    ~2.32.0 / `react-native-reanimated` 4.5.0 / `react-native-worklets` 0.10.0 (SDK-57) +
    `babel.config.js`.
- **Files:** `modules/foldersync-native/src/index.ts`,
  `modules/foldersync-native/android/.../{ControlClient.kt, RemoteMedia.kt (new), FolderSyncModule.kt}`;
  `apps/mobile/app/{gallery.tsx (new), _layout.tsx, folders.tsx}`,
  `apps/mobile/src/native/gallery.ts` (new), `apps/mobile/{package.json, babel.config.js (new)}`,
  `pnpm-lock.yaml`; docs `agent_native.md`, `agent_mobile.md`, `agent_design.md`.
- **Gates:** mobile + native typecheck clean, eslint clean, `format:check` clean (last). Headless
  verification: **expo-doctor 20/20** and a clean **`expo export`** (reanimated worklet transform +
  gesture-handler bundle, 3541 modules). Kotlin compiles only on EAS.
- **Build:** EAS dev build **`9271307c`** **FINISHED** — Kotlin compiled clean and
  gesture-handler / reanimated / worklets autolinked with no issues. APK:
  https://expo.dev/artifacts/eas/ygxUGXlAL-7qTqwxrvs-nLExUt_iuTlCW9ATQBAjHqY.apk — install on the
  Samsung SM-S948B to verify the gallery on device (nothing else compiles the Kotlin).
- **PR:** `feat/remote-gallery-mobile` — the backend landed as **#25**, so this was **rebased onto
  main** (`git rebase --onto origin/main feat/remote-gallery-api`); the diff is now mobile-only
  (15 files, no desktop/contracts). Ready to squash-merge.
- **Docs updated:** `agent_native.md`, `agent_mobile.md`, `agent_design.md` (spec 6.6 landed with
  the backend PR).
- **Follow-ups:** **device-verified on the Samsung SM-S948B** (APK `9271307c`) — the gallery works
  end to end (browse → view → zoom → download). Note a stale dev client hard-crashes at launch now
  that `GestureHandlerRootView` sits at the app root (new native deps → reinstall the dev build).
  Later niceties: order the listing by capture date rather than committedAt (backup time); the
  MediaStore download path targets API 29+.

---

### 2026-07-26T16:35+0100 — feat/remote-gallery-api — Remote gallery: list/thumbnail/content endpoints + thumbnailer (spec 6.6, backend half)

- **Done:** the desktop + wire half of the phone-side **remote gallery** (new spec **6.6**):
  browse a folder's backed-up images from the phone — including files it has since removed
  under delete_after_verified_backup — and download them. Read-only + user-initiated; does
  not weaken one-way authority (§6.3). The Kotlin/native + mobile-UI half is the stacked
  `feat/remote-gallery-mobile` follow-up.
  - **Contracts/protocol:** `GET /v1/files/list` (paginated committed-image listing, opaque
    keyset cursor) with `filesListRequest`/`remoteImageItem`/`filesListResponse` schemas + golden
    fixtures; two **binary** routes `GET /v1/files/:fileId/thumbnail` and `.../content` (route
    constants + concrete-url helpers in `@foldersync/protocol`); new error code `file_not_found`.
  - **Desktop:** `files` repo gains `getRemoteFileById` + `listCommittedImages` (image-extension
    filter, `(committedAt, id)` DESC keyset). Thumbnails via Electron **`nativeImage`** (no native
    image dependency) behind an injected `ThumbnailProvider` — real impl
    `images/electronThumbnailer.ts` with a userData disk cache keyed by versionId+size; the control
    server stays electron-free and falls back to the original bytes when the provider is absent or
    can't decode. Three authed routes on `controlServer.ts`, ownership-scoped (`file_not_found`
    identically for foreign/unknown/non-committed), path-safe, `destination_unavailable` when the
    bytes are gone from disk.
- **Files:** `packages/protocol/src/{endpoints,errors,index}.ts`,
  `packages/contracts/src/{files,index}.ts`, `packages/test-fixtures/fixtures/files-list-*`,
  `packages/contracts/test/fixtures.test.ts`; `apps/desktop/src/main/storage/imageTypes.ts` (new),
  `apps/desktop/src/main/images/{thumbnailer,electronThumbnailer}.ts` (new),
  `apps/desktop/src/main/{db/repositories/files.ts,api/controlServer.ts,backend.ts,index.ts}`,
  `apps/desktop/test/{filesGallery.test.ts (new),db.test.ts}`;
  `docs/foldersync_implementation_spec.md` (§4, 5.5, 6.6, 13.2, 22.4, 25.2, 25.3).
- **Gates:** contracts 80 + desktop 203 tests green; `pnpm -r typecheck` clean; real
  `apps/desktop pnpm build` (electron stays external, thumbnailer + routes bundled); eslint +
  `format:check` clean (last).
- **PR:** `feat/remote-gallery-api` — open + squash-merge.
- **Docs updated:** spec (above), `agent_protocol.md`, `agent_desktop.md`. `agent_design.md` /
  `agent_mobile.md` / `agent_native.md` update with the mobile PR (no UI/native change landed here).
- **Follow-ups:** **`feat/remote-gallery-mobile`** (stacked on this): Kotlin `ControlClient` +
  `FolderSyncModule` gallery methods (list; fetch thumbnail/full image into cache → `file://` URIs;
  MediaStore download into the phone's photo library), `foldersync-native` TS surface, mobile deps
  (`react-native-gesture-handler` + `react-native-reanimated`), a thumbnail grid + full-screen
  pan/zoom viewer, and a "View photos" action on the Folders card — **needs a new EAS build**.
  Listing orders by committedAt (backup time), not capture date — a later nicety.

---

### 2026-07-26T13:15+0100 — feat/ui-overhaul — UI/UX overhaul: "graphite + one spark" design system (both apps)

- **Done:** replaced the beta-scaffolded look with one shared design language across mobile +
  desktop (agent_design §7 "graphite + one spark"): near-monochrome zinc palette, a single accent
  (blue #2563EB / #3B82F6) on the primary action only, depth via **elevation** (surfaces float,
  interactive elements sink on press) — never gradients, no border except a hairline separator, flat
  fills, Lucide icons. Light + dark, follows the OS.
  - **Mobile:** new token layer `src/theme/` (`tokens.ts` roles/scale/elevation + `useTheme()`) and a
    primitive set `src/components/` (`Button`, `IconButton`, `Card`, `StatusPill`, `ProgressBar`,
    `Divider`, `Icon`, `Text`, `Screen`). Home, Folders, Transfers + the nav header are rebuilt on it
    — every hard-coded hex and every `borderWidth` on a card/button is gone (those violated §2/§7).
    `StatusPill` maps engine states to the §2 status vocabulary. Every handler/native call preserved
    verbatim — a pure presentational change.
  - **Desktop:** `theme.css` (the same tokens as CSS custom properties + component classes) imported
    in `main.tsx`; the Pairing and Destinations panels are restyled from browser-default HTML onto
    cards/buttons/pills/chips with `lucide-react` icons. All bridge logic preserved.
  - **Icons:** `lucide-react-native` (mobile, via `react-native-svg`) + `lucide-react` (desktop),
    both v1.26 → pixel-identical shapes on both sides.
- **Files:** mobile `src/theme/{tokens,index}.ts`, `src/components/*` (10 new),
  `app/{_layout,index,folders,transfers}.tsx`, `package.json` (+`react-native-svg` 15.15.4, +`lucide-react-native`); desktop `src/renderer/src/{theme.css (new),main.tsx,App.tsx,PairingPanel.tsx,DestinationsPanel.tsx}`,
  `package.json` (+`lucide-react`); `docs/agent_design.md` (§2/§4 tightened, new §7 design system,
  old current-state → §8).
- **Build:** `react-native-svg` is a new native module → the first APK to include it is EAS dev build
  **`24bd5a3a`** (triggered from apps/mobile). Icons render only after installing that APK; the rest
  of the overhaul is pure JS (Metro reload). Awaits compile + device verification of the new look.
- **Gates:** `pnpm -r typecheck` (6 projects) + `eslint` clean; contracts 72 + desktop 190 tests
  green (unchanged — presentational); prettier/`format:check` clean (last).
- **PR:** `feat/ui-overhaul` — background-sync merged (#23, `d7ff811`), so this branch was
  **rebased onto main** (`git rebase --onto origin/main feat/background-sync`); the PR diff is now
  design-only (26 files, no native/background-sync files). Open + squash-merge.
- **Docs updated:** `agent_design.md` (the design language is now codified in §7), this record.
- **Follow-ups:** device-verify the new look + icons on the Samsung. Still open from prior sessions:
  per-OEM battery-exclusion screen (spec 14.8), deletion propagation (spec 19), richer service states
  (spec 14.5), large-folder stress test. A shared cross-platform `packages/ui` stays deferred (RN and
  the DOM don't share component code; token values are kept in lockstep + documented in §7).

### 2026-07-26T12:08+0100 — feat/background-sync — Automatic background sync: auto-start the foreground service (spec 14)

- **Done:** closed the "sync only runs when I press Sync now" gap. The foreground service already
  drove `SyncEngine.runSync` on its worker loop, but nothing started it. Now it **auto-starts from
  the foreground** (spec 14.3's legal start path — deliberately no `BOOT_COMPLETED` receiver, which
  the spec says must be per-SDK-tested and which Samsung's battery manager kills anyway, spec 14.8;
  reopening the app resumes it). A durable **default-on `auto_sync` preference** (service
  SharedPreferences) is the on/off truth: `ensureBackgroundSync()` (Folders mount + after adding a
  folder) starts the service iff the pref is on AND an enabled root exists;
  `setBackgroundSyncEnabled(enabled)` is the new Folders toggle; the notification **Stop** now
  writes the pref off too, so a reopen doesn't silently restart it. The worker loop's **wake lock is
  now scoped to each work pass** (acquire → `runSync` → release) instead of held across the idle
  sleep (spec 14.6 — a continuously-held lock drains battery + trips OEM killers). Once running the
  loop rescans due roots every 15 min (`SCAN_INTERVAL_MS`) and drains + cleans every ~10 s, so
  new/changed files back up with the app closed. `getServiceStatus` now returns `autoSyncEnabled`;
  Folders shows an "Automatic background sync" card with the live state + toggle.
- **Files:** `FolderSyncService.kt` (wake-lock scope, `KEY_AUTO_SYNC`, Stop writes the pref),
  `FolderSyncModule.kt` (`setBackgroundSyncEnabled`/`ensureBackgroundSync` + `autoSyncEnabled` in
  status), `modules/foldersync-native/src/index.ts`, `apps/mobile/src/native/service.ts`,
  `apps/mobile/app/folders.tsx`.
- **Build:** compiles on EAS (build `1d61d439`, KSP2/Room 2.7). Awaits device verification: add a
  folder, close the app, drop in a new file → it should back up within ~15 min with no manual
  trigger.
- **Gates:** `pnpm -r typecheck` + `eslint` clean (6 projects); contracts 72 + desktop 190 tests
  green (unchanged — phone-only); prettier last.
- **PR:** `feat/background-sync` off main (stacked cleanly on the merged retention-cleanup #22) —
  open + squash-merge.
- **Docs updated:** this record, `agent_native.md`.
- **Follow-ups:** device-verify background sync; a per-OEM battery-exclusion guidance screen
  (spec 14.8) so Samsung doesn't kill the service; `deletion_event` propagation
  (`mirror_user_deletions`, spec 19); richer service states (spec 14.5) + network-callback-driven
  wakeups instead of the 10 s poll (spec 14.6); batch Room writes for very large first scans.

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
