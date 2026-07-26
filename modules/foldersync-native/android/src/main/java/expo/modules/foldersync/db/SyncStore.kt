package expo.modules.foldersync.db

import android.content.Context
import java.util.UUID
import java.util.concurrent.Callable

// State vocabularies shared by the store, engine and UI. file_entry.localState is the file's
// lifecycle; transfer_job.state is the queue state of its in-flight upload (a committed job is
// deleted, so there is no "committed" job state).
object FileState {
  const val DISCOVERED = "discovered" // seen by a scan, not yet queued (e.g. still quiescing)
  const val PENDING_UPLOAD = "pending_upload" // a transfer_job exists and is queued
  const val UPLOADING = "uploading" // its transfer_job is in flight
  const val BACKED_UP = "backed_up" // committed on the desktop (remoteVersionId set)
  const val MISSING = "missing" // absent from a completed scan; confirmation in progress
  const val DELETED = "deleted" // confirmed gone from the phone (spec 17.5)
  const val ERROR = "error" // its upload exhausted retries
}

object JobState {
  const val PENDING = "pending"
  const val UPLOADING = "uploading"
  const val FAILED = "failed"
}

object RootStatus {
  const val IDLE = "idle"
  const val SCANNING = "scanning"
  const val SYNCING = "syncing"
  const val ERROR = "error"
}

// One regular file as a scan observed it (spec 17.2 step 4). relativePath is already NFC-safe.
data class ObservedFile(
  val documentUri: String,
  val documentId: String?,
  val relativePath: String,
  val displayName: String,
  val mimeType: String?,
  val sizeBytes: Long,
  val lastModifiedMs: Long?,
)

// The generation + ids for the scan pass in progress (spec 17.2 step 1).
data class ScanContext(val rootId: String, val scanRunId: String, val generation: Int)

// Per-root counts the Folders UI renders (spec 5.2 "pending file count and bytes").
data class RootAggregate(val pendingCount: Int, val pendingBytes: Long, val backedUpCount: Int)

// A claimed transfer job plus the file it moves — everything the upload worker needs without a
// second round-trip.
data class ClaimedJob(val job: TransferJobEntity, val file: FileEntryEntity, val root: SyncRootEntity)

// Facade over Room that owns the transactional state transitions the engine relies on
// (spec 16.2). The engine and module go through here rather than touching DAOs directly, so
// the "which writes must be atomic" decisions live in one place.
class SyncStore private constructor(private val db: FolderSyncDatabase) {
  companion object {
    // Don't upload a file that may still be being written — most importantly a camera video
    // that is currently recording (spec 17.3). A file whose mtime is within this window of now
    // is skipped this scan and re-evaluated next time, once it has settled.
    private const val QUIESCENCE_MS = 45_000L
    // Two confirming scans of a missing file must be at least this far apart, so a manual
    // "Sync now" right after a scheduled scan cannot double-count a transient provider glitch
    // (spec 17.5).
    private const val MISSING_CONFIRM_GAP_MS = 15 * 60 * 1000L
    private const val MAX_UPLOAD_ATTEMPTS = 8

    fun get(context: Context): SyncStore = SyncStore(FolderSyncDatabase.get(context))
  }

  private val roots = db.syncRoots()
  private val scans = db.scanRuns()
  private val files = db.fileEntries()
  private val jobs = db.transferJobs()
  private val events = db.syncEvents()

  // --- roots ---

  fun upsertRoot(root: SyncRootEntity) = roots.upsert(root)

  fun getRoot(id: String): SyncRootEntity? = roots.getById(id)

  fun listRoots(): List<SyncRootEntity> = roots.getAll()

  fun listEnabledRoots(): List<SyncRootEntity> = roots.getEnabled()

  fun setRootEnabled(id: String, enabled: Boolean, now: Long) = roots.setEnabled(id, enabled, now)

  fun setRootStatus(id: String, status: String, now: Long, errorCode: String? = null, errorMessage: String? = null) =
    roots.updateStatus(id, status, errorCode, errorMessage, now)

  fun rootAggregate(rootId: String) = RootAggregate(
    pendingCount = files.countPending(rootId),
    pendingBytes = files.pendingBytes(rootId),
    backedUpCount = files.countBackedUp(rootId),
  )

