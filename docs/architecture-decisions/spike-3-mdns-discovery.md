# Spike 3 — mDNS discovery

**Date:** 2026-07-25 (Android half added 2026-07-26)
**Status:** DESKTOP HALF PASSED — Android half IMPLEMENTED, on-device verification pending
**Spec reference:** section 35 (spike 3), section 23

## What was proven (desktop)

`@homebridge/ciao` advertises `<displayName>._foldersync._tcp.local` on macOS and
an independent implementation (`bonjour-service`, test-only dependency) discovers
it with the correct port and TXT records (`apps/desktop/test/discovery.test.ts`).
The test also pins the TXT record surface: exactly `v`, `id`, `name`, `tls` —
never anything else (spec 23.1).

## Still open (needs the phone)

- Android `NsdManager` browse/resolve of this advertisement in the foreground
  service (the actual spike pass condition).
- Wi-Fi change, sleep/wake, VPN on/off behaviour on both ends.
- Ubuntu and (later) Windows advertisement.

## Android half (implemented — `NsdDiscovery.kt`)

`modules/foldersync-native/.../NsdDiscovery.kt` browses `_foldersync._tcp` via the
platform `NsdManager` (never JS — agent_native rule), resolving each service to
host/port and decoding the four TXT keys (`v`/`id`/`name`/`tls`, all ASCII strings —
version and tls are the character `"1"`). Exposed as a **pull model** (consistent with
the foreground-service spike): `startDiscovery` / `stopDiscovery` / `getDiscoveredDesktops`,
the harness polling the last of these.

Decisions:

- **Classic `discoverServices` + `resolveService`** with `@Suppress("DEPRECATION")`, not
  `registerServiceInfoCallback`. `resolveService` is deprecated on API 34+ but still works
  across 24..36; the callback API is 34-only, fires repeatedly, and needs more lifecycle
  code — no gain for a spike. Its one real hazard, the concurrent-resolve failure
  (`FAILURE_ALREADY_ACTIVE`), is removed by **serialising resolves through a single-flight
  queue** (at most one resolve in flight).
- **Multicast lock held only while discovering** (spec 14.6), `setReferenceCounted(false)`,
  released in every terminal `DiscoveryListener` callback. `CHANGE_WIFI_MULTICAST_STATE` +
  `INTERNET` (already declared for the service spike) are sufficient; no manifest change.
- Loose service-type matching (`contains("foldersync")`) because Android returns the type
  with inconsistent dots/prefix/casing on callbacks.

On-device checklist (pass: dependable discovery + clear failure diagnosis):

- [ ] Start discovery on the phone → the running desktop appears with correct host/port and
      `v=1`, `tls=true`, and the desktop's display name.
- [ ] Repeat after a Wi-Fi change, sleep/wake, and VPN on/off.
- [ ] Emulators drop multicast — verify on the **real Samsung** on the same subnet, screen on.

Still open: `NsdManager` behaviour across Wi-Fi change / sleep-wake / VPN on the device;
running discovery inside the foreground service (spike 2) rather than the module; a
per-resolve timeout for production.

## Decisions (desktop)

- `@homebridge/ciao` stays the primary library (spec 23.2); `bonjour-service` is
  installed as a devDependency and doubles as the documented fallback should ciao
  fail on a required platform.
- `startAdvertising` (src/main/discovery/advertise.ts) is the only place TXT
  records are constructed.
