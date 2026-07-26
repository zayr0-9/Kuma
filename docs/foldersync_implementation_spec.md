# FolderSync: Android-to-Desktop LAN Backup and Synchronisation Specification

**Document status:** Implementation-ready architecture and product specification  
**Research baseline:** 25 July 2026  
**Working product name:** FolderSync  
**Primary mobile target:** Android  
**Mobile framework:** React Native with Expo development builds  
**Desktop framework:** Electron + Vite + React  
**Primary language:** TypeScript, with a deliberately narrow Kotlin Android module  
**Primary transport:** HTTPS over the local network, with DNS-SD/mDNS discovery and tus resumable uploads

---

## 1. Purpose of this document

This document is the single source of truth for implementing the first version of FolderSync. It records:

- The product behaviour.
- The architecture.
- The division of responsibility between React Native, Kotlin, Electron and Node.js.
- The Android operating-system constraints.
- The network protocols and reusable libraries.
- The data and deletion semantics.
- Security requirements.
- Development setup, including the decision not to install the Android toolchain on the work Mac initially.
- Testing, rollout and acceptance criteria.
- Decisions that were considered and rejected, with reasons.

An implementation agent should follow this document rather than improvising a different sync model. Where a detail is explicitly marked as a spike or an open decision, the agent should test it and record the result before broad implementation.

---

## 2. Product summary

FolderSync is a local-first Android application with a desktop companion.

The Android user explicitly selects one or more individual directories using Android's system folder picker. The application receives scoped access only to the selected directory trees. When the phone and a paired desktop are on the same LAN/Wi-Fi network, FolderSync discovers the desktop companion and copies new or changed files to configured desktop destinations.

Each selected phone directory has independent policies:

1. **Phone retention policy**
   - Keep the file on the phone after a verified desktop backup.
   - Delete the phone copy only after the desktop confirms a durable, verified commit.

2. **Desktop deletion policy**
   - Preserve the desktop copy when the user later removes the phone copy.
   - Mirror genuine user/external phone deletions by moving the desktop copy into managed trash.

The application is intentionally a **phone-to-desktop backup/synchronisation product**, not a generic bidirectional distributed filesystem.

---

## 3. Goals

### 3.1 Product goals

- Let the user select individual Android directories through the system picker.
- Avoid broad storage permissions such as `MANAGE_EXTERNAL_STORAGE`.
- Back up files automatically while the desktop companion is reachable on the same LAN.
- Continue active transfers after the React Native interface is backgrounded by using a user-visible Android foreground service.
- Survive Wi-Fi loss, process death and application restarts without corrupting files or restarting large uploads from zero.
- Support large files such as camera videos.
- Never delete the phone copy before the desktop has durably committed and verified the file.
- Never interpret loss of directory permission, unavailable storage or a failed scan as mass deletion.
- Make destructive behaviour recoverable through desktop trash and version-aware checks.
- Keep all file contents on the local network; no cloud relay is required.
- Use existing protocols and maintained libraries for discovery, TLS/HTTP and resumable transfer.
- Keep the development loop fast for TypeScript and React work.

### 3.2 Engineering goals

- Strict TypeScript for the mobile UI, desktop companion and shared wire contracts.
- A small, explicit Kotlin boundary for Android-only lifecycle and storage work.
- Persist all durable mobile sync state in a native Room database so the foreground service does not depend on the JavaScript runtime.
- Persist desktop state in SQLite.
- Use idempotent control endpoints and durable state machines.
- Make the transfer implementation replaceable without changing product semantics.
- Keep the first implementation narrow enough for an agent to complete and test vertically.

---

## 4. Non-goals for the first version

The following are explicitly out of scope for the initial implementation:

- General two-way synchronisation.
- Propagating desktop edits or desktop deletions back to the phone.
- Filesystem block-level delta synchronisation.
- Peer-to-peer internet transfer outside the LAN.
- Cloud accounts, cloud relay servers or user registration.
- iOS support.
- Multiple simultaneous destination desktops for one root.
- Android root storage access.
- Access to `Android/data` or `Android/obb`.
- Full Syncthing protocol compatibility.
- WebDAV server compatibility.
- End-to-end encrypted cloud storage.
- Real-time filesystem watching as a correctness dependency.
- Permanent deletion of desktop files immediately after a phone deletion.
- Deduplication across unrelated selected roots in version one.

Automatic two-way synchronisation stays out of scope. Letting the user **browse and download** their already-backed-up files from the phone on demand is a read-only companion capability (section 6.6), not reverse synchronisation: nothing is pushed to the phone automatically and desktop state is never altered by it.

These can be considered later only after the Android-to-one-desktop vertical slice is reliable.

---

## 5. Core user experience

### 5.1 First-run flow

1. User installs the Android application and desktop companion.
2. Desktop starts a local HTTPS service and advertises it through DNS-SD/mDNS.
3. Desktop shows a pairing QR code and optional short manual pairing code.
4. User opens the Android application and scans the QR code.
5. Phone verifies the desktop's pinned public-key identity and completes one-time pairing.
6. User selects a destination base directory on the desktop.
7. User taps **Add folder** on Android.
8. Android's system directory picker opens.
9. User selects a directory such as `DCIM/Camera`, `Pictures/Screenshots` or `Documents/Receipts`.
10. User selects the desktop destination and policies for that directory.
11. User enables the ongoing sync service. Android displays a persistent notification.
12. The first scan and backup begins.

### 5.2 Folder list

Each selected root should display:

- Friendly folder name.
- Provider/path hint supplied by Android where available.
- Desktop destination relative path.
- Phone retention policy.
- Desktop deletion policy.
- Last successful scan.
- Last successful transfer.
- Pending file count and bytes.
- Current permission/access state.
- Last error, if any.
- Pause/resume control.

Example:

```text
Camera
DCIM/Camera
Desktop: Photos/Phone Camera
Keep on phone
Preserve desktop copies
Last synced 2 minutes ago
3 files pending · 412 MB
```

### 5.3 Ongoing notification

When the service is enabled, show a non-misleading foreground-service notification.

Idle example:

```text
FolderSync is active
Waiting for Karn-PC on Wi-Fi
[Sync now] [Pause] [Stop]
```

Transfer example:

```text
FolderSync is backing up
Karn-PC · 18 files · 1.4 GB remaining
[Pause] [Stop]
```

The notification represents a foreground service; the notification itself is not what keeps the app alive.

### 5.4 Error UX

Errors must be actionable and scoped. Examples:

- **Folder access lost:** “Select this folder again. No desktop files were changed.”
- **Desktop disk full:** “Backup paused. Free space on Karn-PC.”
- **Desktop certificate changed:** “The identity of Karn-PC changed. Pair again before syncing.”
- **File changed while uploading:** “The file changed during backup and will be retried.”
- **Phone deletion failed:** “Desktop backup succeeded, but the phone copy could not be removed.”

Never show an inaccessible folder as “empty”.

### 5.5 Mobile screen inventory

- **Onboarding:** explains local-only transfer, scoped folder access and the foreground notification.
- **Pair desktop:** QR scanner, manual-code fallback and discovered-unpaired desktop list.
- **Home:** service state, connected desktop, total pending files/bytes and recent errors.
- **Folders:** selected roots with per-root status and actions.
- **Add/edit folder:** launches system picker, sets destination mapping and the two policies.
- **Folder gallery:** browses the images already backed up for a folder as a lazy-loaded thumbnail grid; opens one full-screen to pan/zoom and swipe between images; downloads any back to the phone's photo library (section 6.6).
- **Transfers:** active, queued, completed and failed jobs with retry/cancel controls.
- **History:** user-readable operational events, not raw logs.
- **Settings:** automatic sync, Wi-Fi-only behaviour, notification permission, battery-management guidance (section 14.8), diagnostics and paired devices.

### 5.6 Desktop screen inventory

- **Dashboard:** server/discovery state, connected phones, current transfers and destination health.
- **Pairing:** timed QR/code window with explicit cancel.
- **Phone detail:** approved roots, destination mappings and revocation.
- **Destinations:** choose/manage local destination directories and show free space.
- **History:** commits, trash operations, conflicts and errors.
- **Settings:** desktop name, port, start-at-login, tray behaviour, trash retention and diagnostics.

The renderer should remain a thin status/configuration client. It must never receive bearer tokens, private keys or unrestricted filesystem APIs.

---

## 6. Product semantics

### 6.1 Independent policies

Do not model folder behaviour as one overloaded enum. Store two independent policies.

```ts
type PhoneRetentionPolicy =
  | 'keep_on_phone'
  | 'delete_after_verified_backup';

type DesktopDeletionPolicy =
  | 'preserve_desktop_copy'
  | 'mirror_user_deletions';
```

This permits all meaningful combinations without ambiguous behaviour.

### 6.2 Deletion causes

Every missing or deleted file must be assigned a cause.

```ts
type DeletionCause =
  | 'retention_cleanup'
  | 'user_or_external_deletion';
```

A file removed by FolderSync because `delete_after_verified_backup` is enabled must **never** generate a desktop deletion.

### 6.3 One-way authority

The phone is authoritative for backup inputs, but the desktop is not treated as a disposable mirror.

- New or changed phone file: upload to desktop.
- Desktop file missing while phone file still exists: upload it again.
- Desktop file changed outside FolderSync: preserve the external version before replacing or deleting it.
- Desktop deletion: does not delete the phone copy.
- Phone deletion: may preserve or trash the desktop copy according to policy.

### 6.4 Desktop deletion means trash, not immediate erasure

When `mirror_user_deletions` applies, the desktop companion moves the corresponding file to managed trash, for example:

```text
<destination-root>/.foldersync-trash/<timestamp>/<relative-path>
```

Recommended default retention: 30 days. In the MVP, permanent purging is an explicit manual desktop action, not a background timer; the retention setting controls what the manual purge offers to remove. Automatic scheduled purging is deferred.

