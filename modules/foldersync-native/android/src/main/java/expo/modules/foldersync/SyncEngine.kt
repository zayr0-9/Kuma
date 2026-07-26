package expo.modules.foldersync

import android.content.ContentResolver
import android.content.Context
import android.net.Uri
import android.provider.DocumentsContract
import expo.modules.foldersync.db.ObservedFile
import expo.modules.foldersync.db.RootStatus
import expo.modules.foldersync.db.SyncRootEntity
import expo.modules.foldersync.db.SyncStore
import java.text.Normalizer
import java.util.concurrent.locks.ReentrantLock

// The phone-side sync loop (spec 17 + 18), turning the spike transport into a real backup. It
// is driven both by the foreground service tick (background operation, spec 14) and by the JS
// "Sync now" action; a single lock serialises the two so only one drain runs at a time
// (spec 18.3, one upload per phone). Room is the durable truth; this object holds only a
// volatile snapshot of the file currently in flight, for the live progress bar.
object SyncEngine {
  // A root not scanned within this window is due for a rescan on the next service tick
  // (spec 17.1). A manual Sync-now forces a scan regardless.
  private const val SCAN_INTERVAL_MS = 15 * 60 * 1000L
  // Persist upload progress to Room at most this often; the in-memory snapshot updates every
  // chunk for a smooth bar, but the durable row need not (it exists only to resume + report).
  private const val PROGRESS_PERSIST_MS = 2_000L

  private val engineLock = ReentrantLock()

  @Volatile private var active: ActiveTransfer? = null

  // A file mid-transfer, mirrored for the UI. Null when the queue is idle.
  data class ActiveTransfer(
    val rootId: String,
    val fileName: String,
    val relativePath: String,
    val state: String,
    val bytesUploaded: Long,
    val expectedSize: Long,
  )

  // Summary of one runSync pass, for the JS "Sync now" acknowledgement.
  data class SyncOutcome(
    val ran: Boolean,
    val rootsScanned: Int,
    val committed: Int,
    val failed: Int,
    val cleaned: Int,
    val reason: String?,
  )

  fun activeTransfer(): ActiveTransfer? = active

  // Scan due (or, when forced, all enabled) roots, then drain the transfer queue. Serialised:
  // a concurrent caller gets ran=false/busy rather than a second drain. `shouldStop` lets the
  // service interrupt cleanly on pause/stop.
  fun runSync(context: Context, force: Boolean, shouldStop: () -> Boolean): SyncOutcome {
    if (!engineLock.tryLock()) return SyncOutcome(false, 0, 0, 0, 0, "busy")
    try {
      val store = SyncStore.get(context.applicationContext)
      // A drainer that died mid-upload leaves 'uploading' jobs stranded; reclaim them first.
      store.requeueStrandedJobs(System.currentTimeMillis())

      var scanned = 0
      for (root in store.listEnabledRoots()) {
        if (shouldStop()) break
        if (force || isScanDue(root)) {
          scanRoot(context, store, root, shouldStop)
          scanned++
        }
      }

      val drain = drainTransfers(context, store, shouldStop)
      // Only after the drain: verify freshly-committed files against the desktop hash and free the
      // phone copy for delete_after_verified_backup roots (spec 19). Skipped on stop so a paused
      // service never deletes mid-shutdown.
      val cleaned = if (shouldStop()) 0 else CleanupEngine.cleanupEnabledRoots(context, store, shouldStop)
      return SyncOutcome(true, scanned, drain.committed, drain.failed, cleaned, drain.reason)
    } finally {
      active = null
      engineLock.unlock()
    }
  }

  private fun isScanDue(root: SyncRootEntity): Boolean {
    val last = root.lastCompleteScanAt ?: return true
    return System.currentTimeMillis() - last >= SCAN_INTERVAL_MS
  }

  // --- scan (spec 17.2) ---

