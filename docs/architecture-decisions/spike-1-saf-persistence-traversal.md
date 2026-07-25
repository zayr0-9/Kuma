# Spike 1 — SAF persistence and traversal

**Date:** 2026-07-25
**Status:** IMPLEMENTED — on-device verification pending the first dev build carrying this module
**Spec reference:** section 35 (spike 1), section 12 (scoped directory access), 13 (module boundary), 17.2 (scan traversal)

## What was built

The first real slice of the Kotlin native module
(`modules/foldersync-native/.../FolderSyncModule.kt`), its TypeScript surface
(`modules/foldersync-native/src/index.ts`), the mobile wrapper
(`apps/mobile/src/native/saf.ts`), and a device harness
(`apps/mobile/app/spike-saf.tsx`). The SAF surface:

- `pickDirectory()` — launches `ACTION_OPEN_DOCUMENT_TREE` with read/write/persistable/prefix
  grant flags, then `takePersistableUriPermission` using only the flags the provider actually
  granted (spec 12.1). No storage permission is requested; scoped access comes from the
  persisted URI grant alone — never `MANAGE_EXTERNAL_STORAGE`.
- `listPersistedPermissions()` — enumerates `contentResolver.persistedUriPermissions`; this is
  how restart persistence is proven, not assumed.
- `checkAccess(treeUri)` — re-tests root accessibility with a single query (spec 12.3): a
  persisted grant is not permanent truth.
- `traverseTree(treeUri, sampleLimit)` — recursive enumeration returning aggregate counts,
  total bytes, wall-clock timing, unreadable-dir and skipped-entry counts, and a capped file
  sample.
- `deleteDocument(documentUri)` — controlled deletion of a single chosen document.
- `releasePermission(treeUri)` — releases a persisted grant so testing leaves no residue.

## Decisions

- **Fast cursor traversal, not `DocumentFile`.** Traversal uses
  `DocumentsContract.buildChildDocumentsUriUsingTree` + a single `ContentResolver.query` per
  directory, pulling `DOCUMENT_ID`, `DISPLAY_NAME`, `MIME_TYPE`, `SIZE`, `LAST_MODIFIED` in one
  projection and iterating the cursor. `DocumentFile.listFiles()` issues a query per child and
  wraps each in an object — unusable at the spike's 10,000-file target. Spec 11.3/12.1
  explicitly permit "direct `DocumentsContract`/`ContentResolver` queries where performance
  requires it"; the 10,000-file bullet is exactly that case.
- **Breadth-first with an explicit queue** of `(documentId, relativePathPrefix)` rather than
  recursion, so a pathologically deep tree cannot blow the stack.
- **Aggregate + capped sample.** The bridge never carries 10,000 rows: JS gets counts, bytes
  and timing plus a bounded sample (default 50). The real scan engine persists per-file rows in
  Room (spec 16), not across the bridge.
- **Relative paths per spec 12.6.** Paths are built from the tree root by appending each child's
  display name, NFC-normalised, `/`-separated, no leading slash; segments equal to `.`/`..`,
  empty, or containing NUL are rejected and counted as `skippedEntries` rather than corrupting
  the path. The original display name is retained separately for UI.
- **Controlled deletion is single-document and explicit.** `deleteDocument` removes only the
  exact URI passed; the harness gates each deletion behind a confirmation dialog naming the file.
  The real retention/user-deletion flows (spec 18–19) add the hash-verified-backup gate; the
  spike deliberately does not, so it must only ever be pointed at a disposable test file.
- **No manifest changes.** SAF needs no permission declarations; the library manifest stays
  empty until the foreground-service work (spike 2).
- **Async result plumbing.** `pickDirectory` parks its `Promise` and resolves it from the
  module's `OnActivityResult` handler (request code `0x5AF1`); the picker launch is marshalled to
  the UI thread.

## On-device verification (pass condition: reliable restart persistence, complete traversal, controlled deletion)

The Kotlin cannot be compiled on this machine (spec 32.1); an EAS development build carrying
this module plus a run on the physical Samsung device confirms each spike bullet. Record results
here:

- [ ] Pick `DCIM/Camera` via `pickDirectory` — grant persists (`read=true, write=true`).
- [ ] Kill and relaunch the app — `listPersistedPermissions` still lists the tree; `checkAccess`
      returns accessible.
- [ ] Reboot the phone — same as above (true restart persistence).
- [ ] Traverse a realistic tree — file/dir counts and total bytes look right; sample shows
      correct relative paths, sizes and mtimes.
- [ ] Traverse a ~10,000-file tree — record `elapsedMs`; confirm it completes without ANR and
      without copying files.
- [ ] Delete a disposable test file via the harness — `deleted=true`; re-traverse shows the
      count drop by one.
- [ ] Revoke access in system settings — `checkAccess` returns not-accessible (never an empty
      traversal masquerading as "all files deleted", spec 12.3).

## Deferred to later spikes / the scan engine

- Room persistence of selected roots and `file_entry` rows (spec 16) — the spike traverses but
  does not persist per-file state.
- Overlap detection between ancestor/descendant roots (spec 12.5).
- Change candidacy, quiescence and the two-scan missing-file confirmation (spec 17.3–17.5).
- Provider-specific unreliable-timestamp diagnostics (spec 17.3).