### 6.5 Safe replacement

Before replacing an existing destination file, compare it with the last version FolderSync committed.

- If unchanged: atomically replace it.
- If it differs from the last committed version but its SHA-256 equals the staged upload's SHA-256: adopt the existing file in place, record the commit against it and skip both the conflict copy and the replacement. This prevents a conflict explosion when a re-paired or reinstalled phone re-uploads content that already exists at the destination.
- If changed externally and the content differs: first move the current file to `.foldersync-conflicts` or a version-history location, then commit the phone version.
- If the filesystem cannot atomically move within the destination volume: fail safely and do not acknowledge the phone upload as committed.

### 6.6 Remote read access and restore

The desktop holds the authoritative copy of every backed-up file, including files the phone has since removed under `delete_after_verified_backup`. FolderSync lets the user browse and retrieve those copies from the phone on demand:

- The phone lists a folder's committed image files from the desktop (paginated, lazy-loaded thumbnails generated on the desktop). It does not keep its own copy of the desktop inventory — the desktop is the source of truth for what is backed up.
- The user may open a file full-screen (pan/zoom, swipe between images) and download it back to the phone's photo library.

This is read-only and user-initiated. It does not weaken one-way authority (section 6.3): no file is pushed to the phone automatically, a download never deletes or alters the desktop copy, and it is not reverse synchronisation. Version one covers images; other media types are deferred.

---

## 7. Key architecture decisions

| Decision | Why | Advantages | Costs / disadvantages |
|---|---|---|---|
| Android system directory picker and Storage Access Framework | Matches scoped-storage standards and user intent | No broad storage permission; Play-friendly; per-folder control | Some roots cannot be selected; provider metadata can be inconsistent; recursive traversal can be slow |
| Expo development build rather than Expo Go | Custom Kotlin service and native storage/network integration are required | Retains Expo tooling and Fast Refresh while allowing native code | Native changes require a new development build |
| Native Kotlin service owns durable sync execution | Android may suspend or destroy the React Native runtime in background | Reliable foreground service, SAF access, Room state and resumable work independent of JS | Some logic exists in Kotlin; cannot keep everything TypeScript-only |
| React Native owns UI and user configuration | Expo/React provides fast product iteration | Fast Refresh; shared TypeScript models; simple UX work | Must bridge state/events from Kotlin |
| DNS-SD/mDNS for discovery | Standard LAN service discovery | No invented discovery protocol; human does not type IP addresses | Some networks block multicast; needs manual fallback |
| HTTPS with pinned desktop public key | LAN is not automatically trusted | Prevents silent impersonation and token interception | Requires certificate generation, QR pairing and custom pin handling |
| tus for file transfer | Resumable HTTP upload is already standardised | Pause/resume after network loss; official client/server implementations | Still need a control API and commit workflow around tus |
| Small JSON control API | tus does not model folder policies, manifests or deletion semantics | Easy to version and test | Application-specific protocol must be maintained |
| Room on Android | Native service requires a durable source of truth | Transactions, migrations, survives process death | Duplicates some TypeScript domain types |
| `node:sqlite` on desktop where supported by the selected Electron Node runtime | Avoids native addon rebuild/packaging complexity | Built into Node; synchronous API is appropriate for small local metadata transactions | Must confirm API stability with pinned Electron runtime; fall back to a maintained SQLite library if required |
| Fastify for desktop control API | Mature typed Node HTTP framework with schema validation and documented tus integration | Validation, hooks, logs, straightforward TypeScript | Additional dependency compared with raw Node HTTP |
| Electron main process owns privileged operations | Renderer must not have filesystem or network-server authority | Strong security boundary | Requires narrow IPC API |
| Desktop staging directory inside destination volume | Enables atomic rename into final location | Prevents partially written visible files | Consumes destination space until commit |
| Server-side SHA-256 after upload | Durable integrity/version identity without reading every phone file twice | Simple mobile pipeline; detects stored content identity | Desktop performs an additional read after upload; delete-eligible files also require a phone-side verification read before cleanup (section 19.2) |
| Bounded upload pool (default 3) + pipelined commit | Sequential single-stream + blocking commit poll left throughput and latency on the table | Higher throughput; no per-file gap; safe since `claimNextJob` is atomic and the desktop already commits paths in parallel | Slightly more concurrency to reason about (foreground notification, cancellation, disk accounting) |
| Work Mac uses EAS cloud builds initially | Avoid installing a personal Android toolchain on a work-owned machine | Minimal setup and policy footprint | Slow iteration when changing Kotlin/native configuration |
| Personal Ubuntu machine becomes native build/debug environment later | Better ownership and local native debugging | Fast Gradle rebuilds, `adb`, Logcat | Requires a second environment and repository sync |

---

## 8. Why existing complete sync products are not embedded

### 8.1 Syncthing

Syncthing already solves full multi-device, bidirectional synchronisation, block exchange, conflict handling, discovery and encrypted transport. Embedding its engine or recreating its Block Exchange Protocol would introduce far more complexity than this product needs.

FolderSync needs a deliberately smaller semantic model:

- Android-selected roots.
- One-way phone-to-desktop transfer.
- Verified delete-after-backup.
- Optional preservation or trashing of the desktop copy.

Syncthing remains a useful behavioural reference, not an implementation dependency.

### 8.2 WebDAV

WebDAV is useful for generic remote filesystem operations, but does not by itself solve:

- Durable resumable upload state on Android.
- Pairing and public-key pinning.
- Phone retention cleanup acknowledgements.
- Distinguishing app cleanup from user deletion.
- Version-aware deletion and conflict preservation.

Using tus plus a narrow control API is a better fit.

### 8.3 SMB/SFTP

SMB and SFTP would require managing desktop credentials and exposing a broad filesystem-oriented server. They do not naturally model the required commit/deletion state. They are not selected for the first version.

---

## 9. High-level architecture

```text
┌─────────────────────────────────────────────────────────────────┐
│ Android application                                              │
│                                                                  │
│ React Native / Expo UI                                           │
│ ├─ Navigation and screens                                        │
│ ├─ Pairing UI and QR scanner                                     │
│ ├─ Folder policy forms                                           │
│ ├─ Status/history UI                                             │
│ └─ Typed Expo Module calls and event subscriptions               │
│                                                                  │
│ Kotlin Expo module + Android service                             │
│ ├─ ACTION_OPEN_DOCUMENT_TREE integration                         │
│ ├─ Persisted URI grants                                          │
│ ├─ Room database                                                 │
│ ├─ Foreground service + notification actions                     │
│ ├─ ConnectivityManager / Wi-Fi awareness                         │
│ ├─ Android NsdManager DNS-SD discovery                           │
│ ├─ Recursive SAF scanner                                         │
│ ├─ Sync planner and durable queues                               │
│ ├─ Pinned HTTPS control client                                   │
│ └─ tus Android/Java resumable uploader                           │
└──────────────────────────────┬──────────────────────────────────┘
                               │ LAN Wi-Fi
                               │ DNS-SD + pinned HTTPS + tus
┌──────────────────────────────▼──────────────────────────────────┐
│ Electron desktop companion                                      │
│                                                                  │
│ Renderer (unprivileged React UI)                                 │
│ └─ Settings, pairing, destinations, history, status              │
│                                                                  │
│ Preload                                                          │
│ └─ Narrow typed contextBridge API                                │
│                                                                  │
│ Main process / local daemon                                      │
│ ├─ Fastify control API                                           │
│ ├─ @tus/server upload endpoint                                   │
│ ├─ DNS-SD advertisement                                          │
│ ├─ TLS identity and pairing                                      │
│ ├─ SQLite metadata                                               │
│ ├─ Destination/staging/trash management                          │
│ ├─ Hashing workers                                               │
│ └─ Notifications/logging                                         │
└─────────────────────────────────────────────────────────────────┘
```

---

## 10. Repository structure

Use a pnpm workspace. Do not introduce Turborepo unless build orchestration becomes a demonstrated problem.

```text
foldersync/
├── apps/
│   ├── mobile/
│   │   ├── app/                         # Expo Router screens
│   │   ├── src/
│   │   │   ├── components/
│   │   │   ├── features/
│   │   │   ├── hooks/
│   │   │   ├── native/                 # Typed wrapper around Expo module
│   │   │   └── state/                  # UI-only state
│   │   ├── app.config.ts
│   │   └── eas.json
│   └── desktop/
│       ├── src/
│       │   ├── main/
│       │   │   ├── api/
│       │   │   ├── auth/
│       │   │   ├── db/
│       │   │   ├── discovery/
│       │   │   ├── storage/
│       │   │   ├── sync/
│       │   │   └── workers/
│       │   ├── preload/
│       │   └── renderer/
│       └── electron.vite.config.ts
├── modules/
│   └── foldersync-native/
│       ├── android/src/main/java/.../
│       │   ├── FolderSyncModule.kt
│       │   ├── storage/
│       │   ├── db/
│       │   ├── service/
│       │   ├── discovery/
│       │   ├── network/
│       │   └── transfer/
│       └── src/index.ts                 # TypeScript Expo module surface
├── packages/
│   ├── contracts/                       # Zod wire schemas and shared TS types
│   ├── protocol/                        # Endpoint constants and protocol version
│   ├── ui/                              # Optional shared presentational pieces only
│   ├── test-fixtures/                   # Golden JSON and file-tree fixtures
│   └── tooling/                         # Shared tsconfig/eslint config
├── docs/
│   ├── architecture-decisions/
│   └── protocol/
├── package.json
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── tsconfig.base.json
└── README.md
```

### 10.1 Shared-code rule

Share code only when it is genuinely platform-independent.

Share:

- Wire names and endpoint paths.
- Zod schemas used by TypeScript clients/server.
- UI types.
- Golden JSON fixtures.
- Constants such as protocol version.

Do not force-share:

- Android SAF scanning.
- Android foreground-service state.
- Desktop filesystem operations.
- SQLite implementation code.