  private fun scanRoot(context: Context, store: SyncStore, root: SyncRootEntity, shouldStop: () -> Boolean) {
    val resolver = context.contentResolver
    val treeUri = Uri.parse(root.treeUri)
    val ctx = store.beginScan(root.id, System.currentTimeMillis())

    // Confirm root access before traversing (spec 17.2 step 2 / 12.3): a persisted grant can be
    // revoked or the volume removed — neither means "all files deleted", so a failed scan never
    // evaluates missing files (spec 17.2 step 6).
    if (!rootAccessible(resolver, treeUri)) {
      store.failScan(ctx, "folder_access_lost", System.currentTimeMillis())
      store.logEvent(
        "warn", "folder_access_lost", System.currentTimeMillis(),
        rootId = root.id, message = "Lost access to ${root.displayName}. Select the folder again.",
      )
      return
    }

    var filesSeen = 0
    var bytesSeen = 0L
    try {
      walk(resolver, treeUri, shouldStop) { observed ->
        filesSeen++
        bytesSeen += observed.sizeBytes
        store.observeFile(ctx, observed, System.currentTimeMillis())
      }
    } catch (cancelled: ScanCancelled) {
      // Interrupted by pause/stop: leave the scan failed so missing files are NOT evaluated.
      store.failScan(ctx, "cancelled", System.currentTimeMillis())
      return
    } catch (e: Exception) {
      store.failScan(ctx, "scan_error", System.currentTimeMillis())
      store.logEvent(
        "error", "scan_error", System.currentTimeMillis(),
        rootId = root.id, message = "Scan of ${root.displayName} failed: ${e.javaClass.simpleName}",
      )
      return
    }

    // Only a complete traversal marks the scan done + evaluates missing files (spec 17.2 step 5).
    store.finishScan(ctx, filesSeen, bytesSeen, System.currentTimeMillis())
  }

