# Spike 5 — tus direct URI upload

**Date:** 2026-07-26
**Status:** IMPLEMENTED — on-device verification pending
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

## On-device checklist (pass conditions)

- [ ] Pick a folder, bind it to the desktop "kumatest" destination (card flips from "Waiting
      for a phone folder").
- [ ] Upload a small file → reaches `committed`, desktop shows the file in the destination.
- [ ] Upload a **multi-GB** video; mid-transfer toggle Wi-Fi off then on → the transfer
      **resumes** from the stored offset (progress does not reset to 0).
- [ ] Kill the app mid-transfer, reopen, upload the same file → **resumes** from the server
      offset (no restart from zero).
- [ ] Confirm no whole-file copy appears in app cache during the upload.

## Deferred (to the scan/upload engine, spec 16-18)

Room persistence of `transfer_job`/`file_entry` (the spike keeps upload state in memory +
the tus URL store); the source-hash-verify-then-delete cleanup (spec 19); driving the upload
from the foreground service (spike 2) rather than a foreground screen; multi-file queueing.

## Desktop half (context)

The desktop tus transport, per-destination staging and atomic commit were proven earlier
(spike 6, `feature/phase1-*`): `@tus/server` folded into the Fastify control server, commit
pipeline verify → SHA-256 → atomic rename → immutable `remoteVersionId`, driven by the
`commitCoordinator` wired in `backend.ts`. This spike is the phone half meeting it.