Kotlin DTOs may mirror TypeScript wire schemas. Prevent drift with contract tests using identical JSON fixtures rather than introducing a complex code-generation pipeline in the MVP.

---

## 11. Technology baseline

Versions below describe the research baseline. The implementation agent must use the latest stable patch compatible with the chosen major and commit an exact lockfile.

### 11.1 Root tooling

- Node.js 24 LTS. Research baseline: Node 24.18.0.
- pnpm through Corepack.
- TypeScript strict mode.
- ESLint flat configuration.
- Prettier.
- Vitest for TypeScript unit/integration tests.
- Conventional commits are optional; clear changesets are more important than ceremony.

### 11.2 Mobile UI

- Expo SDK 57 at research date, or current stable Expo SDK when bootstrapped.
- React Native version selected by Expo.
- Expo Router.
- `expo-dev-client`.
- `expo-camera` for QR/barcode scanning.
- Zustand only for transient UI state; do not treat it as durable sync state.
- TanStack Query is optional and probably unnecessary for a local native module API in the first version.

### 11.3 Android native module

- Kotlin.
- Expo Modules API.
- AndroidX Activity Result APIs.
- Android Storage Access Framework through `ACTION_OPEN_DOCUMENT_TREE`.
- AndroidX `DocumentFile` or direct `DocumentsContract`/`ContentResolver` queries where performance requires it.
- Room for durable state.
- Kotlin coroutines.
- Kotlinx Serialization for control-protocol JSON.
- Android `ConnectivityManager` and `NetworkCallback`.
- Android `NsdManager` for DNS-SD discovery.
- Official `tus-java-client` plus `tus-android-client` for direct `content://` URI uploads.
- Custom `TusClient` subclass for authentication and pinned TLS configuration.
- Android Keystore-backed token encryption.
- WorkManager for recovery/maintenance work, not as the primary active transfer engine.

### 11.4 Desktop

- Electron 43 stable line at research date. Research baseline: 43.2.0.
- Electron-vite.
- React.
- Fastify 5.
- JSON/Zod validation through an appropriate Fastify type provider or explicit adapters.
- `@tus/server`, not the legacy `tus-node-server` package.
- `@tus/file-store` or the current file-store package paired with `@tus/server`.
- `@homebridge/ciao` for DNS-SD advertisement, subject to the network spike. `bonjour-service` is an acceptable fallback if ciao fails on required desktop platforms.
- `node:sqlite`, if verified stable enough in the pinned Electron Node runtime.
- Node `crypto`, `fs`, `path`, `os`, `worker_threads`.
- `qrcode` for pairing QR rendering.
- `electron-builder` for initial cross-platform packaging unless the chosen electron-vite starter has a demonstrably better maintained packaging preset.
- A maintained X.509 generation library such as `@peculiar/x509`, pinned and audited, because Node does not provide a convenient complete self-signed-certificate builder.
- Electron `safeStorage` for desktop secrets where available.
- Pino/Fastify logging with redaction.

### 11.5 Dependencies not selected

- `react-native-zeroconf`: not needed because discovery must work in the native background engine. Use Android `NsdManager` directly.
- `expo-sqlite` as the sync database: the native service must own durable state even when React Native is not running. Room is the source of truth.
- `tus-js-client` on Android: it works in React Native but would tie active uploads to the JS runtime. Use the official Android/Java clients in the service.
- `better-sqlite3`: avoid a native Electron addon unless `node:sqlite` proves unsuitable.
- A generic React Native foreground-service package: the service is core product infrastructure and should be implemented in the local Expo Kotlin module.

---

## 12. Android scoped directory access

### 12.1 Required approach

Use `ACTION_OPEN_DOCUMENT_TREE`. This lets the user grant access to one directory and all of its descendants.

The application must request read and write access because it may delete phone files after verified backup.

Required intent flags include the appropriate combinations of:

- `FLAG_GRANT_READ_URI_PERMISSION`
- `FLAG_GRANT_WRITE_URI_PERMISSION`
- `FLAG_GRANT_PERSISTABLE_URI_PERMISSION`
- `FLAG_GRANT_PREFIX_URI_PERMISSION`

After selection, call `ContentResolver.takePersistableUriPermission()` using the granted read/write flags.

### 12.2 Android restrictions

On Android 11 and later, the picker cannot grant the application:

- The root of internal storage.
- The root of a reliable SD-card volume.
- The top-level `Download` directory.
- `Android/data`.
- `Android/obb`.

The UI must not imply that these can be selected. A subdirectory such as `Download/FolderSync` may be selectable depending on provider behaviour.

### 12.3 Persisted permission is not permanent truth

Persisted access can become unusable because:

- The user revokes access.
- App data is cleared.
- The directory is moved or removed.
- An SD card is removed or replaced.
- The document provider fails temporarily.

Every scan must explicitly test root accessibility. Failure means `access_lost` or `temporarily_unavailable`, never “all files deleted”.

### 12.4 Selected-root model

```ts
interface SyncRoot {
  id: string;
  treeUri: string;
  displayName: string;
  providerAuthority: string | null;
  desktopDeviceId: string;
  desktopRelativePath: string;
  phoneRetentionPolicy: PhoneRetentionPolicy;
  desktopDeletionPolicy: DesktopDeletionPolicy;
  enabled: boolean;
  status:
    | 'draft'
    | 'ready'
    | 'scanning'
    | 'syncing'
    | 'paused'
    | 'access_lost'
    | 'error';
}
```

### 12.5 Overlapping roots

Selecting both `DCIM` and `DCIM/Camera` can duplicate uploads.

The application should attempt to detect ancestor/descendant overlap using document IDs and tree URIs. Providers are not perfectly consistent, so:

- Block overlap when confidently detected.
- Warn when overlap is possible but uncertain.
- Add a desktop uniqueness guard using `(deviceId, rootId, relativePath)` so accidental overlap does not silently overwrite unrelated mappings.

Destination overlap must also be blocked on the desktop: reject any new root mapping whose destination path is equal to, an ancestor of or a descendant of an existing mapping's destination path. The `(deviceId, rootId, relativePath)` guard alone does not prevent two roots from writing into the same or nested destination directories.

### 12.6 Relative paths

Build relative paths from the selected tree root rather than trusting arbitrary filenames from the network.

Wire-format path rules:

- Separator is `/` regardless of platform.
- No leading `/`.
- No empty segments.
- Reject `.` and `..` segments.
- Reject NUL.
- Preserve Unicode names but normalise to NFC for comparison.
- Retain the original display name for UI.
- Desktop performs platform-specific validation before commit.

---

## 13. Android native module boundary

### 13.1 Principle

The TypeScript interface should be small and declarative. React Native asks for actions and observes state; it does not run the background sync loop.

### 13.2 Proposed module API

```ts
export interface FolderSyncNativeModule {
  pickDirectory(): Promise<PickedDirectory>;

  createRoot(input: CreateRootInput): Promise<SyncRootDto>;
  updateRoot(input: UpdateRootInput): Promise<SyncRootDto>;
  removeRoot(rootId: string): Promise<void>;
  listRoots(): Promise<SyncRootDto[]>;

  startSyncService(): Promise<void>;
  pauseSyncService(): Promise<void>;
  stopSyncService(): Promise<void>;
  requestSyncNow(rootId?: string): Promise<void>;

  getServiceStatus(): Promise<ServiceStatusDto>;
  listTransfers(input?: TransferQuery): Promise<TransferDto[]>;
  listEvents(input?: EventQuery): Promise<SyncEventDto[]>;

  startPairingFromQr(payload: string): Promise<PairingResultDto>;
  removePairedDevice(deviceId: string): Promise<void>;
  listPairedDevices(): Promise<PairedDeviceDto[]>;

  retryTransfer(transferId: string): Promise<void>;
  cancelTransfer(transferId: string): Promise<void>;

  // Remote gallery / restore (section 6.6). The desktop is the source of truth; the phone
  // pages the listing and fetches desktop-generated thumbnails / full images into a local
  // cache, returning file URIs the UI renders. The bearer token and pinned TLS stay native.
  listRemoteImages(input: RemoteImageQuery): Promise<RemoteImagePageDto>;
  fetchThumbnail(fileId: string, versionId: string): Promise<LocalMediaUriDto>;
  fetchRemoteImage(fileId: string, versionId: string): Promise<LocalMediaUriDto>;
  downloadRemoteImage(input: DownloadImageInput): Promise<DownloadImageResultDto>;
}
```

### 13.3 Events emitted to React Native

- `serviceStatusChanged`
- `rootStatusChanged`
- `transferProgress`
- `transferCompleted`
- `syncError`
- `pairedDeviceChanged`

Events are for UI freshness only. The UI must re-query native state after reconnecting; events are not the durable event log.

---

## 14. Android foreground service

### 14.1 Purpose

The foreground service is the primary engine while continuous automatic LAN sync is enabled. It:

- Watches relevant network state.
- Discovers paired desktops.
- Scans due roots.
- Runs queued uploads.
- Applies phone-retention cleanup.
- Updates the persistent notification.

### 14.2 Foreground-service type

The phone is continuously interacting with a paired external PC through a network connection. Android's official `connectedDevice` description includes interactions with external devices requiring a network connection, and its documented prerequisites can be satisfied by relevant normal network permissions.

Therefore the intended primary service type is:

```xml
android:foregroundServiceType="connectedDevice"
```

Required declarations include:

```xml
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE" />
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
<uses-permission android:name="android.permission.CHANGE_NETWORK_STATE" />
<uses-permission android:name="android.permission.CHANGE_WIFI_MULTICAST_STATE" />
```

This is not a loophole. Before Play release, verify that:

- The implementation genuinely maintains a paired external-device connection.
- The Play Console declaration accurately describes the feature.
- Current Play policy accepts this categorisation.

