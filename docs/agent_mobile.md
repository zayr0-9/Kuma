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
- `src/native/index.ts` is the required import path for native calls; it handles
  the module-not-linked state (`requireOptionalNativeModule` returns null on a
  stale dev client).
- EAS project: `@sigma2/foldersync` (personal account `sigma2` /
  karn97uk@gmail.com), projectId in `app.config.ts` `extra.eas` — `eas init`
  cannot write to a TS config, so keep it updated by hand. Android keystore is
  EAS-managed (generated in the cloud on the first build). Build via
  `pnpm dlx eas-cli build --platform android --profile development`.
- expo-* dependencies use Expo's `~` ranges on purpose (managed by
  `expo install --fix`); everything else stays exact-pinned.

## Update this file when

Structure, navigation approach, state libraries, the native wrapper surface, or the dev
loop changes.
