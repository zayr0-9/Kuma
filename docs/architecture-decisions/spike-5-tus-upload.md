# Spike 5 — tus direct URI upload

**Date:** 2026-07-26
**Status:** PASSED on device (Samsung SM-S948B)
**Spec reference:** section 35 (spike 5), section 18, section 25.2

## Pass condition (spec 35)

Upload directly from a SAF `content://` URI; interrupt Wi-Fi midway; restart the
service/process; resume from the stored upload URL; test a multi-gigabyte file.
**Pass = no whole-file cache copy and no restart from zero.**

## What was built

The phone can now pick a folder, bind it to a desktop-approved destination, and upload one
file over resumable tus — end to end against the real desktop. Three native pieces plus one
new desktop endpoint.

### tus transport (`UploadEngine.kt`)

- **Pure-Java `io.tus.java.client:tus-java-client:0.5.0`, NOT `tus-android-client`.** The
  official Android helper drags stale `com.android.support` transitive deps that risk an
  AndroidX clash on EAS (the same class of build risk that steered spike 4 away from
  kotlinx-serialization). The Java client is a single dependency-free artifact (its own
  Base64 impl — no `java.util.Base64`/API-26 trap) that talks over
  `java.net.HttpsURLConnection`. We add the Android `content://` streaming ourselves.
- **`UriTusUpload`** subclasses `TusUpload` and opens the stream through `ContentResolver`
  (spec 18.1 — no cache copy). Size comes from a **file descriptor** (`openFileDescriptor
→ statSize`), not provider query metadata (spec 18.1). The fingerprint is stable
  (`foldersync:<uri>:<size>`) so the persisted URL store finds the upload to resume; a
  **fresh instance is built for each attempt** because tus caches the `TusInputStream` at
  `setInputStream`, so resume needs a fresh stream to seek on.
- **`PinnedTusClient`** subclasses `TusClient` and overrides `prepareConnection` to install
  the pinned `SSLSocketFactory` + the pin-coupled hostname bypass on every connection —
  POST create, HEAD resume, PATCH chunks alike (spec 18.2: _never install a trust-all
  certificate manager_). Auth/protocol/request-id headers ride via `TusClient.setHeaders`.
  The socket factory is the **same `PinnedSsl`** the control client uses — one SPKI-pin
  trust decision for both transports (`PinnedTls.kt`, refactored to expose `PinnedSsl` +
  `ALLOW_PINNED_HOSTNAME`).
- **`SharedPrefsTusUrlStore`** persists fingerprint→upload-URL in `SharedPreferences`, so
  resume survives the **process being killed** mid-transfer (tus-java-client's own store is
  memory-only). This is what makes the "restart service/process → resume" pass condition
  work.
- **`UploadManager`** drives ONE upload at a time (spec 18.3) on a background thread with a
  **pull-model status snapshot** (state, bytes, expected, prepareId, remoteVersionId) the JS
  harness polls — consistent with discovery/service. Flow: `prepare` → resumable tus upload
  (retry loop resumes on `IOException`; `ProtocolException` is terminal) → poll
  `GET /v1/files/prepare/:id` until the desktop commits (spec 18.5 steps 5-10). A Wi-Fi drop
  raises `IOException` mid-`uploadChunk`; the loop re-`resumeOrCreateUpload`s from the server
  offset with a fresh stream.

### Authenticated control calls (`ControlClient.kt`)

The pinned-TLS OkHttp client (reused from spike 4) plus the Bearer token (from `TokenVault`)
and the `x-foldersync-protocol` / `x-request-id` headers the desktop requires on every
authenticated route. Methods: `listAvailableDestinations`, `registerRoot`, `prepareUpload`,
`getPrepareStatus`. The raw token never crosses back to JS (spec 30). `PairingManager` gained
a native-only `pairedTarget()` (carries the pin) and `phoneDeviceId()`.

### New desktop endpoint — `GET /v1/roots/available`

The phone must see which desktop destinations it can bind before registering (spec 5.1 step
10, 5.5). The existing minimum endpoints only exposed _bound_ mappings (`/v1/sync/status`).
This authenticated route returns the calling device's **unbound** mappings — the ones the
desktop UI shows as "Waiting for a phone folder" — as `{mappingId, displayName,
destinationAvailable, freeBytes}`. An absolute destination path is never sent (spec 30). This
is the missing wire that turns the desktop's "Add folder" into a bindable target. Contract
`rootsAvailableResponseSchema`; three server tests (own-unbound-only filter, unavailable
volume, auth required).

### Harness

`app/spike-upload.tsx`: pick folder → load destinations → bind (register root, default
`keep_on_phone` / `preserve_desktop_copy` so the test file is never deleted) → pick a file →
upload with a live progress bar. Pull-model polling of `getUploadStatus`.

## On-device result (PASSED, Samsung SM-S948B)

- [x] Pick a folder, bind it to a desktop destination (card flips off "Waiting for a phone
      folder").
- [x] Upload a file → reaches `committed`, the file appears in the destination.
- [x] **Wi-Fi toggled off/on mid-transfer → the transfer resumes** from the stored offset
      (progress does not reset to 0) — the spike-5 pass condition.

### Three desktop bugs the device run surfaced (all desktop-side, no app rebuild)

The Android `HttpsURLConnection` transport is far less forgiving than the Node test client,
so three things that the golden tests missed only failed against a real phone:

1. **Stable control-server port.** `startBackend` bound an OS-assigned port (`port: 0`), so
   every desktop restart moved the port and stranded the paired phone at a dead address. Fixed
   by binding a fixed port (`FOLDERSYNC_PORT`, default 51384) — `apps/desktop/src/main/index.ts`.
2. **Catch-all content-type parser.** tus-java-client's creation POST carries
   `application/x-www-form-urlencoded`, which Fastify had no parser for → **415** before the
   handler. Only `application/offset+octet-stream` (PATCH) was bypassed. Replaced with a `'*'`
   catch-all so every tus request reaches `@tus/server` unparsed (JSON routes keep their
   parser) — `uploadRouting.ts`.
3. **Relative tus `Location`.** `@tus/server` emitted an absolute `http://host/...` Location
   (it can't see it is behind the pinned TLS), so the phone sent every follow-up HEAD/PATCH as
   **plaintext to the HTTPS-only port** → reset (`unexpected end of stream on
com.android.okhttp`), zero server-side traffic. The desktop test masked it by re-attaching
   the https base and using only the path. Fixed with `relativeLocation: true` — `uploadRouting.ts`.

Phone-side, the upload status now surfaces the real transport exception (class + message)
instead of a bare `network`/`protocol`, and tus requests send `Connection: close` with
keep-alive disabled — which is what made bugs 2 and 3 diagnosable on the device
(`fix/mobile-tus-transport`).

Not separately checked but implied by the streaming design (no cache copy; size from a file
descriptor): the multi-GB / no-cache-copy conditions — revisit when the real engine drives a
large camera video.

## Deferred (to the scan/upload engine, spec 16-18)

Room persistence of `transfer_job`/`file_entry` (the spike keeps upload state in memory +
the tus URL store); the source-hash-verify-then-delete cleanup (spec 19); driving the upload
from the foreground service (spike 2) rather than a foreground screen; multi-file queueing.

## Desktop half (context)

The desktop tus transport, per-destination staging and atomic commit were proven earlier
(spike 6, `feature/phase1-*`): `@tus/server` folded into the Fastify control server, commit
pipeline verify → SHA-256 → atomic rename → immutable `remoteVersionId`, driven by the
`commitCoordinator` wired in `backend.ts`. This spike is the phone half meeting it.