Additionally, evaluate associating the desktop through `CompanionDeviceManager` during pairing. A CDM association strengthens the `connectedDevice` classification both technically and at Play review, and can relax some background-start restrictions.

If policy or platform testing rejects it, the fallback is `dataSync`, accepting Android 15's aggregate six-hour background limit, or a current purpose-built user-initiated data-transfer API. The fallback is a product change, not an implementation detail: “continuous sync” becomes sessioned sync, which affects notification copy, scan scheduling and user expectations. Decide the fallback UX during Spike 7, before broad implementation, rather than improvising it after a spike failure.

Do not silently declare multiple types merely to evade restrictions; when multiple types are active Android can enforce requirements for all of them.

### 14.3 Start restrictions

Android 12 and later generally prevent arbitrary foreground-service starts while the application is already in the background.

Required behaviour:

- User enables and starts continuous sync while the application is visible.
- The service can continue when the UI leaves the foreground.
- Do not assume WorkManager can always restart the foreground service invisibly after force-stop or reboot.
- After a reboot, show a clear “Open FolderSync to resume automatic sync” path if automatic restart is not legal/reliable for the target SDK.
- Explicit Android-version tests must decide whether a `BOOT_COMPLETED` restart is permitted for the selected service type. Do not guess.

### 14.4 Notification permission

Android 13 and later have the `POST_NOTIFICATIONS` runtime permission.

- Ask only when the user enables continuous sync.
- Explain that the notification displays active backup status and controls.
- If denied, Android may still surface the foreground service in system task management, but the product experience is degraded. The app should explain this and provide a settings shortcut.

### 14.5 Service lifecycle

Recommended states:

```text
STOPPED
STARTING
IDLE_NO_WIFI
DISCOVERING
IDLE_DESKTOP_OFFLINE
SCANNING
UPLOADING
PAUSED_BY_USER
PAUSED_ERROR
STOPPING
```

The service should be sticky only if justified and tested. Persisted queues, not sticky behaviour, provide correctness.

### 14.6 Resource controls

- Acquire a partial wake lock only while actively scanning or transferring and release it in `finally` blocks.
- Do not hold a wake lock while waiting for the desktop.
- Use a multicast lock only where required for mDNS, and release it when discovery stops.
- Default to one active upload.
- Apply exponential backoff with jitter for network failures.
- Stop repeated discovery attempts when Wi-Fi is absent.
- Do not poll continuously. Use network callbacks plus a modest rescan schedule.

### 14.7 WorkManager role

Use WorkManager for:

- Persisted maintenance.
- Cleanup of old local logs.
- Retrying non-urgent metadata work.
- Recovery checks after app/process restarts where permitted.

Do not use WorkManager as the core transfer state machine. It is deferrable and does not provide an always-on LAN daemon guarantee.

### 14.8 OEM battery management

Samsung and other OEM battery managers can kill even a correctly typed foreground service. `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` is Play-restricted and must not be requested for this use case. Instead, provide a user-facing battery-settings guidance screen with per-OEM instructions for excluding FolderSync from aggressive battery management, reachable from Settings and from any “service was stopped unexpectedly” diagnostic. Spike 2 records the observed Samsung behaviour this screen must address.

---

## 15. Android local-network permissions

Local-network permissions are evolving.

- Android 16 introduces opt-in local-network protection behaviour.
- Android 17 is expected to enforce a dedicated local-network runtime permission for apps targeting its SDK.
- TCP to private addresses, UDP multicast/mDNS, `.local` resolution and `NsdManager` can all be affected.

Implementation requirements:

- Isolate local-network permission requests in one native permission manager.
- Provide a user-facing rationale: “FolderSync needs local-network access to find and connect directly to your paired computer. Files do not pass through our servers.”
- Do not request location permission unless a platform API genuinely requires it.
- Test the app on current Android 16 behaviour and add Android 17 support when target SDK 37 is adopted.

---

## 16. Mobile database

Room is the mobile source of truth.

### 16.1 Tables

#### `paired_device`

- `id` text primary key
- `display_name`
- `service_instance_name`
- `tls_spki_sha256`
- `encrypted_auth_token`
- `last_known_host`
- `last_known_port`
- `protocol_version`
- `paired_at`
- `last_seen_at`
- `revoked_at`

#### `sync_root`

- `id` text primary key
- `tree_uri`
- `display_name`
- `provider_authority`
- `desktop_device_id`
- `desktop_relative_path`
- `phone_retention_policy`
- `desktop_deletion_policy`
- `enabled`
- `status`
- `created_at`
- `updated_at`
- `last_complete_scan_at`
- `last_successful_sync_at`
- `last_error_code`
- `last_error_message`

#### `scan_run`

- `id` text primary key
- `root_id`
- `generation` integer
- `started_at`
- `completed_at`
- `status`: running/completed/failed/cancelled
- `files_seen`
- `bytes_seen`
- `error_code`

#### `file_entry`

- `id` text primary key
- `root_id`
- `document_uri`
- `document_id` nullable
- `relative_path`
- `display_name`
- `mime_type`
- `size_bytes`
- `last_modified_ms` nullable
- `last_seen_generation`
- `local_state`
- `remote_version_id` nullable
- `remote_sha256` nullable
- `last_committed_size` nullable
- `last_committed_modified_ms` nullable
- `missing_confirmation_count`
- `retention_cleanup_expected` boolean
- `created_at`
- `updated_at`

Unique constraint: `(root_id, relative_path)` after normalisation.

#### `transfer_job`

- `id` text primary key
- `root_id`
- `file_entry_id`
- `operation`: upload/delete_remote
- `state`
- `attempt_count`
- `next_attempt_at`
- `tus_upload_url` nullable
- `bytes_uploaded`
- `expected_size`
- `desktop_prepare_id` nullable
- `last_error_code`
- `last_error_message`
- `created_at`
- `updated_at`

#### `deletion_event`

- `id` text primary key
- `root_id`
- `file_entry_id`
- `relative_path`
- `cause`
- `expected_remote_version_id`
- `state`
- `detected_at`
- `confirmed_at`
- `applied_at`

#### `sync_event`

- `id` integer primary key autoincrement
- `severity`
- `event_type`
- `root_id` nullable
- `file_entry_id` nullable
- `message`
- `redacted_details_json`
- `created_at`

### 16.2 Transactions

Use transactions for every state transition that must survive a crash, particularly:

- Scan completion plus missing-file marking.
- Desktop commit acknowledgement plus `remote_version_id` update.
- Marking retention cleanup expected before deleting the phone file.
- Creating a remote-deletion job.

---

## 17. Scan engine

### 17.1 Scan trigger

Scan a root when:

- User requests **Sync now**.
- The service discovers its paired desktop and the root is due.
- The configured scan interval expires while the service is active.
- A previous scan was interrupted.

Do not assume Android document providers emit reliable recursive change notifications.

### 17.2 Scan algorithm

1. Create `scan_run` with a new monotonically increasing generation.
2. Confirm root URI access.
3. Recursively enumerate children.
4. For each regular file:
   - Construct safe relative path.
   - Read stable metadata available from the provider.
   - Upsert `file_entry`.
   - Set `last_seen_generation` to the current generation.
   - If new or changed by candidate metadata, enqueue upload planning.
5. Only after complete traversal succeeds:
   - Mark `scan_run` complete.
   - Evaluate entries not seen in this generation.
   - Update missing confirmation state.
6. If traversal fails or is cancelled:
   - Mark the scan failed.
   - Do not create deletion events.

### 17.3 Change candidate rules

Treat a file as a candidate when any of these changes:

- Relative path.
- Size.
- Last modified timestamp where reliable.
- Provider document ID/URI.
- Desktop reports the committed file missing.

Do not hash every unchanged phone file on every scan. The desktop computes SHA-256 after upload. If a provider supplies unreliable timestamps, allow a later “strict verification” mode that hashes candidates or periodically revalidates a sample.

Where a provider returns a `lastModified` of zero or otherwise unreliable timestamps, change detection silently degrades to path-plus-size only. Flag such roots in diagnostics and the event log so the deferred strict-verification mode has a trigger signal.

Before enqueueing an upload, require the candidate to be quiescent: size and modified time unchanged across two observations, or a minimum file age of 30–60 seconds. This avoids uploading files that are still being written — most importantly a camera video that is currently recording — only to supersede and retry a multi-gigabyte transfer.

### 17.4 File changes during upload

Record size and modified time before starting. After upload, query again where possible.

If the source changed during upload:

- Do not apply delete-after-backup.
- Mark the uploaded desktop version as superseded or abort commit where possible.
- Enqueue a retry for the current source version.

### 17.5 Missing-file confirmation

For genuine phone deletions, use a two-observation rule by default:

- First complete scan where missing: `missing_confirmation_count = 1`.
- Second complete scan where still missing: create `user_or_external_deletion` event.

The two confirming scans must also be separated by a minimum wall-clock gap (default: 15 minutes). Back-to-back scans — for example a manual **Sync now** immediately after a scheduled scan — must not both count, because a transient provider glitch can easily outlive two consecutive scans.

This reduces false deletion propagation from transient document-provider behaviour. A manual user-triggered scan may count as a confirmation if the root is fully accessible.

The desktop copy is moved to trash, so the process remains recoverable even after confirmation.

---

## 18. Upload engine

### 18.1 Direct SAF upload

Use the official tus Android helper that accepts an Android `Uri` and obtains the stream through `ContentResolver`. This avoids copying multi-gigabyte files into application cache.

The client must:

- Obtain size from a file descriptor rather than trusting provider query metadata where necessary.
- Preserve upload URLs for resume.
- Attach the bearer token and protocol headers.
- Use the pinned TLS socket factory/trust manager.
- Close streams and descriptors deterministically.

### 18.2 tus client customisation

Subclass the official `TusClient` and override connection preparation to apply:

- Pinned `SSLSocketFactory`/trust manager.
- Exact authentication header.
- Request ID.
- Protocol version header.
- Conservative connect/read timeouts.