  // Removing a root drops all of its cached state (files, jobs, scans) in one transaction. The
  // desktop copies already made are untouched — this only forgets the phone-side binding.
  fun deleteRoot(rootId: String) = db.runInTransaction(Runnable {
    jobs.deleteByRoot(rootId)
    files.deleteByRoot(rootId)
    scans.deleteByRoot(rootId)
    roots.delete(rootId)
  })

  // --- scanning (spec 17.2) ---

  fun beginScan(rootId: String, now: Long): ScanContext {
    val generation = (scans.maxGeneration(rootId) ?: 0) + 1
    val scanRunId = UUID.randomUUID().toString()
    scans.insert(
      ScanRunEntity(
        id = scanRunId,
        rootId = rootId,
        generation = generation,
        startedAt = now,
        completedAt = null,
        status = "running",
        filesSeen = 0,
        bytesSeen = 0,
        errorCode = null,
      ),
    )
    roots.updateStatus(rootId, RootStatus.SCANNING, null, null, now)
    return ScanContext(rootId, scanRunId, generation)
  }

  // Upsert one observed file and, if it is a change candidate (spec 17.3) that has settled,
  // ensure a transfer job. Not wrapped in a transaction: nothing acts on these rows until the
  // scan is marked complete, so a partially applied generation is simply re-derived next scan
  // (spec 17.2 step 5). Returns true when a job was (re)queued, for the scan's counters.
  fun observeFile(ctx: ScanContext, observed: ObservedFile, now: Long): Boolean {
    val existing = files.getByRootAndPath(ctx.rootId, observed.relativePath)
    if (existing == null) {
      val entry = FileEntryEntity(
        id = UUID.randomUUID().toString(),
        rootId = ctx.rootId,
        documentUri = observed.documentUri,
        documentId = observed.documentId,
        relativePath = observed.relativePath,
        displayName = observed.displayName,
        mimeType = observed.mimeType,
        sizeBytes = observed.sizeBytes,
        lastModifiedMs = observed.lastModifiedMs,
        lastSeenGeneration = ctx.generation,
        localState = FileState.DISCOVERED,
        remoteVersionId = null,
        remoteSha256 = null,
        lastCommittedSize = null,
        lastCommittedModifiedMs = null,
        missingConfirmationCount = 0,
        retentionCleanupExpected = false,
        createdAt = now,
        updatedAt = now,
      )
      files.insert(entry)
      return maybeEnqueue(entry, now)
    }

    // Refresh the seen metadata + generation; reappearing clears any missing confirmation.
    val refreshed = existing.copy(
      documentUri = observed.documentUri,
      documentId = observed.documentId,
      displayName = observed.displayName,
      mimeType = observed.mimeType,
      sizeBytes = observed.sizeBytes,
      lastModifiedMs = observed.lastModifiedMs,
      lastSeenGeneration = ctx.generation,
      missingConfirmationCount = 0,
      localState = if (existing.localState == FileState.MISSING || existing.localState == FileState.DELETED) {
        FileState.DISCOVERED
      } else {
        existing.localState
      },
      updatedAt = now,
    )
    files.update(refreshed)
    return if (isCandidate(existing, observed)) maybeEnqueue(refreshed, now) else false
  }

  // Change candidate rules (spec 17.3): a backed-up file is a candidate only if its committed
  // metadata changed; a not-yet-backed-up file is always a candidate until it commits.
  private fun isCandidate(existing: FileEntryEntity, observed: ObservedFile): Boolean {
    if (existing.localState != FileState.BACKED_UP) return true
    if (existing.lastCommittedSize != observed.sizeBytes) return true
    // Timestamps are only reliable when both sides are present and non-zero; where a provider
    // returns unreliable times, detection degrades to path+size (spec 17.3).
    val committedMs = existing.lastCommittedModifiedMs
    val observedMs = observed.lastModifiedMs
    if (committedMs != null && observedMs != null && committedMs > 0 && observedMs > 0 && committedMs != observedMs) {
      return true
    }
    if (existing.documentId != null && observed.documentId != null && existing.documentId != observed.documentId) {
      return true
    }
    return false
  }

