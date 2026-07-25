# Spike 4 — Pinned TLS pairing

**Date:** 2026-07-25 (Android half added 2026-07-26)
**Status:** DESKTOP HALF PASSED — Android half IMPLEMENTED, on-device verification pending
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

## Android half (implemented — `PinnedTls.kt`, `TokenVault.kt`, `PairingManager.kt`)

The phone parses the `foldersync://pair?…` QR (mirrors `packages/contracts` pairing
grammar, validated to the same field rules), pairs over a key-pinned HTTPS client, and
persists the paired desktop.

Decisions:

- **Custom single-key `X509TrustManager`, NOT OkHttp `CertificatePinner`.** For a
  self-signed cert, `CertificatePinner` never runs — it executes only _after_ the default
  CA `TrustManager` validates the chain, which a self-signed cert fails first. So we replace
  the trust anchor: `checkServerTrusted` computes `SHA-256(chain[0].publicKey.encoded)` (the
  SPKI DER — byte-identical to the desktop's `base64url(sha256(spki))` from `identity.ts`),
  constant-time-compares (`MessageDigest.isEqual`) to the QR pin decoded with
  `Base64.URL_SAFE|NO_PADDING|NO_WRAP`, and throws otherwise. Exactly one key is accepted;
  every other cert throws — **not** trust-all.
- **Hostname verification bypassed** (`hostnameVerifier { _, _ -> true }`) — the self-signed
  cert is `CN=FolderSync <uuid>` with no IP SAN, so a name check would always fail. This is
  safe _only_ because the SPKI pin is the identity (a known-hosts/TOFU model); the two must
  stay coupled.
- **OkHttp 4.9.2 via `implementation`** in the module `build.gradle`, pinned byte-identical
  to react-native's bundled version (single artifact, no skew) — the expo-asset precedent.
  Not on the local module's compile classpath otherwise.
- **`org.json` (android.jar built-in) for the pair JSON**, not kotlinx-serialization — avoids
  its Gradle compiler plugin (the same class of EAS-build risk as Room's KSP).
- **Bearer token at rest: AndroidKeyStore AES-256/GCM** (`TokenVault`, javax.crypto only) —
  ciphertext (`iv:ct`) in SharedPreferences; the phone holds the raw token (it must send it
  as a bearer) but never in plaintext on disk. Non-secret paired-device metadata (host, port,
  pin, display name) is plain JSON. `POST /v1/pair` is a public route (no protocol header /
  bearer); the raw secret and token never surface to JS.

The pair contract was independently verified against the desktop and the golden fixtures
(pin = `base64url(SHA-256(SPKI-DER))`; QR grammar; request/response bodies), and the Kotlin
passed an adversarial compile+security review before the first build.

On-device checklist (pass: no trust-all path, stable identity across network changes):

- [ ] Paste the desktop's `foldersync://pair?…` (scan its QR with any reader to copy) → pairs;
      the paired desktop appears.
- [ ] Point the phone at a _different_ self-signed cert on the same host:port → `pin_mismatch`
      (never silently trusted).
- [ ] Change the desktop IP (or move networks) and re-pair with a fresh QR → still works
      (identity = key, not address).

In-app camera QR scanning **was added** (`expo-camera`, `CameraView` in the harness) after
device testing: the app's `foldersync` deep-link scheme collides with the pairing QR's
`foldersync://` scheme, so an EXTERNAL scanner routes the link into the dev-client launcher
and errors — reading the QR in-app bypasses Android's deep-link router entirely. Paste stays
as a fallback.

Deferred: multi-device token storage (MVP is one desktop), and using the pinned client for the
authenticated `x-foldersync-protocol: 1` + `Bearer` calls (the scan/upload engines).

## Decisions (desktop)

- ECDSA P-256 over RSA: smaller, faster handshakes, universally supported by
  Android's TLS stack.
- `reflect-metadata` must be imported before `@peculiar/x509` (its DI container
  requires the polyfill) — done once in `identity.ts`.
- Private key protection beyond file permissions (Electron `safeStorage`) is an
  integration concern for the main-process wiring; the store's layout already
  isolates the key in its own file.
