package expo.modules.foldersync

import android.content.ContentResolver
import android.content.Context
import android.net.Uri
import android.provider.DocumentsContract
import expo.modules.foldersync.db.FileEntryEntity
import expo.modules.foldersync.db.ObservedFile
import expo.modules.foldersync.db.RootStatus
import expo.modules.foldersync.db.SyncRootEntity
import expo.modules.foldersync.db.SyncStore
import expo.modules.foldersync.db.TransferJobEntity
import java.text.Normalizer
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
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
  // Bounded upload parallelism (spec 18.3): a small pool of workers stream bytes concurrently
  // while a single watcher finalises commits. Tunable; kept low to stay gentle on the SAF
  // providers, battery and the desktop, which already commits different paths in parallel.
  private const val UPLOAD_CONCURRENCY = 3
  // The commit watcher polls each outstanding prepareId this often. The desktop hashes the whole
  // file after upload (spec 18.5 step 6); a multi-GB file takes a while, so the per-file commit
  // deadline is generous.
  private const val COMMIT_POLL_INTERVAL_MS = 1_000L
  private const val COMMIT_POLL_TIMEOUT_MS = 10 * 60 * 1000L

  private val engineLock = ReentrantLock()

  // Files whose bytes are currently streaming, keyed by transfer-job id (up to UPLOAD_CONCURRENCY
  // at once), mirrored for the UI. Empty when the pool is idle.
  private val active = ConcurrentHashMap<String, ActiveTransfer>()

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

  fun activeTransfers(): List<ActiveTransfer> = active.values.toList()

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
      active.clear()
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

  // A file whose bytes are on the desktop, awaiting the desktop's verify → hash → atomic commit.
  // The watcher polls its prepareId to terminal and finalises Room state off the upload path.
  private data class PendingCommit(
    val job: TransferJobEntity,
    val file: FileEntryEntity,
    val deadline: Long,
  )

  // Drain the queue with a bounded pool of upload workers (spec 18.3). Each worker atomically
  // claims its own job (claimNextJob is a Room transaction, so no two workers get the same one),
  // streams the bytes, hands the prepareId to a single commit watcher and immediately claims the
  // next file — no worker ever blocks on the desktop hash+commit (the "gap" the sequential loop
  // suffered). The watcher finalises Room state as each commit lands, in parallel with uploads.
  private fun drainTransfers(context: Context, store: SyncStore, shouldStop: () -> Boolean): DrainResult {
    val claimable = store.claimableCount(System.currentTimeMillis())
    if (claimable == 0) return DrainResult(0, 0, null)
    val control = ControlClient.forPairedDesktop(context)
      ?: return DrainResult(0, 0, "not_paired")

    val committed = AtomicInteger(0)
    val failed = AtomicInteger(0)
    val pending = ConcurrentHashMap<String, PendingCommit>()
    val uploadersDone = AtomicBoolean(false)

    val watcher = Thread { watchCommits(store, control, pending, uploadersDone, committed, failed, shouldStop) }
    watcher.start()

    val workerCount = minOf(UPLOAD_CONCURRENCY, claimable)
    val workers = (0 until workerCount).map {
      Thread { uploadWorker(context, store, control, pending, committed, failed, shouldStop) }
    }
    workers.forEach { it.start() }
    workers.forEach { it.join() }
    // All bytes are up (or the pool stopped); let the watcher drain the remaining commits, then join.
    uploadersDone.set(true)
    watcher.join()

    active.clear()
    // Return each touched root to idle so its status is not stuck on "syncing".
    for (root in store.listEnabledRoots()) {
      if (root.status == RootStatus.SYNCING) store.setRootStatus(root.id, RootStatus.IDLE, System.currentTimeMillis())
    }
    return DrainResult(committed.get(), failed.get(), null)
  }

  // One upload worker: claim → stream bytes → hand off the commit → repeat, until the queue is
  // drained or a stop is requested. A Skip (desktop already has the version) is finalised here
  // with no commit poll; an Uploaded is handed to the watcher; a Failed parks the job.
  private fun uploadWorker(
    context: Context,
    store: SyncStore,
    control: ControlClient,
    pending: ConcurrentHashMap<String, PendingCommit>,
    committed: AtomicInteger,
    failed: AtomicInteger,
    shouldStop: () -> Boolean,
  ) {
    while (!shouldStop()) {
      val claimed = store.claimNextJob(System.currentTimeMillis()) ?: break
      val file = claimed.file
      val jobId = claimed.job.id
      val fileName = file.relativePath.substringAfterLast('/')
      store.setRootStatus(claimed.root.id, RootStatus.SYNCING, System.currentTimeMillis())
      active[jobId] = ActiveTransfer(
        rootId = claimed.root.id,
        fileName = fileName,
        relativePath = file.relativePath,
        state = "uploading",
        bytesUploaded = claimed.job.bytesUploaded,
        expectedSize = claimed.job.expectedSize,
      )

      var lastPersist = 0L
      val result = TusTransport.uploadBytes(
        context = context,
        control = control,
        file = file,
        onProgress = { bytes, expected, _, tusUrl ->
          active[jobId] = ActiveTransfer(claimed.root.id, fileName, file.relativePath, "uploading", bytes, expected)
          val nowMs = System.currentTimeMillis()
          if (nowMs - lastPersist >= PROGRESS_PERSIST_MS) {
            lastPersist = nowMs
            store.recordJobProgress(jobId, bytes, tusUrl, nowMs)
          }
        },
        shouldStop = shouldStop,
      )
      active.remove(jobId)

      when (result) {
        is UploadResult.Uploaded ->
          // Bytes are on the desktop; the watcher polls this prepareId and finalises the job.
          pending[result.prepareId] = PendingCommit(
            claimed.job, file, System.currentTimeMillis() + COMMIT_POLL_TIMEOUT_MS,
          )
        is UploadResult.Skipped -> {
          // The desktop already holds this exact version (spec 6.5) — record it as backed up.
          store.completeJob(claimed.job, result.remoteVersionId, result.sha256, file.sizeBytes, file.lastModifiedMs, System.currentTimeMillis())
          committed.incrementAndGet()
        }
        is UploadResult.Failed -> {
          store.failJob(claimed.job, result.errorCode, result.message, System.currentTimeMillis(), result.retryable)
          store.logEvent(
            if (result.retryable) "warn" else "error", "upload_failed", System.currentTimeMillis(),
            rootId = claimed.root.id, fileEntryId = file.id,
            message = "Upload of ${file.relativePath} failed: ${result.errorCode}",
          )
          failed.incrementAndGet()
        }
        is UploadResult.Cancelled -> return // paused/stopped — the claimed job is reclaimed next run
      }
    }
  }

  // The single commit watcher: sweeps every outstanding prepareId, polling the desktop to a
  // terminal state and finalising Room state (spec 18.5 steps 5-11) so upload workers never
  // block. Exits once the workers are done and nothing is left to commit. A per-file timeout
  // parks the commit as retryable — the next drain re-prepares and the desktop returns Skip.
  private fun watchCommits(
    store: SyncStore,
    control: ControlClient,
    pending: ConcurrentHashMap<String, PendingCommit>,
    uploadersDone: AtomicBoolean,
    committed: AtomicInteger,
    failed: AtomicInteger,
    shouldStop: () -> Boolean,
  ) {
    while (!shouldStop()) {
      if (pending.isEmpty()) {
        if (uploadersDone.get()) break
        sleepQuietly(COMMIT_POLL_INTERVAL_MS)
        continue
      }
      for ((prepareId, pc) in pending) {
        if (shouldStop()) return
        val now = System.currentTimeMillis()
        val status = control.getPrepareStatus(prepareId)
        if (status == null) {
          // A null status is a transient control failure (network blip) — keep polling until the
          // per-file deadline rather than failing the commit outright.
          if (now >= pc.deadline) {
            finaliseCommitFailure(store, pc, "commit_timeout", retryable = true, now)
            pending.remove(prepareId)
            failed.incrementAndGet()
          }
          continue
        }
        when (status.state) {
          "committed" -> {
            store.completeJob(pc.job, status.remoteVersionId, status.sha256, pc.file.sizeBytes, pc.file.lastModifiedMs, now)
            pending.remove(prepareId)
            committed.incrementAndGet()
          }
          "failed" -> {
            finaliseCommitFailure(store, pc, status.errorCode ?: "commit_failed", retryable = false, now)
            pending.remove(prepareId)
            failed.incrementAndGet()
          }
          "expired" -> {
            finaliseCommitFailure(store, pc, "upload_expired", retryable = false, now)
            pending.remove(prepareId)
            failed.incrementAndGet()
          }
          else -> {
            // Still verifying/hashing — keep polling until the per-file deadline.
            if (now >= pc.deadline) {
              finaliseCommitFailure(store, pc, "commit_timeout", retryable = true, now)
              pending.remove(prepareId)
              failed.incrementAndGet()
            }
          }
        }
      }
      sleepQuietly(COMMIT_POLL_INTERVAL_MS)
    }
  }

  private fun finaliseCommitFailure(store: SyncStore, pc: PendingCommit, errorCode: String, retryable: Boolean, now: Long) {
    store.failJob(pc.job, errorCode, null, now, retryable)
    store.logEvent(
      if (retryable) "warn" else "error", "upload_failed", now,
      rootId = pc.job.rootId, fileEntryId = pc.file.id,
      message = "Commit of ${pc.file.relativePath} failed: $errorCode",
    )
  }

  private fun sleepQuietly(ms: Long) {
    try {
      Thread.sleep(ms)
    } catch (e: InterruptedException) {
      Thread.currentThread().interrupt()
    }
  }
}
