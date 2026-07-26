package expo.modules.foldersync.db

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

// Room is the mobile source of truth (spec 16.1). These entities are the durable state the
// scan and upload engines transition transactionally (spec 16.2); the service and JS read
// snapshots of them but never own the state. Time columns are epoch milliseconds (Long) so
// the engine's wall-clock rules — the 15-minute missing-file gap (spec 17.5), scan-due
// intervals — are plain arithmetic; the wire protocol converts to ISO at the boundary.
//
// Deferred from spec 16.1 for this slice: `deletion_event` (deletion propagation is spec 19,
// not yet driven) and `paired_device` (pairing already persists durably via TokenVault +
// PairingManager from spike 4; migrating it into Room would churn proven code for no gain).

// A phone folder bound to a desktop destination (spec 16.1 sync_root). Persisting this is what
// lets a bound destination be reused across app restarts instead of re-picking every time.
@Entity(tableName = "sync_root")
data class SyncRootEntity(
  @PrimaryKey val id: String,
  val treeUri: String,
  val displayName: String,
  val providerAuthority: String?,
  // The paired desktop and the mapping this root binds to. The desktop's absolute destination
  // path is never stored — only the mappingId and the destination's friendly name (spec 30).
  val desktopDeviceId: String,
  val desktopMappingId: String,
  val desktopDestinationName: String,
  val phoneRetentionPolicy: String,
  val desktopDeletionPolicy: String,
  val enabled: Boolean,
  val status: String,
  val createdAt: Long,
  val updatedAt: Long,
  val lastCompleteScanAt: Long?,
  val lastSuccessfulSyncAt: Long?,
  val lastErrorCode: String?,
  val lastErrorMessage: String?,
)

// One traversal pass over a root (spec 16.1 scan_run, 17.2). The monotonically increasing
// generation is how missing-file detection works: an entry not stamped with the latest
// completed generation was not seen this pass.
@Entity(
  tableName = "scan_run",
  indices = [Index("rootId")],
)
data class ScanRunEntity(
  @PrimaryKey val id: String,
  val rootId: String,
  val generation: Int,
  val startedAt: Long,
  val completedAt: Long?,
  val status: String,
  val filesSeen: Int,
  val bytesSeen: Long,
  val errorCode: String?,
)

// One file observed under a root (spec 16.1 file_entry). Unique per (rootId, relativePath)
// after NFC normalisation (done in the scan engine before upsert). Carries both the last-seen
// candidate metadata and the last committed desktop version, so change detection (spec 17.3)
// compares cheaply without hashing.
@Entity(
  tableName = "file_entry",
  indices = [
    Index(value = ["rootId", "relativePath"], unique = true),
    Index("rootId"),
    Index("localState"),
  ],
)
data class FileEntryEntity(
  @PrimaryKey val id: String,
  val rootId: String,
  val documentUri: String,
  val documentId: String?,
  val relativePath: String,
  val displayName: String,
  val mimeType: String?,
  val sizeBytes: Long,
  val lastModifiedMs: Long?,
  val lastSeenGeneration: Int,
  val localState: String,
  val remoteVersionId: String?,
  val remoteSha256: String?,
  val lastCommittedSize: Long?,
  val lastCommittedModifiedMs: Long?,
  val missingConfirmationCount: Int,
  val retentionCleanupExpected: Boolean,
  val createdAt: Long,
  val updatedAt: Long,
)

// A queued transfer (spec 16.1 transfer_job). One row per file that needs uploading; the
// upload engine drains these one at a time (spec 18.3). tusUploadUrl/bytesUploaded mirror the
// resumable tus state for observability — the authoritative resume URL lives in the
// fingerprint-keyed TusURLStore (spec 18.1). Unique per fileEntryId so a rescan re-queuing a
// still-pending file does not create a duplicate job.
@Entity(
  tableName = "transfer_job",
  indices = [
    Index(value = ["fileEntryId"], unique = true),
    Index("state"),
    Index("rootId"),
  ],
)
data class TransferJobEntity(
  @PrimaryKey val id: String,
  val rootId: String,
  val fileEntryId: String,
  val operation: String,
  val state: String,
  val attemptCount: Int,
  val nextAttemptAt: Long,
  val tusUploadUrl: String?,
  val bytesUploaded: Long,
  val expectedSize: Long,
  val desktopPrepareId: String?,
  val lastErrorCode: String?,
  val lastErrorMessage: String?,
  val createdAt: Long,
  val updatedAt: Long,
)

// User-readable operational events (spec 16.1 sync_event, surfaced as History in spec 5.5).
// Never raw logs and never secrets (spec 30): redactedDetailsJson holds only non-sensitive
// structured context.
@Entity(
  tableName = "sync_event",
  indices = [Index("rootId")],
)
data class SyncEventEntity(
  @PrimaryKey(autoGenerate = true) val id: Long = 0,
  val severity: String,
  val eventType: String,
  val rootId: String?,
  val fileEntryId: String?,
  val message: String,
  val redactedDetailsJson: String?,
  val createdAt: Long,
)