Never install a trust-all certificate manager.

### 18.3 Upload concurrency

The phone drains its transfer queue with a **bounded pool of upload workers** (default 3,
`UPLOAD_CONCURRENCY`, tunable) and a **pipelined commit**:

- Each worker atomically claims its own `transfer_job` (`claimNextJob` is a Room transaction, so
  no two workers take the same file), streams the bytes over tus, then hands the `prepareId` to a
  single commit watcher and immediately claims the next file. A worker never blocks waiting for
  the desktop to hash and commit.
- The commit watcher polls each outstanding `prepareId` to a terminal state and finalises Room
  state (version stamp / retry / park) off the upload path, in parallel with the workers. A
  per-file timeout parks the commit as retryable; the next drain re-prepares and the desktop
  returns `skip` (section 6.5).

This removes both costs of the earlier sequential loop: the single byte-stream (throughput) and
the per-file "gap" spent blocking on the commit poll (latency). The desktop already commits
different `(rootId, relativePath)` paths in parallel (verify → SHA-256 in a worker thread →
atomic rename), so no desktop change is required; the per-path commit serialisation of section
18.5 still holds.

The pool is kept small to stay gentle on the SAF providers, battery and the desktop, and to keep
foreground notification, cancellation (a stop leaves in-flight jobs `uploading` → reclaimed next
drain) and disk-space accounting simple. Raise `UPLOAD_CONCURRENCY`, or add per-connection reuse
(section 39), only after measurement.

### 18.4 Upload metadata

Use tus metadata for transport-adjacent information only:

- `prepareId`
- `deviceId`
- `rootId`
- `fileEntryId`
- `relativePath` encoded safely
- `filename`
- `mimeType`
- `expectedSize`

Authorisation, policy and destination mapping must be validated server-side from the authenticated device and prepare record. Never trust a destination path directly from tus metadata.

### 18.5 Commit sequence

1. Phone calls control API to prepare upload.
2. Desktop validates mapping, path and free space, then returns `prepareId` and tus endpoint.
3. Phone creates or resumes tus upload.
4. tus server writes to staging.
5. Desktop verifies received size.
6. Desktop calculates SHA-256 in a worker thread.
7. Desktop checks destination for external modification/conflict.
8. Desktop atomically moves staged file into final destination.
9. Desktop records a new immutable `remoteVersionId`.
10. Phone calls or receives commit status.
11. Phone updates Room state transactionally.
12. If configured, phone verifies the source content hash (section 19.2), marks retention cleanup expected and deletes the source.

The desktop must not report `committed` before step 8 and metadata transaction completion.

The desktop must serialise commits per `(rootId, relativePath)`. With idempotent retries, a duplicate prepare or commit for the same path can otherwise race the check-destination-then-rename window, even though each phone runs one upload at a time.

---

## 19. Phone cleanup after verified backup

### 19.1 Required ordering

```text
Desktop durable commit
        ↓
Phone stores remoteVersionId and desktop SHA-256
        ↓
Phone re-reads the source and computes SHA-256 locally
        ↓
Hashes match (on mismatch: no deletion, re-enqueue upload)
        ↓
Phone marks retention_cleanup_expected = true
        ↓
Phone deletes source through ContentResolver/DocumentFile
        ↓
Phone records cleanup success
```

If the application crashes after marking cleanup expected but before deletion, it retries cleanup. If it crashes after deletion but before recording success, the next scan recognises that cleanup was expected and does not emit a remote deletion.

### 19.2 Phone-side verification before deletion

The desktop's SHA-256 verifies what the desktop received and durably stored, not that those bytes match the current phone copy. A bad read on the phone — a failing SD card, a document-provider fault — would be hashed and “verified” faithfully. Because `delete_after_verified_backup` destroys the only other copy, the phone must independently verify content before deleting: re-read the source file, compute SHA-256 and compare it with the committed desktop hash.

- On match: proceed with cleanup.
- On mismatch: do not delete. Enqueue a fresh upload and record the event.

This extra read applies only to delete-eligible files; `keep_on_phone` roots never pay it. Do not compute the digest during the tus upload instead: resumed uploads read from an offset, so a single-pass digest does not survive interruption. The separate read is the simple, correct implementation.

### 19.3 Cleanup failure

Desktop backup remains valid. Mark the file `cleanup_failed`, show it in the UI, and permit retry. Do not re-upload the same committed version merely because deletion failed.

### 19.4 User edits before cleanup

Re-query metadata immediately before deletion. If the file changed since the committed upload, cancel cleanup and enqueue the new version.

---

## 20. Desktop companion architecture

### 20.1 Electron security defaults

Create BrowserWindow with:

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true` where compatible
- No remote content.
- A restrictive Content Security Policy.
- No raw `ipcRenderer` exposure.
- No generic filesystem methods exposed to the renderer.

Preload should expose narrowly named methods such as:

```ts
window.folderSync.getStatus()
window.folderSync.chooseDestination()
window.folderSync.startPairing()
window.folderSync.listDevices()
window.folderSync.listEvents()
window.folderSync.updateSettings()
```

### 20.2 Process placement

MVP:

- Fastify server, tus server, DB and discovery run in Electron main.
- SHA-256 and expensive file operations run in worker threads.

Later:

- Move the sync daemon into `utilityProcess` if main-process responsiveness or crash isolation becomes a problem.

Do not begin with a separate system service; packaging and lifecycle complexity are not justified before the vertical slice works.

### 20.3 Desktop startup

Initial behaviour:

- User launches the companion manually.
- Optional “Start at login” setting is added after basic reliability.
- Closing the window may minimise to tray while the daemon remains active, but this must be explicit in UI.
- “Quit FolderSync” must stop the server and advertisement cleanly.

### 20.4 Firewall

The companion listens on a configurable high port, chosen once and persisted unless unavailable.

Requirements:

- Show the actual port in diagnostics.
- Handle Windows/macOS/Linux firewall prompts and documentation.
- If mDNS succeeds but HTTPS cannot connect, surface “Desktop found, connection blocked—check firewall.”
- Provide manual host/port entry as a fallback.

---

## 21. Desktop database

### 21.1 Tables

#### `desktop_identity`

- Singleton ID.
- Device ID.
- Display name.
- Certificate path/reference.
- Public-key pin.
- Created/rotated timestamps.

#### `paired_device`

- Phone device ID.
- Phone display name.
- Hash of bearer token, never plaintext.
- Paired timestamp.
- Last seen timestamp.
- Revoked timestamp.

#### `root_mapping`

- Phone device ID.
- Phone root ID.
- Destination root absolute path.
- Destination relative base.
- Policy snapshot.
- Created/updated timestamp.

Unique key: `(phone_device_id, phone_root_id)`.

#### `remote_file`

- Phone device ID.
- Root ID.
- File entry ID.
- Normalised relative path.
- Current remote version ID.
- SHA-256.
- Size.
- Destination mtime after commit.
- Destination platform file identity where available.
- Commit timestamp.
- State.

#### `upload_prepare`

- Prepare ID.
- Device/root/file IDs.
- Relative path.
- Expected size.
- State.
- tus upload ID/location.
- Created/expires timestamps.

#### `remote_version`

- Version ID.
- File identifiers.
- SHA-256.
- Size.
- Original relative path.
- Commit timestamp.
- Superseded timestamp.

#### `deletion_event`

- Client event ID for idempotency.
- Expected remote version ID.
- Relative path.
- Applied action.
- Trash path.
- Applied timestamp.

#### `event_log`

Redacted operational history.

### 21.2 SQLite choice

Prefer `node:sqlite` because Electron 43 embeds Node 24 and this avoids native addon rebuilds. Before finalising:

- Run a packaged-app read/write/migration test on each supported desktop OS.
- Confirm required APIs are not behind flags.
- Confirm backup/export behaviour.

If this spike fails, use a maintained pure-WASM SQLite solution or a carefully packaged native library. Do not switch casually without recording an ADR.

---

## 22. Desktop storage layout

For each mapped destination root:

```text
<destination>/
├── <normal user-visible backed-up files>
├── .foldersync-staging/
│   └── <prepare-id>.upload
├── .foldersync-trash/
│   └── 2026-07-25T120000Z/<relative-path>
├── .foldersync-conflicts/
│   └── 2026-07-25T120000Z/<relative-path>
└── .foldersync-meta/
    └── README.txt
