# agent_mobile.md — Mobile app scope

**Scope:** `apps/mobile/` — the Expo/React Native UI. Kotlin lives in
`modules/foldersync-native` and is covered by [`agent_native.md`](agent_native.md).

**Spec sections to load before working here:** 5 (UX), 11.2 (stack), 13 (native module
boundary), 32.2 (EAS workflow). UI changes also require
[`agent_design.md`](agent_design.md).

## Hard rules

- The JS runtime is a **UI shell**. No scanning, uploading, discovery, retention, or
  deletion logic in TypeScript — the native module owns all of it. If a feature seems
  to need JS-side sync logic, the native module API is wrong; fix it there.
- Expo **development builds only** (`expo-dev-client`); the app can never run in Expo Go.
- Zustand holds transient UI state only. Durable state is always re-queried from the
  native module; native events (`serviceStatusChanged`, `transferProgress`, ...) are
  freshness hints, not a durable log — always re-query after reconnect/foreground.
- All native calls go through the typed wrapper in `src/native/` — no direct module
  imports from screens/components.
- A new EAS build is required when changing: Kotlin, the Android manifest/permissions,
  native dependency versions, config plugins, or module registration. TS/React-only
  changes use Fast Refresh via `pnpm dev:mobile`.

## Dev loop

- Daily: `pnpm dev:mobile` (Metro + dev client on the physical Samsung phone, same Wi-Fi).
- Native change: `pnpm dlx eas-cli build --platform android --profile development`,
  install the APK on the phone.
- `adb logcat` is available locally (platform-tools installed) for service debugging.

## Current state

- Skeleton in place: Expo SDK 57.0.8 (the spec baseline), React Native 0.86,
  Expo Router (`app/_layout.tsx` + `app/index.tsx`), `expo-dev-client`,
  `app.config.ts` (android package placeholder `dev.zayr.foldersync`), monorepo
  `metro.config.js`, `eas.json` with the development profile. Verified headlessly
  via `expo export --platform android` (Hermes bundle builds).
- `src/native/` is the required import path for native calls. The
  module-not-linked guard lives once in `src/native/module.ts`
  (`requireNative` / `isNativeLinked` / `NativeModuleUnavailableError`, over
  `requireOptionalNativeModule` which is null on a stale dev client) and is reused
  by every wrapper. `src/native/index.ts` holds `pingNativeModule`;
  `src/native/saf.ts` wraps the spike-1 SAF surface; `src/native/service.ts` wraps
  the spike-2 foreground-service surface (`startSyncService` [also resumes],
  `pauseSyncService`, `stopSyncService`, `getServiceStatus`); `src/native/discovery.ts`
  wraps spike-3 DNS-SD discovery (`startDiscovery`/`stopDiscovery`/`getDiscoveredDesktops`,
  pull model); `src/native/pairing.ts` wraps spike-4 pinned-TLS pairing
  (`startPairingFromQr` → discriminated `PairingResult`, `listPairedDevices`,
  `removePairedDevice`); `src/native/engine.ts` wraps the roots-binding + scan/upload engine
  (`listAvailableDestinations`, `addRoot`, `listRoots`, `setRootEnabled`, `removeRoot`,
  `syncNow`, `getTransfers`, `getSyncEvents` — pull-model). The bearer token/pin never cross
  to JS. (`src/native/upload.ts` and the single-shot upload calls it wrapped are gone — folded
  into the engine.)
- **Product screens (first pass):** `app/folders.tsx` (spec 5.2/5.5 — persisted roots with
  per-root status; add-folder = pick a directory → choose a desktop destination + the two
  policies → bind + persist → kick a sync; pause/resume via a Switch; remove with a confirm) and
  `app/transfers.tsx` (spec 5.5 — the active upload with a live progress bar, the queued/failed
  jobs, and recent history). Both poll the native engine (pull model). The home screen links
  them above a "Diagnostics" section.
- **Spike diagnostic harnesses** (developer diagnostics screens with intentional raw/absolute
  values per agent_design §4 — NOT product surfaces, so the §5 parity checklist does not apply):
  `app/spike-saf.tsx` (SAF), `app/spike-service.tsx` (foreground service), `app/spike-pairing.tsx`
  (discovery list + pairing + paired-device list/remove). All use the shared
  `src/components/SpikeButton.tsx` (48dp touch target). (`app/spike-upload.tsx` was retired — its
  flow is now the Folders/Transfers screens.)
- **`expo-camera` (`~57.0.3`) is used for in-app pairing-QR scanning** (`CameraView` +
  `useCameraPermissions`; config plugin + camera-permission rationale in `app.config.ts`).
  This is required, not cosmetic: the app's deep-link `scheme` is `foldersync` (app.config.ts),
  the SAME scheme as the pairing QR (`foldersync://pair?…`), so scanning with an EXTERNAL
  reader routes the link into the expo-dev-client launcher (which only loads `http/https`
  bundles) and errors. `CameraView` reads the QR bytes directly, so the scheme never reaches
  Android's deep-link router. Pasting the code stays as a fallback. **Adding expo-camera needs
  a new EAS build** (native dependency).
- EAS project: `@sigma2/foldersync` (personal account `sigma2` /
  karn97uk@gmail.com), projectId in `app.config.ts` `extra.eas` — `eas init`
  cannot write to a TS config, so keep it updated by hand. Android keystore is
  EAS-managed (generated in the cloud on the first build). Build via
  `pnpm dlx eas-cli build --platform android --profile development`.
- expo-* dependencies use Expo's `~` ranges on purpose (managed by
  `expo install --fix`); everything else stays exact-pinned. `typescript` is in
  `expo.install.exclude` (SDK 57 wants TS ~6; the workspace pins 5.9.3 for
  typescript-eslint — revisit deliberately).
- **pnpm layout is `nodeLinker: hoisted` and `autoInstallPeers: false`**
  (pnpm-workspace.yaml — pnpm 11 ignores .npmrc). The isolated linker shipped
  duplicate expo/expo-modules-core instances that failed the first EAS build.
  Do not add `expo-modules-core` as a direct app dependency (expo provides it;
  expo-doctor rejects it directly installed). `npx expo-doctor` in `apps/mobile`
  is the check to run after dependency-layout changes.
- EAS builds run on Node 24.18.0 (`"node"` in every eas.json profile) — the EAS
  default image ships Node 22, which violates our engines field.

- Dev-loop gotcha: the macOS firewall must allow incoming connections for
  node, or the phone cannot reach Metro (symptom: connection reset on the QR
  scan). Fallback: USB + adb reverse tcp:8081 tcp:8081, connect to
  http://localhost:8081.

## Update this file when

Structure, navigation approach, state libraries, the native wrapper surface, or the dev
loop changes.
