# Spike 3 — mDNS discovery

**Date:** 2026-07-25
**Status:** DESKTOP HALF PASSED — Android half pending the dev client
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

## Decisions

- `@homebridge/ciao` stays the primary library (spec 23.2); `bonjour-service` is
  installed as a devDependency and doubles as the documented fallback should ciao
  fail on a required platform.
- `startAdvertising` (src/main/discovery/advertise.ts) is the only place TXT
  records are constructed.