```

Do not store the primary SQLite database inside every destination root. Store it in the desktop application's data directory. The hidden destination folders contain staged/recoverable content only.

### 22.1 Path safety

For every incoming path:

1. Parse the `/`-separated wire path.
2. Reject absolute paths, drive prefixes, UNC prefixes, empty segments, `.` and `..`.
3. Resolve against the configured destination root.
4. Verify the resolved path remains inside the root.
5. Reject NUL and invalid platform names.
6. On Windows, handle reserved names, trailing periods/spaces, case-insensitive collisions and total-path-length limits; long camera filenames plus deep nesting can exceed `MAX_PATH`.
7. Reject symlink traversal in parent components.
8. Never follow a destination symlink outside the configured root.

### 22.2 Disk space

Before accepting a prepare request, estimate:

- Remaining upload bytes.
- Space required for staging.
- Temporary conflict/version copy if destination exists.
- A safety margin.

Return a structured `insufficient_space` error before transfer where possible.

### 22.3 Staging lifecycle and garbage collection

No staged file may be owned implicitly. On startup and periodically, the desktop reconciles `.foldersync-staging` against the `upload_prepare` table:

- Staged files whose prepare record is expired or unknown are deleted.
- Staged files with an active prepare are retained for resume.

Prepare records and their tus uploads must live long enough to serve the product's headline feature: a multi-gigabyte upload over flaky Wi-Fi can span days. Default prepare lifetime: seven days, renewable while the phone is actively retrying the transfer. Expiry is tied to this staging cleanup policy, not to short HTTP-session assumptions.

### 22.4 Thumbnail cache

Gallery thumbnails (section 6.6) are generated on demand from the committed file using Electron's built-in `nativeImage` — no native image-library dependency — and cached in the desktop application's data directory, keyed by the immutable remote version id and the target size. The cache never lives inside a destination root, holds only derived data, and is safe to delete at any time. Formats `nativeImage` cannot decode fall back to serving the original bytes.

---

## 23. LAN discovery

### 23.1 Standard

Use DNS-Based Service Discovery over multicast DNS.

Service type:

```text
_foldersync._tcp.local
```

Suggested service instance:

```text
Karn-PC._foldersync._tcp.local
```

TXT records must remain small:

```text
v=1
id=<desktop-device-id>
name=<short-display-name>
tls=1
port=<implicit-in-SRV>
```

Do not advertise tokens, secrets, full paths or personal metadata.

### 23.2 Desktop library

Primary candidate: `@homebridge/ciao` because it implements DNS-SD/mDNS in TypeScript without native bindings.

Fallback: `bonjour-service` if ciao has unresolved interoperability issues on required platforms.

A technical spike must test:

- macOS.
- Ubuntu.
- Windows if in the first supported release.
- Network-interface changes.
- Sleep/wake.
- VPN enabled/disabled.
- Multiple active interfaces.

### 23.3 Android discovery

Use native `NsdManager` in the foreground service. Do not route discovery through JavaScript.

Discovery steps:

1. Start only on a suitable Wi-Fi network.
2. Browse `_foldersync._tcp`.
3. Resolve instances.
4. Match advertised desktop device ID to an existing pairing.
5. Connect only with the stored TLS pin and token.
6. Stop or reduce discovery when paired desktop is connected.

### 23.4 Manual fallback

Permit manual entry of:

- Host/IP.
- Port.
- Pairing code or QR identity.

Manual entry never bypasses TLS pinning or pairing.

---

## 24. Pairing and transport security

### 24.1 Threat model

Assume the LAN can contain an attacker capable of:

- Observing multicast advertisements.
- Attempting to impersonate the desktop.
- Connecting to the desktop port.
- Replaying API requests.
- Sending malicious paths and metadata.

The system does not defend against a fully compromised phone or desktop OS.

### 24.2 Desktop identity

On first launch, desktop generates:

- Random stable device ID.
- Private key.
- Self-signed X.509 certificate.
- SHA-256 SPKI pin.

Store the private key encrypted with OS facilities where possible. Electron `safeStorage` can protect secret strings; file permissions must also be restricted.

Do not regenerate identity on every launch.

### 24.3 Pairing window

Desktop opens a five-minute pairing window and generates a 256-bit random one-time secret.

QR payload example:

```text
foldersync://pair?v=1&device=<id>&host=<host>&port=<port>&pin=<base64url-spki>&secret=<base64url-secret>
```

The QR payload is one-time and expires. Do not log it.

Render the QR image in the Electron main process and pass only the rendered image data to the renderer. The raw pairing secret must not enter renderer state, consistent with the rule that the renderer never handles secrets.

### 24.4 Initial TLS verification

The QR-delivered SPKI pin is the initial trust anchor.

The Android client must use a trust manager that accepts only the presented certificate/public key matching the expected pin. A trust-all manager plus a later comparison is forbidden.

Because the desktop address can change, identity is the pinned public key rather than an IP hostname. Any custom hostname handling must still require the exact pin.

### 24.5 Pairing exchange

1. Phone connects to the advertised host and port with the QR pin.
2. `POST /v1/pair` includes one-time secret, phone device ID/name and supported protocol versions.
3. Desktop validates expiry and one-time use.
4. Desktop creates a random long-lived bearer token.
5. Desktop stores only a hash of the token.
6. Phone stores the token encrypted using Android Keystore-backed storage.
7. Pairing secret is invalidated immediately.

### 24.6 Authenticated requests

All normal control and tus requests include:

```http
Authorization: Bearer <device-token>
X-FolderSync-Protocol: 1
X-Request-Id: <uuid>
```

The server:

- Rate-limits failed authentication.
- Uses constant-time token-hash comparison where applicable.
- Redacts tokens and pins from logs.
- Rejects unsupported protocol versions explicitly.

### 24.7 Certificate rotation

Not required in MVP UI, but design for it:

- Rotation must be an authenticated action.
- Phone must approve the new pin while still connected to the old identity, or require re-pairing.
- Unexpected certificate change is a hard failure, not a warning that can be ignored automatically.

---

## 25. Control protocol

### 25.1 General rules

- Base path: `/v1`.
- JSON UTF-8.
- Explicit request and response schemas.
- Every mutation accepts a client request/event ID for idempotency.
- Use structured error codes; human text is supplementary.
- The authenticated phone may access only its own mappings and uploads.
- tus bytes are separate from the control API.

### 25.2 Minimum endpoints

#### `GET /v1/health`

Unauthenticated minimal health response. Must not expose device details beyond protocol availability.

#### `POST /v1/pair`

Available only during an active pairing window.

#### `GET /v1/device`

Returns authenticated desktop identity summary and protocol version.

#### `POST /v1/roots/register`

Registers or updates the mapping between a phone root ID and desktop destination selected in the desktop UI.

For safety, the phone cannot choose an arbitrary absolute destination. It references a mapping approved on the desktop.

Registration is rejected with `destination_overlap` when the mapping's destination path equals, contains or is contained by an existing mapping's destination (section 12.5).

#### `POST /v1/files/prepare`

Example request:

```json
{
  "requestId": "uuid",
  "rootId": "uuid",
  "fileEntryId": "uuid",
  "relativePath": "Camera/IMG_0001.jpg",
  "size": 1234567,
  "modifiedAtMs": 1784981000000,
  "mimeType": "image/jpeg",
  "knownRemoteVersionId": null
}
```

Possible response:

```json
{
  "action": "upload",
  "prepareId": "uuid",
  "tusEndpoint": "/v1/uploads",
  "expiresAt": "2026-07-25T12:00:00Z"
}
```

Or:

```json
{
  "action": "skip",
  "remoteVersionId": "uuid",
  "sha256": "hex",
  "size": 1234567
}
```

Prepare lifetime and renewal follow the staging policy in section 22.3: prepares default to seven days and are renewable while a transfer is in progress, so interrupted large uploads can resume across days.

#### `GET /v1/files/prepare/:prepareId`

Returns upload/verification/commit status.

States:

```text
prepared
uploading
uploaded
verifying
committing
committed
failed
expired
```

#### `POST /v1/files/delete`

Example:

```json
{
  "eventId": "uuid",
  "rootId": "uuid",
  "fileEntryId": "uuid",
  "relativePath": "Camera/IMG_0001.jpg",
  "expectedRemoteVersionId": "uuid",
  "cause": "user_or_external_deletion"
}
```

Server rejects `retention_cleanup` as a remote delete request.

#### `GET /v1/sync/status`

Returns mapping health, pending commits and server disk-space state.

#### `GET /v1/files/list`

Lists a bound root's committed image files for the remote gallery (section 6.6), scoped to the authenticated device's own root. Paginated by an opaque cursor; each item carries the file id, relative path, size, SHA-256, current remote version id, commit time and content type. An absolute desktop path is never returned (section 30).

#### `GET /v1/files/:fileId/thumbnail`

Returns a downscaled thumbnail — image bytes, not JSON — for one committed file the authenticated device owns. An optional `size` query bounds the longest edge.

#### `GET /v1/files/:fileId/content`

Returns the full bytes of one committed file the authenticated device owns, for full-resolution viewing and download. Unknown or foreign file ids return `file_not_found` identically, so existence is not leaked.

### 25.3 Error model

```json
{
  "error": {
    "code": "insufficient_space",
    "message": "Not enough free space in the destination volume.",
    "retryable": false,
    "requestId": "uuid",
    "details": {}
  }
}
```

Required codes include:

- `bad_request`
- `unauthorised`
- `protocol_version_unsupported`
- `pairing_expired`
- `root_not_mapped`
- `invalid_relative_path`
- `path_collision`
- `destination_overlap`
- `insufficient_space`
- `source_changed`
- `remote_version_conflict`
- `upload_not_found`
- `upload_expired`
- `file_not_found`
- `destination_unavailable`
- `internal_error`

---

## 26. Sync state machines

### 26.1 File upload state

```text
DISCOVERED
  ↓
PENDING_PREPARE
  ↓
PREPARED
  ↓
UPLOADING ↔ PAUSED/RETRY_WAIT
  ↓
REMOTE_VERIFYING
  ↓
REMOTE_COMMITTED
  ├─→ COMPLETE_KEEP_PHONE
  └─→ CLEANUP_VERIFYING
          ├─→ CLEANUP_PENDING      (local hash matches desktop hash)
          │        ↓
          │   CLEANUP_COMPLETE
          └─→ PENDING_PREPARE      (hash mismatch: no deletion, re-upload)
```

Failure states retain enough data to retry safely.

### 26.2 Remote deletion state

```text
PRESENT
  ↓ first complete scan missing
MISSING_UNCONFIRMED
  ↓ second complete scan missing
DELETE_EVENT_PENDING
  ↓ server version check
TRASHED_REMOTE
```

Possible branch:

```text
DELETE_EVENT_PENDING
  ↓ expected version mismatch