  // Ensure a queued transfer job for this entry, unless the file is too fresh to be quiescent
  // (spec 17.3) or a live job already exists. A previously failed job is reset to pending.
  private fun maybeEnqueue(entry: FileEntryEntity, now: Long): Boolean {
    val mtime = entry.lastModifiedMs
    if (mtime != null && mtime > 0 && now - mtime < QUIESCENCE_MS) {
      // Still settling — leave it discovered; the next scan re-evaluates once it has aged.
      files.updateState(entry.id, FileState.DISCOVERED, now)
      return false
    }
    val existingJob = jobs.getByFileEntry(entry.id)
    if (existingJob != null && existingJob.state != JobState.FAILED) return false
    jobs.upsert(
      TransferJobEntity(
        id = existingJob?.id ?: UUID.randomUUID().toString(),
        rootId = entry.rootId,
        fileEntryId = entry.id,
        operation = "upload",
        state = JobState.PENDING,
        attemptCount = 0,
        nextAttemptAt = now,
        tusUploadUrl = null,
        bytesUploaded = 0,
        expectedSize = entry.sizeBytes,
        desktopPrepareId = null,
        lastErrorCode = null,
        lastErrorMessage = null,
        createdAt = existingJob?.createdAt ?: now,
        updatedAt = now,
      ),
    )
    files.updateState(entry.id, FileState.PENDING_UPLOAD, now)
    return true
  }

  // Complete the scan transactionally (spec 16.2, 17.2 step 5): record the run, then evaluate
  // entries missing from this generation for the two-observation deletion rule (spec 17.5).
  fun finishScan(ctx: ScanContext, filesSeen: Int, bytesSeen: Long, now: Long) = db.runInTransaction(Runnable {
    scans.update(
      ScanRunEntity(
        id = ctx.scanRunId,
        rootId = ctx.rootId,
        generation = ctx.generation,
        startedAt = now,
        completedAt = now,
        status = "completed",
        filesSeen = filesSeen,
        bytesSeen = bytesSeen,
        errorCode = null,
      ),
    )
    for (missing in files.listMissing(ctx.rootId, ctx.generation)) {
      evaluateMissing(missing, now)
    }
    roots.markScanned(ctx.rootId, now, RootStatus.IDLE)
  })

  // A file absent from a completed scan. First miss records the observation; a second miss,
  // at least MISSING_CONFIRM_GAP_MS later, confirms it as gone (spec 17.5). Deletion
  // *propagation* to the desktop (deletion_event + remote-delete job) is spec 19, deferred —
  // here we mark the phone state and log, so the confirmation machinery is exercised.
  private fun evaluateMissing(entry: FileEntryEntity, now: Long) {
    if (entry.missingConfirmationCount == 0) {
      files.update(entry.copy(missingConfirmationCount = 1, localState = FileState.MISSING, updatedAt = now))
      return
    }
    if (now - entry.updatedAt < MISSING_CONFIRM_GAP_MS) return // too soon to count a second time
    files.update(entry.copy(missingConfirmationCount = 2, localState = FileState.DELETED, updatedAt = now))
    logEvent("info", "file_deleted_locally", now, rootId = entry.rootId, fileEntryId = entry.id,
      message = "Confirmed removed from the phone: ${entry.relativePath}")
  }

  fun failScan(ctx: ScanContext, errorCode: String, now: Long) = db.runInTransaction(Runnable {
    scans.update(
      ScanRunEntity(
        id = ctx.scanRunId,
        rootId = ctx.rootId,
        generation = ctx.generation,
        startedAt = now,
        completedAt = now,
        status = "failed",
        filesSeen = 0,
        bytesSeen = 0,
        errorCode = errorCode,
      ),
    )
    // A failed traversal must NOT create deletion events (spec 17.2 step 6) — we only record
    // the error on the root; missing evaluation is skipped entirely.
    roots.updateStatus(ctx.rootId, RootStatus.ERROR, errorCode, "Scan failed", now)
  })

  // --- transfer queue (spec 18) ---

  fun requeueStrandedJobs(now: Long) = jobs.requeueStranded(now)

  fun claimableCount(now: Long): Int = jobs.countClaimable(now)