  private fun rootAccessible(resolver: ContentResolver, treeUri: Uri): Boolean = try {
    val docUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, DocumentsContract.getTreeDocumentId(treeUri))
    resolver.query(docUri, arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID), null, null, null)
      ?.use { it.moveToFirst() } ?: false
  } catch (e: Exception) {
    false
  }

  // Iterative BFS over the SAF tree using bulk cursor queries (spec 17.2 steps 3-4, 11.3) — the
  // same fast DocumentsContract path the spike-1 traversal proved, here feeding the scan engine
  // one ObservedFile at a time rather than returning a sample. `onFile` runs the Room upsert.
  private fun walk(
    resolver: ContentResolver,
    treeUri: Uri,
    shouldStop: () -> Boolean,
    onFile: (ObservedFile) -> Unit,
  ) {
    val projection = arrayOf(
      DocumentsContract.Document.COLUMN_DOCUMENT_ID,
      DocumentsContract.Document.COLUMN_DISPLAY_NAME,
      DocumentsContract.Document.COLUMN_MIME_TYPE,
      DocumentsContract.Document.COLUMN_SIZE,
      DocumentsContract.Document.COLUMN_LAST_MODIFIED,
    )
    val queue = ArrayDeque<Pair<String, String>>()
    queue.add(DocumentsContract.getTreeDocumentId(treeUri) to "")

    while (queue.isNotEmpty()) {
      if (shouldStop()) throw ScanCancelled()
      val (parentDocId, prefix) = queue.removeFirst()
      val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parentDocId)
      val cursor = try {
        resolver.query(childrenUri, projection, null, null, null)
      } catch (e: Exception) {
        null
      } ?: continue // an unreadable subdirectory is skipped, not fatal to the whole scan
      cursor.use { c ->
        val idIndex = c.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DOCUMENT_ID)
        val nameIndex = c.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DISPLAY_NAME)
        val mimeIndex = c.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_MIME_TYPE)
        val sizeIndex = c.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_SIZE)
        val modifiedIndex = c.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_LAST_MODIFIED)
        while (c.moveToNext()) {
          val docId = c.getString(idIndex) ?: continue
          val name = c.getString(nameIndex)
          val relativePath = joinRelative(prefix, name) ?: continue
          val mime = if (c.isNull(mimeIndex)) null else c.getString(mimeIndex)
          if (mime == DocumentsContract.Document.MIME_TYPE_DIR) {
            queue.add(docId to relativePath)
          } else {
            onFile(
              ObservedFile(
                documentUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, docId).toString(),
                documentId = docId,
                relativePath = relativePath,
                displayName = name ?: relativePath,
                mimeType = mime,
                sizeBytes = if (c.isNull(sizeIndex)) 0L else c.getLong(sizeIndex),
                lastModifiedMs = if (c.isNull(modifiedIndex)) null else c.getLong(modifiedIndex),
              ),
            )
          }
        }
      }
    }
  }

  // Relative path from the selected tree root (spec 12.6): "/" separator, no leading slash,
  // NFC-normalised, rejecting "."/".."/NUL. Null for an unusable segment → the caller skips it.
  private fun joinRelative(prefix: String, name: String?): String? {
    if (name == null) return null
    val segment = Normalizer.normalize(name, Normalizer.Form.NFC)
    if (segment.isEmpty() || segment == "." || segment == ".." || segment.any { it.code == 0 }) return null
    return if (prefix.isEmpty()) segment else "$prefix/$segment"
  }

  private class ScanCancelled : RuntimeException()

  // --- transfer drain (spec 18) ---

  private data class DrainResult(val committed: Int, val failed: Int, val reason: String?)

  private fun drainTransfers(context: Context, store: SyncStore, shouldStop: () -> Boolean): DrainResult {
    if (store.claimableCount(System.currentTimeMillis()) == 0) return DrainResult(0, 0, null)
    val control = ControlClient.forPairedDesktop(context)
      ?: return DrainResult(0, 0, "not_paired")

    var committed = 0
    var failed = 0
    while (!shouldStop()) {
      val claimed = store.claimNextJob(System.currentTimeMillis()) ?: break
      val file = claimed.file
      store.setRootStatus(claimed.root.id, RootStatus.SYNCING, System.currentTimeMillis())
      active = ActiveTransfer(
        rootId = claimed.root.id,
        fileName = file.relativePath.substringAfterLast('/'),
        relativePath = file.relativePath,
        state = "uploading",
        bytesUploaded = claimed.job.bytesUploaded,
        expectedSize = claimed.job.expectedSize,
      )

      var lastPersist = 0L
      val result = TusTransport.uploadFile(
        context = context,
        control = control,
        file = file,
        onProgress = { bytes, expected, _, tusUrl ->
          active = active?.copy(bytesUploaded = bytes, expectedSize = expected)
          val nowMs = System.currentTimeMillis()
          if (nowMs - lastPersist >= PROGRESS_PERSIST_MS) {
            lastPersist = nowMs
            store.recordJobProgress(claimed.job.id, bytes, tusUrl, nowMs)
          }
        },
        shouldStop = shouldStop,
      )

      when (result) {
        is TransferResult.Committed -> {
          store.completeJob(claimed.job, result.remoteVersionId, result.sha256, file.sizeBytes, file.lastModifiedMs, System.currentTimeMillis())
          committed++
        }
        is TransferResult.Skipped -> {
          // The desktop already holds this exact version (spec 6.5) — record it as backed up.
          store.completeJob(claimed.job, result.remoteVersionId, result.sha256, file.sizeBytes, file.lastModifiedMs, System.currentTimeMillis())
          committed++
        }
        is TransferResult.Failed -> {
          store.failJob(claimed.job, result.errorCode, result.message, System.currentTimeMillis(), result.retryable)
          store.logEvent(
            if (result.retryable) "warn" else "error", "upload_failed", System.currentTimeMillis(),
            rootId = claimed.root.id, fileEntryId = file.id,
            message = "Upload of ${file.relativePath} failed: ${result.errorCode}",
          )
          failed++
        }
        is TransferResult.Cancelled -> break // paused/stopped — the claimed job is reclaimed next run
      }
    }
    active = null
    // Return each touched root to idle so its status is not stuck on "syncing".
    for (root in store.listEnabledRoots()) {
      if (root.status == RootStatus.SYNCING) store.setRootStatus(root.id, RootStatus.IDLE, System.currentTimeMillis())
    }
    return DrainResult(committed, failed, null)
  }
}