CONFLICT_REQUIRES_REVIEW
```

### 26.3 Root state

A root cannot enter deletion evaluation unless its scan finishes successfully. This invariant must be enforced in database code, not only UI logic.

---

## 27. Rename and move behaviour

SAF providers do not guarantee a stable filesystem inode abstraction.

MVP behaviour:

- A move/rename may appear as a new file plus a missing old path.
- The new path uploads.
- Under preserve policy, the old desktop path remains.
- Under mirror-delete policy, the old path moves to trash after missing confirmation.

A future optimisation may detect renames using strong content identity, but it must not be required for correctness.

---

## 28. Conflict and race handling

### 28.1 Same relative path, new phone version

The new phone version supersedes the prior FolderSync version after commit.

### 28.2 Desktop externally modified

Before overwrite/delete:

- Compare current destination size/mtime and optionally hash against stored committed metadata.
- If externally modified, move it to conflict storage.
- Record the conflict event.
- Continue only if preservation succeeds.

### 28.3 Phone file removed during upload

- Upload may finish, but the post-upload source check fails.
- Do not run automatic phone cleanup.
- If the desktop commit succeeded, retain it as a valid backed-up historical version.
- Evaluate the later phone deletion according to policy.

### 28.4 Two files collide on case-insensitive desktop

Example: `Photo.jpg` and `photo.jpg` from a case-sensitive provider.

- Detect before commit.
- Do not overwrite.
- Mark one as `path_collision` and show it to the user.
- Later UI may allow a rename mapping.

### 28.5 Desktop destination disappears

If an external drive is removed:

- Reject new prepare requests.
- Pause uploads.
- Do not remap silently to another path.
- Resume only when the same approved destination is available.

---

## 29. Performance strategy

### 29.1 Initial constraints

- One active upload.
- Metadata batching in Room transactions.
- No whole-file buffering.
- Stream from `content://` URI.
- Desktop hashing in worker thread.
- Staging and final destination on the same volume.

### 29.2 Large directories

For 10,000+ files:

- Use iterative traversal rather than deep recursion on the call stack.
- Page/query provider results where supported.
- Commit scan progress in batches.
- Emit throttled UI progress, not one event per file.
- Avoid loading the entire tree into JavaScript.

### 29.3 Retry policy

Example backoff:

```text
5 s, 15 s, 45 s, 2 min, 5 min, 15 min, 30 min
```

Add jitter. Reset after a successful connection.

Do not aggressively retry permanent errors such as invalid path or disk full.

### 29.4 Bandwidth options

MVP:

- Wi-Fi only, fixed.
- No bandwidth throttle.

Later:

- User-configurable bandwidth limit.
- Charging-only option.
- Unmetered-network requirement.

---

## 30. Privacy and security requirements

- No file-content telemetry.
- No cloud relay in the MVP.
- No filenames in analytics.
- Logs redact bearer tokens, pairing secrets, full TLS pins and sensitive absolute paths.
- Desktop API rejects unauthenticated tus creation.
- Pairing endpoint is closed by default.
- Destination paths are approved on desktop.
- Renderer cannot choose arbitrary filesystem paths except through a native desktop picker.
- Validate every request at the server boundary.
- Use dependency lockfiles and automated vulnerability scanning.
- Do not enable Electron `nodeIntegration`.
- Do not load remote web pages in the Electron renderer.
- Do not use `shell.openExternal` on unvalidated values.
- Do not disable TLS verification.
- Do not permanently delete remote files as the first action.

---

## 31. Observability and diagnostics

### 31.1 Structured logs

Both apps should produce structured events with:

- Timestamp.
- Component.
- Severity.
- Request/job ID.
- Root ID and file entry ID where applicable.
- Redacted error code and stack.

Do not log file contents or secrets.

### 31.2 Desktop diagnostics bundle

Allow export of a ZIP containing:

- Redacted logs.
- App and protocol versions.
- OS and architecture.
- Database schema version.
- Network interfaces without public IP history.
- Current port and discovery state.
- Recent error codes.

Do not include the database, tokens, certificate private key or user files by default.

### 31.3 Mobile diagnostics

Provide a copyable diagnostic summary and optional redacted log export through Android's share sheet.

---

## 32. Development environment

### 32.1 Decision: do not install Android Studio on the work Mac initially

Android development itself works well on Apple Silicon. The concern is that the laptop is work-owned and the full Android SDK/Gradle/emulator toolchain is a substantial personal-project footprint.

Use the work Mac for:

- VS Code.
- Node.js 24 LTS.
- pnpm.
- Expo TypeScript/React development.
- Electron companion development.
- Git.
- EAS cloud development builds.
- A physical Samsung Android phone.

Do not install Android Studio initially.

### 32.2 EAS development-build workflow

Install EAS CLI through the project or `pnpm dlx` rather than relying on an untracked global version.

Illustrative commands:

```bash
corepack enable
pnpm install
pnpm dlx eas-cli login
pnpm dlx eas-cli build --platform android --profile development
```

Install the generated APK on the physical phone.

Normal TypeScript loop:

```bash
pnpm --filter mobile start --dev-client
```

React/TypeScript changes use Fast Refresh. A new native build is required when changing:

- Kotlin code.
- Android manifest or permissions.
- Native dependency versions.
- Expo config plugins that alter native projects.
- Native module registration.

### 32.3 Personal Ubuntu native environment

When native foreground-service work becomes frequent, install the Android toolchain on the personal Ubuntu machine.

Install:

- Android Studio.
- Android SDK platform and build tools required by current Expo SDK.
- Platform tools and `adb`.
- JDK version required by Expo/Android Gradle Plugin.

Use the same Git repository and lockfile.

Typical local commands:

```bash
adb devices
pnpm install
pnpm --filter mobile exec expo run:android
```

Use Android Studio primarily for:

- SDK management.
- Kotlin compilation/navigation.
- Logcat.
- Foreground-service debugging.
- Gradle troubleshooting.

VS Code can remain the main editor.

### 32.4 Physical device first

Use the Samsung phone as the primary Android test target because the app depends on:

- Real Wi-Fi/mDNS.
- Samsung battery management.
- Scoped document providers.
- Foreground-service notifications.
- Large camera folders.

An emulator is useful for permission-state and API-level automation, but not sufficient for final LAN/background validation.

### 32.5 Work ownership caution

Keep personal source code in the user's personal repository and account. Do not use employer secrets, credentials, code or internal packages. Review the employer's acceptable-use and intellectual-property policies before doing extensive personal-project work on the work laptop.

---

## 33. Bootstrap configuration

### 33.1 Root package settings

```json
{
  "private": true,
  "packageManager": "pnpm@<pinned-version>",
  "engines": {
    "node": "24.x"
  }
}
```

Use `pnpm-workspace.yaml`:

```yaml
packages:
  - apps/*
  - packages/*
  - modules/*
```

### 33.2 TypeScript

Base settings:

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "useUnknownInCatchVariables": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": false
  }
}
```

Platform packages may override module resolution according to Expo and electron-vite requirements.

### 33.3 Environment variables

Do not use environment variables for user secrets.

Build-time variables may include:

- Protocol development flags.
- Log level.
- Feature flags.

Runtime ports, identity, tokens and paths belong in application-managed storage.

### 33.4 Suggested scripts

```json
{
  "scripts": {
    "dev:mobile": "pnpm --filter mobile start --dev-client",
    "dev:desktop": "pnpm --filter desktop dev",
    "typecheck": "pnpm -r typecheck",
    "lint": "pnpm -r lint",
    "test": "pnpm -r test",
    "build": "pnpm -r build"
  }
}
```

### 33.5 EAS development profile

Illustrative `apps/mobile/eas.json`:

```json
{
  "cli": {
    "version": ">= 16.0.0"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "android": {
        "buildType": "apk"
      }
    },
    "preview": {
      "distribution": "internal",
      "android": {
        "buildType": "apk"
      }
    },
    "production": {}
  }
}
```

The agent must update the EAS CLI constraint to a real tested version instead of copying this illustrative minimum blindly.

### 33.6 Native manifest/config ownership

The local Expo module should carry static Android service and permission declarations through its library manifest. Use an Expo config plugin only for app-level values that genuinely need generated configuration. Do not manually edit generated native files as the primary source of truth because `expo prebuild --clean` can recreate them.

---

## 34. Testing strategy

### 34.1 Unit tests

#### Kotlin

- Relative-path construction.
- Scan-generation logic.
- Missing confirmation.
- Retention-cleanup suppression.
- Transfer backoff.
- TLS pin comparison.
- Room migrations.

#### TypeScript/Desktop

- Request schema validation.
- Path normalisation and traversal rejection.
- Version conflict logic.
- Trash/conflict path generation.
- Token hashing/authentication.
- Protocol error mapping.

### 34.2 Contract tests

Maintain golden JSON fixtures under `packages/test-fixtures`.

For each request/response:

- Zod/Fastify accepts valid fixture.
- Zod/Fastify rejects invalid fixture.
- Kotlin serialises/deserialises the same valid fixture.
- Required error fields are stable.

### 34.3 Integration tests

Desktop tests with temporary directories:

- Prepare → tus upload → hash → atomic commit.
- Interrupted upload resume.
- Duplicate request idempotency.
- Disk-full simulation.
- Existing file externally modified.
- Deletion moves to trash.
- Expected-version mismatch blocks deletion.
- Path traversal attempts.
- Overlapping destination mapping rejected.
- Identical-content destination file adopted in place without a conflict copy.
- Staging garbage collection removes orphans and preserves resumable uploads.

Android instrumentation tests:

- Persisted tree grant survives process restart.
- Recursive scan.
- Permission revoked.
- Source deleted after verified commit.
- Cleanup crash recovery.
- Foreground notification actions.
- Service process restart.

### 34.4 End-to-end test matrix

At minimum:

- Android 13, 14, 15 and 16 where available.
- Samsung current device firmware.
- Wi-Fi disconnect/reconnect mid-upload.
- Router/client isolation enabled.
- VPN active.
- Desktop sleep/wake.
- Phone app swiped away.
- Phone force-stop.
- Phone reboot.
- Desktop companion restart.
- Large file: at least 5 GB.
- Large tree: at least 10,000 files.
- Zero-byte file.
- Unicode filenames.
- Same-name case collision.
- External SD-card root if hardware is available.

### 34.5 Destructive safety tests

These are release blockers:

- Failed scan never emits mass deletions.
- Revoked permission never emits deletions.
- App cleanup never deletes desktop copy.
- Desktop modified file is preserved before replacement.
- Remote deletion with stale version ID does not remove a newer file.
- Phone file is not deleted before durable desktop commit.
- Phone-side hash mismatch blocks retention cleanup and re-enqueues the upload.

---

## 35. Technical spikes before broad UI work

Complete these in order and record results in `docs/architecture-decisions`.

### Spike 1: SAF persistence and traversal

- Pick `DCIM/Camera` on the Samsung phone.
- Persist permission.
- Restart process and phone.
- Enumerate a realistic tree.
- Read size/mtime/name.
- Delete a disposable test file.
- Test 10,000-file traversal performance.

**Pass condition:** reliable restart persistence, complete traversal and controlled deletion.

### Spike 2: Native foreground service

- Start while app is visible.
- Continue after UI backgrounding.
- Show notification progress.
- Pause/stop from notification.
- Validate behaviour after swipe-away and process pressure.
- Record Android version and Samsung battery settings.

**Pass condition:** service and Room queue remain coherent without the JS runtime.

### Spike 3: mDNS discovery

- Desktop advertises `_foldersync._tcp`.
- Android native service discovers it.
- Repeat after Wi-Fi change, sleep/wake and VPN.
- Test manual fallback.

**Pass condition:** dependable discovery on normal home LAN and clear failure diagnosis.

### Spike 4: pinned TLS pairing

- Generate desktop identity.
- Display QR.
- Pair phone.
- Reject a different certificate on the same IP/port.
- Survive desktop IP change.

**Pass condition:** no trust-all path and stable identity across network changes.

### Spike 5: tus direct URI upload

- Upload directly from a SAF `content://` URI.
- Interrupt Wi-Fi midway.
- Restart service/process.
- Resume from stored upload URL.
- Test a multi-gigabyte file.