  // Atomically take the next queued job and mark it (and its file) in flight, so a second
  // drainer cannot pick the same one. Returns null when the queue is empty or the file/root
  // vanished under it.
  fun claimNextJob(now: Long): ClaimedJob? = db.runInTransaction(
    Callable<ClaimedJob?> {
      val job = jobs.nextClaimable(now)
      if (job == null) {
        null
      } else {
        val file = files.getById(job.fileEntryId)
        val root = roots.getById(job.rootId)
        if (file == null || root == null) {
          jobs.delete(job.id) // orphaned job — its file or root is gone
          null
        } else {
          val claimed = job.copy(state = JobState.UPLOADING, updatedAt = now)
          jobs.update(claimed)
          files.updateState(file.id, FileState.UPLOADING, now)
          ClaimedJob(claimed, file, root)
        }
      }
    },
  )

  fun recordJobProgress(jobId: String, bytes: Long, tusUrl: String?, now: Long) =
    jobs.updateProgress(jobId, bytes, tusUrl, now)

  // Commit acknowledgement + version update, atomically (spec 16.2, 18.5 step 11): stamp the
  // file with the durable desktop version and drop the job.
  fun completeJob(
    job: TransferJobEntity,
    remoteVersionId: String?,
    sha256: String?,
    committedSize: Long,
    committedModifiedMs: Long?,
    now: Long,
  ) = db.runInTransaction(Runnable {
    val file = files.getById(job.fileEntryId)
    if (file != null) {
      files.update(
        file.copy(
          localState = FileState.BACKED_UP,
          remoteVersionId = remoteVersionId,
          remoteSha256 = sha256,
          lastCommittedSize = committedSize,
          lastCommittedModifiedMs = committedModifiedMs,
          missingConfirmationCount = 0,
          updatedAt = now,
        ),
      )
    }
    jobs.delete(job.id)
    roots.markSynced(job.rootId, now)
  })

  // A failed attempt: retry transient failures with backoff until attempts are exhausted, then
  // park the job failed and mark the file errored so the UI can surface it (spec 5.4). A
  // non-retryable failure (auth, expired reservation, quota) parks immediately.
  fun failJob(
    job: TransferJobEntity,
    errorCode: String,
    errorMessage: String?,
    now: Long,
    retryable: Boolean,
  ) = db.runInTransaction(Runnable {
    val attempts = job.attemptCount + 1
    if (retryable && attempts < MAX_UPLOAD_ATTEMPTS) {
      jobs.update(
        job.copy(
          state = JobState.PENDING,
          attemptCount = attempts,
          nextAttemptAt = now + backoffMs(attempts),
          lastErrorCode = errorCode,
          lastErrorMessage = errorMessage,
          updatedAt = now,
        ),
      )
      files.updateState(job.fileEntryId, FileState.PENDING_UPLOAD, now)
    } else {
      jobs.update(
        job.copy(
          state = JobState.FAILED,
          attemptCount = attempts,
          lastErrorCode = errorCode,
          lastErrorMessage = errorMessage,
          updatedAt = now,
        ),
      )
      files.updateState(job.fileEntryId, FileState.ERROR, now)
    }
  })

  fun listActiveTransfers(): List<TransferJobEntity> = jobs.listActive()

  fun listRecentTransfers(limit: Int): List<TransferJobEntity> = jobs.listRecent(limit)

  // 1s, 2s, 4s … capped at 30s — a queue-level backoff distinct from the tus in-request retry.
  private fun backoffMs(attempt: Int): Long {
    val shifted = 1_000L shl (attempt - 1).coerceAtMost(5)
    return if (shifted > 30_000L) 30_000L else shifted
  }

  // --- events ---

  fun logEvent(
    severity: String,
    eventType: String,
    now: Long,
    rootId: String? = null,
    fileEntryId: String? = null,
    message: String,
    redactedDetailsJson: String? = null,
  ) = events.insert(
    SyncEventEntity(
      severity = severity,
      eventType = eventType,
      rootId = rootId,
      fileEntryId = fileEntryId,
      message = message,
      redactedDetailsJson = redactedDetailsJson,
      createdAt = now,
    ),
  )

  fun recentEvents(limit: Int): List<SyncEventEntity> = events.recent(limit)
}
