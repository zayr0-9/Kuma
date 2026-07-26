package expo.modules.foldersync.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update

// Blocking DAOs — every caller is already on a worker thread (the service loop, the upload
// worker, or an Expo AsyncFunction's background dispatcher), so a suspend/Flow surface would
// buy nothing. Room forbids main-thread access, which is the guard that keeps it that way.

@Dao
interface SyncRootDao {
  // REPLACE so re-binding a root (same id) is an idempotent update, mirroring the desktop's
  // register-is-update semantics (spec 25.2).
  @Insert(onConflict = OnConflictStrategy.REPLACE)
  fun upsert(root: SyncRootEntity)

  @Query("SELECT * FROM sync_root WHERE id = :id")
  fun getById(id: String): SyncRootEntity?

  @Query("SELECT * FROM sync_root ORDER BY createdAt ASC")
  fun getAll(): List<SyncRootEntity>

  @Query("SELECT * FROM sync_root WHERE enabled = 1 ORDER BY createdAt ASC")
  fun getEnabled(): List<SyncRootEntity>

  @Query(
    "UPDATE sync_root SET status = :status, updatedAt = :updatedAt, " +
      "lastErrorCode = :errorCode, lastErrorMessage = :errorMessage WHERE id = :id",
  )
  fun updateStatus(id: String, status: String, errorCode: String?, errorMessage: String?, updatedAt: Long)

  @Query(
    "UPDATE sync_root SET lastCompleteScanAt = :scanAt, status = :status, " +
      "lastErrorCode = NULL, lastErrorMessage = NULL, updatedAt = :scanAt WHERE id = :id",
  )
  fun markScanned(id: String, scanAt: Long, status: String)

  @Query("UPDATE sync_root SET lastSuccessfulSyncAt = :syncAt, updatedAt = :syncAt WHERE id = :id")
  fun markSynced(id: String, syncAt: Long)

  @Query("UPDATE sync_root SET enabled = :enabled, updatedAt = :updatedAt WHERE id = :id")
  fun setEnabled(id: String, enabled: Boolean, updatedAt: Long)

  @Query("DELETE FROM sync_root WHERE id = :id")
  fun delete(id: String)
}

@Dao
interface ScanRunDao {
  @Insert
  fun insert(run: ScanRunEntity)

  @Update
  fun update(run: ScanRunEntity)

  @Query("SELECT MAX(generation) FROM scan_run WHERE rootId = :rootId")
  fun maxGeneration(rootId: String): Int?

  @Query("SELECT * FROM scan_run WHERE rootId = :rootId AND status = 'completed' ORDER BY generation DESC LIMIT 1")
  fun latestCompleted(rootId: String): ScanRunEntity?

  @Query("DELETE FROM scan_run WHERE rootId = :rootId")
  fun deleteByRoot(rootId: String)
}

@Dao
interface FileEntryDao {
  @Insert
  fun insert(entry: FileEntryEntity)

  @Update
  fun update(entry: FileEntryEntity)

  @Query("SELECT * FROM file_entry WHERE rootId = :rootId AND relativePath = :relativePath LIMIT 1")
  fun getByRootAndPath(rootId: String, relativePath: String): FileEntryEntity?

  @Query("SELECT * FROM file_entry WHERE id = :id")
  fun getById(id: String): FileEntryEntity?

  @Query("SELECT * FROM file_entry WHERE rootId = :rootId ORDER BY relativePath ASC")
  fun listByRoot(rootId: String): List<FileEntryEntity>

  // Entries present in the store but not stamped by the just-completed generation — candidates
  // for the missing-file two-observation rule (spec 17.5). Rows already resolved as gone are
  // excluded: 'deleted' (user removal) and 'cleaned' (retention cleanup removed it by design).
  @Query(
    "SELECT * FROM file_entry WHERE rootId = :rootId AND lastSeenGeneration < :generation " +
      "AND localState NOT IN ('deleted', 'cleaned')",
  )
  fun listMissing(rootId: String, generation: Int): List<FileEntryEntity>

  // Files durably backed up on a delete-eligible root, awaiting phone-side verification + deletion
  // (spec 19). Only rows carrying a committed desktop version AND its SHA-256 are eligible — a
  // file with no hash to verify against is never deleted (spec 19.2). 'cleanup_failed' rows are
  // excluded: they retry only on an explicit user action (resetFailedCleanups), not every pass.
  @Query(
    "SELECT * FROM file_entry WHERE rootId = :rootId AND localState = 'backed_up' " +
      "AND remoteVersionId IS NOT NULL AND remoteSha256 IS NOT NULL ORDER BY updatedAt ASC LIMIT :limit",
  )
  fun listCleanable(rootId: String, limit: Int): List<FileEntryEntity>

