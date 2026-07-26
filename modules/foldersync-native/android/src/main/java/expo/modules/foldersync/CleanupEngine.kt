package expo.modules.foldersync

import android.content.ContentResolver
import android.content.Context
import android.net.Uri
import android.provider.DocumentsContract
import expo.modules.foldersync.db.FileEntryEntity
import expo.modules.foldersync.db.RetentionPolicy
import expo.modules.foldersync.db.SyncStore
import java.io.IOException
import java.security.MessageDigest

// Phone-side cleanup after a verified backup (spec 19). For delete_after_verified_backup roots
// only, this independently re-verifies each backed-up file against the desktop's committed
// SHA-256 and — only on an exact match — deletes the phone copy. Because that destroys the only
// other copy, every guard in spec 19.1-19.4 is mandatory and ordered:
//
//   re-query metadata just before deleting (19.4, cancel + re-upload if it changed)
//     → re-read the source and hash it independently (19.2; NOT the resumable upload's digest,
//       which a resume reads only from an offset)
//     → on mismatch: never delete, re-upload the current bytes (19.2)
//     → mark retention_cleanup_expected = true durably BEFORE deleting (19.1)
//     → delete through the document provider
//     → record success; on failure mark cleanup_failed (19.3), never re-upload
//
// A retention deletion is never propagated to the desktop (that is what the expected flag
// suppresses in the scan's missing-file evaluation). Runs after the transfer drain, on the engine
// worker thread, serialised by SyncEngine's lock.
object CleanupEngine {
  private const val HASH_BUFFER = 64 * 1024

  private enum class Outcome { CLEANED, REQUEUED, FAILED, SKIPPED }

  // Verify + clean every enabled, delete-eligible root. Returns the number of files freed from
  // the phone this pass.
  fun cleanupEnabledRoots(context: Context, store: SyncStore, shouldStop: () -> Boolean): Int {
    var cleaned = 0
    for (root in store.listEnabledRoots()) {
      if (shouldStop()) break
      if (root.phoneRetentionPolicy != RetentionPolicy.DELETE_AFTER_VERIFIED_BACKUP) continue
      cleaned += cleanupRoot(context, store, root.id, shouldStop)
    }
    return cleaned
  }

  private fun cleanupRoot(context: Context, store: SyncStore, rootId: String, shouldStop: () -> Boolean): Int {
    val resolver = context.contentResolver
    var cleaned = 0
    // Drain the root in bounded batches. A file that is only *transiently* unreadable stays
    // 'backed_up' and would be re-selected forever, so we stop a batch loop as soon as it makes
    // no progress and let the next whole sync pass retry it.
    while (!shouldStop()) {
      val batch = store.listCleanable(rootId)
      if (batch.isEmpty()) break
      var progressed = 0
      for (file in batch) {
        if (shouldStop()) break
        val outcome = cleanupFile(resolver, store, file, shouldStop)
        if (outcome != Outcome.SKIPPED) progressed++
        if (outcome == Outcome.CLEANED) cleaned++
      }
      if (progressed == 0) break
    }
    return cleaned
  }