**Pass condition:** no whole-file cache copy and no restart from zero.

### Spike 6: desktop atomic commit

- Stage on destination volume.
- Verify size and SHA-256.
- Atomically move.
- Preserve externally modified destination.
- Simulate desktop crash before and after rename.
- Prove the Fastify and `@tus/server` integration: tus needs the raw Node request, so body parsing must be bypassed on upload routes or tus mounted on a separate listener.

**Pass condition:** destination never exposes partial committed files and recovery is deterministic.

### Spike 7: foreground-service classification and Play policy

- Verify `connectedDevice` runtime prerequisites on target SDK.
- Confirm the app's actual behaviour matches current Google Play declaration guidance.
- Test relevant Android 15/16 limits.
- Record the fallback plan, including the sessioned-sync UX decision from section 14.2.

**Pass condition:** selected type is technically and policy-valid, not merely convenient.

---

## 36. Implementation phases

### Phase 0: repository and contracts

Deliver:

- pnpm workspace.
- Mobile and desktop skeletons.
- Local Expo module skeleton.
- Strict TypeScript/tooling.
- Protocol constants and golden fixtures.
- CI for lint, typecheck and unit tests.

No polished UI.

### Phase 1: vertical slice

Deliver exactly this path:

1. Desktop launches and advertises.
2. Phone pairs.
3. User selects one directory.
4. User chooses one desktop destination.
5. Manual **Sync now** scans.
6. One file uploads through tus.
7. Wi-Fi interruption resumes.
8. Desktop verifies and atomically commits.
9. Status appears in both UIs.

Do not implement deletion until this passes.

### Phase 2: retention cleanup

- `keep_on_phone`.
- `delete_after_verified_backup`.
- Crash-safe cleanup markers.
- Cleanup errors and retry.

### Phase 3: user deletion semantics

- Missing confirmation.
- Preserve policy.
- Mirror policy through desktop trash.
- Expected-version checks.
- Conflict preservation.

### Phase 4: continuous service

- User-enabled foreground service.
- Notification actions.
- Network callbacks.
- Discovery loop.
- Scheduled rescans while active.
- WorkManager recovery/maintenance.

### Phase 5: multiple roots and hardening

- Independent policies per root.
- Overlap detection.
- Large-tree performance.
- Disk-space handling.
- Platform filename conflicts.
- Diagnostics.

### Phase 6: desktop packaging

- macOS development package.
- Ubuntu package.
- Windows package when required.
- Auto-start option.
- Firewall guidance.
- Signed distribution strategy.

---

## 37. Definition of MVP complete

MVP is complete only when all are true:

- User can pair one Android phone with one desktop.
- User can select multiple allowed Android directories individually.
- Access persists across ordinary app restart.
- Phone discovers the paired desktop on LAN or uses manual fallback.
- Transfers use authenticated pinned HTTPS.
- Large upload resumes after Wi-Fi loss and app/service restart.
- Desktop never exposes a partially written final file.
- Desktop computes and records SHA-256.
- Phone deletion after backup occurs only after verified desktop commit and a matching phone-side content hash.
- Automatic cleanup does not propagate as desktop deletion.
- Genuine phone deletion follows the configured preserve/trash policy.
- Failed or inaccessible scans do not generate deletions.
- Foreground service works with a visible notification on supported Android versions.
- Core destructive safety tests pass.
- Logs contain no secrets or file contents.

---

## 38. Agent implementation rules

The implementation agent must:

- Build the technical spikes before broad UI polish.
- Keep the React Native runtime out of the critical background path.
- Use Room as mobile sync truth.
- Use the system directory picker rather than broad storage permission.
- Use `NsdManager` in native Android code.
- Use official tus client/server packages.
- Use `@tus/server`, not legacy `tus-node-server`.
- Use exact dependency versions in lockfiles.
- Validate all incoming protocol data.
- Make all mutations idempotent.
- Use database migrations from the beginning.
- Add tests for every deletion invariant.
- Record any change to a major decision as an ADR.

The agent must not:

- Add `MANAGE_EXTERNAL_STORAGE`.
- Depend on Expo Go.
- Run long uploads solely in JavaScript.
- Use a trust-all TLS client.
- Send tokens in mDNS TXT records.
- Let the phone send arbitrary absolute desktop paths.
- Delete desktop files permanently on first detection.
- Treat an incomplete scan as authoritative.
- Delete the phone file after a mere HTTP upload completion without desktop commit acknowledgement.
- Enable Electron Node integration in the renderer.
- Build a custom resumable upload protocol.
- Reimplement Syncthing's block protocol.

---

## 39. Deferred decisions

These are intentionally deferred until measurements or product use justify them:

- Upload connection reuse / HTTP-2 (replace the tus `HttpURLConnection` transport, which forces
  `Connection: close`, with an OkHttp-backed uploader so back-to-back files reuse one pinned
  connection). The bounded upload pool of section 18.3 is already in place.
- Mobile-side content hashing.
- Cross-root deduplication.
- Rename detection by hash.
- Bandwidth throttling.
- Charging-only mode.
- Multiple desktops per root.
- Internet relay.
- iOS document-provider/security-scoped bookmark implementation.
- Desktop background system service separate from Electron.
- Automatic update infrastructure.
- Optional desktop file version history beyond trash/conflict preservation.

---

## 40. Research references

Primary and official references used for the decisions in this document:

### Android

- Storage Access Framework and directory grants:  
  https://developer.android.com/training/data-storage/shared/documents-files
- Network Service Discovery:  
  https://developer.android.com/develop/connectivity/wifi/use-nsd
- Foreground service overview:  
  https://developer.android.com/develop/background-work/services/fgs
- Foreground service types and prerequisites:  
  https://developer.android.com/develop/background-work/services/fgs/service-types
- Foreground service background-start restrictions:  
  https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start
- Foreground service timeouts:  
  https://developer.android.com/develop/background-work/services/fgs/timeout
- WorkManager/persistent work:  
  https://developer.android.com/develop/background-work/background-tasks/persistent
- Notification runtime permission:  
  https://developer.android.com/develop/ui/compose/notifications/notification-permission
- Local-network permission roadmap:  
  https://developer.android.com/privacy-and-security/local-network-permission

### Expo

- Development builds:  
  https://docs.expo.dev/develop/development-builds/introduction/
- Creating EAS development builds:  
  https://docs.expo.dev/develop/development-builds/create-a-build/
- Expo Modules API:  
  https://docs.expo.dev/modules/module-api/
- Monorepos:  
  https://docs.expo.dev/guides/monorepos/
- Custom native code:  
  https://docs.expo.dev/workflow/customizing/

### tus

- Protocol:  
  https://tus.io/protocols/resumable-upload
- Android client:  
  https://github.com/tus/tus-android-client
- Java client:  
  https://github.com/tus/tus-java-client
- Node server and `@tus/server`:  
  https://github.com/tus/tus-node-server/tree/main/packages/server

### Electron and desktop tooling

- Electron releases:  
  https://releases.electronjs.org/
- Electron process/security model:  
  https://www.electronjs.org/docs/latest/tutorial/process-model
- Electron context isolation:  
  https://www.electronjs.org/docs/latest/tutorial/context-isolation
- Electron safeStorage:  
  https://www.electronjs.org/docs/latest/api/safe-storage
- electron-vite:  
  https://electron-vite.org/
- Fastify validation:  
  https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/
- DNS-SD desktop candidate:  
  https://github.com/homebridge/ciao

### Runtime

- Node.js release status:  
  https://nodejs.org/en/about/previous-releases

---

## 41. Final implementation principle

The project should feel simple to the user because complexity is handled deliberately underneath:

- Android grants access only to folders the user chose.
- The foreground service is visible and controllable.
- The phone finds the desktop without manual IP management.
- Transfers resume rather than restart.
- A backup is not considered complete until it is durably committed.
- Automatic phone cleanup can never erase the only verified copy.
- User deletions remain recoverable on the desktop.

The correct implementation is not “all TypeScript at any cost” and not “clone a complete sync engine”. It is a small React/TypeScript product wrapped around a robust native Android execution core and established LAN standards.