  // Record the intent to delete before deleting (spec 19.1), so a crash between the two retries
  // cleanup rather than losing track of it.
  @Query("UPDATE file_entry SET retentionCleanupExpected = :expected, updatedAt = :now WHERE id = :id")
  fun setCleanupExpected(id: String, expected: Boolean, now: Long)

  @Query("SELECT COUNT(*) FROM file_entry WHERE rootId = :rootId AND localState = 'cleaned'")
  fun countCleaned(rootId: String): Int

  @Query("SELECT COUNT(*) FROM file_entry WHERE rootId = :rootId AND localState = 'cleanup_failed'")
  fun countCleanupFailed(rootId: String): Int

  // Re-arm every failed cleanup on a root so the next sync pass re-verifies and retries the
  // deletion (spec 19.3 "permit retry"). The committed version is untouched — never re-uploaded.
  @Query("UPDATE file_entry SET localState = 'backed_up', updatedAt = :now WHERE rootId = :rootId AND localState = 'cleanup_failed'")
  fun resetFailedCleanups(rootId: String, now: Long)

  @Query("SELECT COUNT(*) FROM file_entry WHERE rootId = :rootId AND localState IN ('discovered', 'pending_upload', 'uploading')")
  fun countPending(rootId: String): Int

  @Query("SELECT COALESCE(SUM(sizeBytes), 0) FROM file_entry WHERE rootId = :rootId AND localState IN ('discovered', 'pending_upload', 'uploading')")
  fun pendingBytes(rootId: String): Long

  @Query("SELECT COUNT(*) FROM file_entry WHERE rootId = :rootId AND localState = 'backed_up'")
  fun countBackedUp(rootId: String): Int

  @Query("UPDATE file_entry SET localState = :state, updatedAt = :now WHERE id = :id")
  fun updateState(id: String, state: String, now: Long)

  @Query("DELETE FROM file_entry WHERE rootId = :rootId")
  fun deleteByRoot(rootId: String)
}

@Dao
interface TransferJobDao {
  @Insert(onConflict = OnConflictStrategy.REPLACE)
  fun upsert(job: TransferJobEntity)

  @Update
  fun update(job: TransferJobEntity)

  @Query("SELECT * FROM transfer_job WHERE id = :id")
  fun getById(id: String): TransferJobEntity?

  @Query("SELECT * FROM transfer_job WHERE fileEntryId = :fileEntryId LIMIT 1")
  fun getByFileEntry(fileEntryId: String): TransferJobEntity?

  // The next job the drainer may pick: pending, its backoff elapsed, oldest first. 'uploading'
  // rows are in flight (or were interrupted — recovered on the next claim after reset).
  @Query(
    "SELECT * FROM transfer_job WHERE state = 'pending' AND nextAttemptAt <= :now " +
      "ORDER BY createdAt ASC LIMIT 1",
  )
  fun nextClaimable(now: Long): TransferJobEntity?

  // A drainer that died mid-upload leaves a stranded 'uploading' row; reset stale ones to
  // pending so the next drain retries (tus resumes from the server offset).
  @Query("UPDATE transfer_job SET state = 'pending', updatedAt = :now WHERE state = 'uploading'")
  fun requeueStranded(now: Long)

  @Query("UPDATE transfer_job SET bytesUploaded = :bytes, tusUploadUrl = :tusUrl, updatedAt = :now WHERE id = :id")
  fun updateProgress(id: String, bytes: Long, tusUrl: String?, now: Long)

  @Query("SELECT * FROM transfer_job WHERE state IN ('pending', 'uploading') ORDER BY createdAt ASC")
  fun listActive(): List<TransferJobEntity>

  @Query("SELECT * FROM transfer_job ORDER BY updatedAt DESC LIMIT :limit")
  fun listRecent(limit: Int): List<TransferJobEntity>

  @Query("SELECT COUNT(*) FROM transfer_job WHERE state = 'pending' AND nextAttemptAt <= :now")
  fun countClaimable(now: Long): Int

  @Query("DELETE FROM transfer_job WHERE id = :id")
  fun delete(id: String)

  @Query("DELETE FROM transfer_job WHERE rootId = :rootId")
  fun deleteByRoot(rootId: String)
}

@Dao
interface SyncEventDao {
  @Insert
  fun insert(event: SyncEventEntity)

  @Query("SELECT * FROM sync_event ORDER BY id DESC LIMIT :limit")
  fun recent(limit: Int): List<SyncEventEntity>
}