  private fun cleanupFile(
    resolver: ContentResolver,
    store: SyncStore,
    file: FileEntryEntity,
    shouldStop: () -> Boolean,
  ): Outcome {
    val remoteHash = file.remoteSha256 ?: return Outcome.SKIPPED // unverifiable — never delete
    val uri = Uri.parse(file.documentUri)
    val now = System.currentTimeMillis()

    // 1. Re-query metadata immediately before deletion (spec 19.4).
    val meta = queryMeta(resolver, uri)
    if (meta == null) {
      // Gone from disk. If we had already recorded the delete intent, the deletion happened and we
      // crashed before recording success (spec 19.1) — record it now. Otherwise it is a user
      // deletion the scan's missing-file rule evaluates; do not touch it here.
      return if (file.retentionCleanupExpected) {
        store.markCleaned(file.id, now)
        Outcome.CLEANED
      } else {
        Outcome.SKIPPED
      }
    }
    if (metadataChanged(file, meta)) {
      store.enqueueReupload(file.id, now)
      store.logEvent(
        "info", "retention_recheck", now, rootId = file.rootId, fileEntryId = file.id,
        message = "Skipped cleanup — ${file.relativePath} changed since backup; re-uploading.",
      )
      return Outcome.REQUEUED
    }

    // 2. Re-read the source and hash it independently (spec 19.2).
    val localHash = sha256(resolver, uri, shouldStop) ?: return Outcome.SKIPPED // read error/stop — retry later
    if (!localHash.equals(remoteHash, ignoreCase = true)) {
      // The desktop stored bytes that no longer match the phone copy (a bad read on either side):
      // never delete; re-upload the current bytes and record it (spec 19.2).
      store.enqueueReupload(file.id, now)
      store.logEvent(
        "warn", "retention_hash_mismatch", now, rootId = file.rootId, fileEntryId = file.id,
        message = "Backup hash did not match ${file.relativePath}; re-uploading instead of deleting.",
      )
      return Outcome.REQUEUED
    }

    // 3. Record the intent to delete durably before deleting (spec 19.1).
    store.markCleanupExpected(file.id, now)

    // 4. Delete the phone copy through the document provider (spec 19.1).
    val deleted = try {
      DocumentsContract.deleteDocument(resolver, uri)
    } catch (e: Exception) {
      false
    }
    if (!deleted) {
      store.markCleanupFailed(file.id, now)
      store.logEvent(
        "warn", "cleanup_failed", now, rootId = file.rootId, fileEntryId = file.id,
        message = "Backed up but could not remove ${file.relativePath} from the phone.",
      )
      return Outcome.FAILED
    }

    // 5. Record cleanup success (spec 19.1).
    store.markCleaned(file.id, now)
    store.logEvent(
      "info", "retention_cleaned", now, rootId = file.rootId, fileEntryId = file.id,
      message = "Freed ${file.relativePath} from the phone (safely backed up).",
    )
    return Outcome.CLEANED
  }

  // Current size/mtime/documentId of the document, or null if it no longer exists / is unreadable.
  private data class Meta(val sizeBytes: Long, val lastModifiedMs: Long?, val documentId: String?)

  private fun queryMeta(resolver: ContentResolver, uri: Uri): Meta? = try {
    resolver.query(
      uri,
      arrayOf(
        DocumentsContract.Document.COLUMN_SIZE,
        DocumentsContract.Document.COLUMN_LAST_MODIFIED,
        DocumentsContract.Document.COLUMN_DOCUMENT_ID,
      ),
      null, null, null,
    )?.use { c ->
      if (!c.moveToFirst()) {
        null
      } else {
        Meta(
          sizeBytes = if (c.isNull(0)) 0L else c.getLong(0),
          lastModifiedMs = if (c.isNull(1)) null else c.getLong(1),
          documentId = if (c.isNull(2)) null else c.getString(2),
        )
      }
    }
  } catch (e: Exception) {
    null
  }

  // Same change signal as the scan's candidate rule (spec 17.3), applied to a fresh query just
  // before deletion: size, then a reliable non-zero mtime on both sides, then a changed
  // documentId. Where the provider gives unreliable times, the independent hash is the backstop.
  private fun metadataChanged(file: FileEntryEntity, meta: Meta): Boolean {
    if (file.lastCommittedSize != null && file.lastCommittedSize != meta.sizeBytes) return true
    val committedMs = file.lastCommittedModifiedMs
    val currentMs = meta.lastModifiedMs
    if (committedMs != null && currentMs != null && committedMs > 0 && currentMs > 0 && committedMs != currentMs) {
      return true
    }
    if (file.documentId != null && meta.documentId != null && file.documentId != meta.documentId) return true
    return false
  }

  // Streaming SHA-256 of the source, lowercase hex to match the desktop's digest('hex')
  // (apps/desktop hashWorker). Null on a read error or an interrupt, so the caller retries later
  // rather than treating an unreadable file as verified.
  private fun sha256(resolver: ContentResolver, uri: Uri, shouldStop: () -> Boolean): String? = try {
    resolver.openInputStream(uri)?.use { stream ->
      val digest = MessageDigest.getInstance("SHA-256")
      val buffer = ByteArray(HASH_BUFFER)
      while (true) {
        if (shouldStop()) return null
        val read = stream.read(buffer)
        if (read < 0) break
        digest.update(buffer, 0, read)
      }
      digest.digest().joinToString("") { "%02x".format(it.toInt() and 0xFF) }
    }
  } catch (e: IOException) {
    null
  } catch (e: Exception) {
    null
  }
}
