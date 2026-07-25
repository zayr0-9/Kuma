# Spike 4 — Pinned TLS pairing

**Date:** 2026-07-25
**Status:** DESKTOP HALF PASSED — Android half pending the dev client
**Spec reference:** section 35 (spike 4), section 24

## What was proven (desktop)

`apps/desktop/test/identity.test.ts`:

- Identity generation (spec 24.2): ECDSA P-256 key, ~10-year self-signed
  certificate via `@peculiar/x509`, stable random device id, and a base64url
  SHA-256 SPKI pin that round-trips through the wire schema
  (`base64Url32Schema`) — the same pin format the pairing QR carries.
- The pin is derivable from the certificate alone, and a TLS client performing a
  real handshake against the identity's HTTPS server can verify the presented
  certificate against the pin — and refute an impersonator's pin on the same
  address. This is exactly the phone's verification rule (spec 24.4).
- The identity store generates once and never regenerates on subsequent loads
  (spec 24.2); the private key file is 0600.

## Still open (needs the phone)

- Android pinned trust manager (accept-only-pinned, never trust-all) in the
  Kotlin HTTP/tus clients.
- QR pairing end to end (`/v1/pair`, one-time secret, token issuance).
- Rejecting a different certificate on the same IP/port from the phone side, and
  surviving a desktop IP change (identity = key, not address).

## Decisions

- ECDSA P-256 over RSA: smaller, faster handshakes, universally supported by
  Android's TLS stack.
- `reflect-metadata` must be imported before `@peculiar/x509` (its DI container
  requires the polyfill) — done once in `identity.ts`.
- Private key protection beyond file permissions (Electron `safeStorage`) is an
  integration concern for the main-process wiring; the store's layout already
  isolates the key in its own file.
