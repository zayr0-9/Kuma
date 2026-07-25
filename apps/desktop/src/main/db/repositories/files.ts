import { randomUUID } from 'node:crypto';
import type { PrepareState } from '@foldersync/contracts';
import type { Database } from '../database.ts';
import { asInt, asIntOrNull, asRow, asText, asTextOrNull } from '../row.ts';
import type {
  DeletionAppliedAction,
  DeletionEventRow,
  RemoteFileRow,
  RemoteFileState,
  RemoteVersionRow,
  UploadPrepareRow,
} from '../types.ts';

// The file-sync trio (spec 21.1): upload_prepare (in-flight reservations),
// remote_file (the committed truth per path) and remote_version (immutable
// history). Covers the prepare lifecycle (create/read/reuse/state), the tus
// upload transition (markUploading), and the commit-time upsert-and-supersede
// (recordCommittedVersion).

// A prepare in a terminal state can neither be resumed nor reused for an
// idempotent retry (spec 25.2), and a status read never flips it to 'expired'.
const TERMINAL_PREPARE_STATES: ReadonlySet<PrepareState> = new Set([
  'committed',
  'failed',
  'expired',
]);

export function isTerminalPrepareState(state: PrepareState): boolean {
  return TERMINAL_PREPARE_STATES.has(state);
}

function mapPrepare(raw: unknown): UploadPrepareRow | null {
  const r = asRow(raw);
  if (r === null) return null;
  return {
    prepareId: asText(r.prepare_id),
    phoneDeviceId: asText(r.phone_device_id),
    rootId: asText(r.root_id),
    fileEntryId: asText(r.file_entry_id),
    relativePath: asText(r.relative_path),
    expectedSize: asInt(r.expected_size),
    state: asText(r.state) as PrepareState,
    tusUploadId: asTextOrNull(r.tus_upload_id),
    tusLocation: asTextOrNull(r.tus_location),
    errorCode: asTextOrNull(r.error_code),
    createdAt: asText(r.created_at),
    expiresAt: asText(r.expires_at),
  };
}

function mapRemoteFile(raw: unknown): RemoteFileRow | null {
  const r = asRow(raw);
  if (r === null) return null;
  return {
    id: asText(r.id),
    phoneDeviceId: asText(r.phone_device_id),
    rootId: asText(r.root_id),
    fileEntryId: asText(r.file_entry_id),
    relativePath: asText(r.relative_path),
    currentVersionId: asTextOrNull(r.current_version_id),
    sha256: asTextOrNull(r.sha256),
    size: asIntOrNull(r.size),
    destinationMtimeMs: asIntOrNull(r.destination_mtime_ms),
    destinationIdentity: asTextOrNull(r.destination_identity),
    committedAt: asTextOrNull(r.committed_at),
    state: asText(r.state) as RemoteFileState,
  };
}

function mapRemoteVersion(raw: unknown): RemoteVersionRow | null {
  const r = asRow(raw);
  if (r === null) return null;
  return {
    versionId: asText(r.version_id),
    remoteFileId: asText(r.remote_file_id),
    sha256: asText(r.sha256),
    size: asInt(r.size),
    originalRelativePath: asText(r.original_relative_path),
    committedAt: asText(r.committed_at),
    supersededAt: asTextOrNull(r.superseded_at),
  };
}

function mapDeletionEvent(raw: unknown): DeletionEventRow | null {
  const r = asRow(raw);
  if (r === null) return null;
  return {
    eventId: asText(r.event_id),
    remoteFileId: asTextOrNull(r.remote_file_id),
    expectedVersionId: asTextOrNull(r.expected_version_id),
    relativePath: asText(r.relative_path),
    appliedAction: asText(r.applied_action) as DeletionAppliedAction,
    trashPath: asTextOrNull(r.trash_path),
    appliedAt: asText(r.applied_at),
  };
}

export interface CreatePrepareInput {
  prepareId: string;
  phoneDeviceId: string;
  rootId: string;
  fileEntryId: string;
  relativePath: string;
  expectedSize: number;
  createdAt: string;
  expiresAt: string;
}

// An applied remote deletion (spec 21.1, 25.2), keyed by the client event id for
// idempotency. `appliedAction` is the real outcome; when it is 'trashed' the owning
// remote_file transitions to the 'trashed' state in the same transaction so the
// committed truth and the deletion history can never disagree.
export interface RecordDeletionInput {
  eventId: string;
  remoteFileId: string | null;
  expectedVersionId: string | null;
  relativePath: string;
  appliedAction: DeletionAppliedAction;
  trashPath: string | null;
  appliedAt: string;
}

// The durable record of a committed upload (spec 6.5, 21.1): a new immutable
// remote_version becomes the current version of its remote_file, and any prior
// version is stamped superseded — all in one transaction so a reader never sees two
// current versions or a remote_file pointing at a half-written version.
export interface RecordCommittedVersionInput {
  phoneDeviceId: string;
  rootId: string;
  fileEntryId: string;
  relativePath: string;
  sha256: string;
  size: number;
  committedAt: string;
  destinationMtimeMs?: number | null;
}

export interface FilesRepository {
  // Committed truth for one path (spec 21.1). Keyed by the normalised relative path
  // (the canonical form from resolveDestinationPath), which is how it is stored.
  getRemoteFile(phoneDeviceId: string, rootId: string, relativePath: string): RemoteFileRow | null;
  getRemoteVersion(versionId: string): RemoteVersionRow | null;
  createPrepare(input: CreatePrepareInput): void;
  getPrepare(prepareId: string): UploadPrepareRow | null;
  // The reusable prepare for an idempotent retry (spec 25.2): the newest
  // non-terminal reservation for this path that has not passed its expiry. `now`
  // is an ISO-8601 UTC string; timestamps share one format so they compare
  // lexicographically.
  findReusablePrepare(
    phoneDeviceId: string,
    rootId: string,
    relativePath: string,
    now: string,
  ): UploadPrepareRow | null;
  setPrepareState(prepareId: string, state: PrepareState, errorCode?: string | null): void;
  // Prepares still eligible to hold staged bytes (spec 22.3): non-terminal and not
  // past expiry. Startup staging GC keeps the files these name and deletes the rest.
  // `now` is an ISO-8601 UTC string (lexicographic comparison).
  listActivePrepares(now: string): { prepareId: string; phoneDeviceId: string; rootId: string }[];
  // Records that the tus transfer for a prepare has started (state -> uploading)
  // and links the staged bytes: tus_upload_id is the prepare id (the file name in
  // staging), so staging GC reconciles against this table (spec 22.3).
  markUploading(prepareId: string, tusUploadId: string, tusLocation: string): void;
  // The production commit writer (spec 6.5/18.5): upserts the remote_file, supersedes
  // the previous version, and inserts the new immutable version — atomically. Returns
  // the generated ids.
  recordCommittedVersion(input: RecordCommittedVersionInput): {
    versionId: string;
    remoteFileId: string;
  };
  // Idempotency lookup for POST /v1/files/delete (spec 25.2): a replayed event id
  // returns its recorded outcome rather than acting twice.
  getDeletionEvent(eventId: string): DeletionEventRow | null;
  // Records an applied remote deletion; when the action is 'trashed' the owning
  // remote_file is flipped to 'trashed' in the same transaction (spec 6.4).
  recordDeletion(input: RecordDeletionInput): void;
  // Uploads that finished transferring but are not yet committed (spec 25.2 sync
  // status): the commit backlog surfaced by GET /v1/sync/status.
  countPendingCommits(): number;
}

export function createFilesRepository(db: Database): FilesRepository {
  const remoteFileStmt = db.prepare(
    'SELECT * FROM remote_file WHERE phone_device_id = ? AND root_id = ? AND relative_path = ?',
  );
  const remoteVersionStmt = db.prepare('SELECT * FROM remote_version WHERE version_id = ?');
  const createPrepareStmt = db.prepare(`
    INSERT INTO upload_prepare
      (prepare_id, phone_device_id, root_id, file_entry_id, relative_path,
       expected_size, state, tus_upload_id, tus_location, error_code,
       created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, 'prepared', NULL, NULL, NULL, ?, ?)
  `);
  const getPrepareStmt = db.prepare('SELECT * FROM upload_prepare WHERE prepare_id = ?');
  const reusablePrepareStmt = db.prepare(`
    SELECT * FROM upload_prepare
    WHERE phone_device_id = ? AND root_id = ? AND relative_path = ?
      AND state NOT IN ('committed', 'failed', 'expired')
      AND expires_at > ?
    ORDER BY created_at DESC
    LIMIT 1
  `);
  const setPrepareStateStmt = db.prepare(
    'UPDATE upload_prepare SET state = ?, error_code = ? WHERE prepare_id = ?',
  );
  const activePreparesStmt = db.prepare(`
    SELECT prepare_id, phone_device_id, root_id FROM upload_prepare
    WHERE state NOT IN ('committed', 'failed', 'expired') AND expires_at > ?
  `);
  const markUploadingStmt = db.prepare(
    "UPDATE upload_prepare SET state = 'uploading', tus_upload_id = ?, tus_location = ? WHERE prepare_id = ?",
  );
  const insertRemoteFileStmt = db.prepare(`
    INSERT INTO remote_file
      (id, phone_device_id, root_id, file_entry_id, relative_path, current_version_id,
       sha256, size, destination_mtime_ms, destination_identity, committed_at, state)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'committed')
  `);
  const updateRemoteFileStmt = db.prepare(`
    UPDATE remote_file SET
      current_version_id = ?, sha256 = ?, size = ?, destination_mtime_ms = ?,
      committed_at = ?, state = 'committed'
    WHERE id = ?
  `);
  const supersedeVersionStmt = db.prepare(
    'UPDATE remote_version SET superseded_at = ? WHERE version_id = ? AND superseded_at IS NULL',
  );
  const insertRemoteVersionStmt = db.prepare(`
    INSERT INTO remote_version
      (version_id, remote_file_id, sha256, size, original_relative_path, committed_at, superseded_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL)
  `);
  const getDeletionEventStmt = db.prepare('SELECT * FROM deletion_event WHERE event_id = ?');
  const insertDeletionEventStmt = db.prepare(`
    INSERT INTO deletion_event
      (event_id, remote_file_id, expected_version_id, relative_path,
       applied_action, trash_path, applied_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const trashRemoteFileStmt = db.prepare("UPDATE remote_file SET state = 'trashed' WHERE id = ?");
  const countPendingCommitsStmt = db.prepare(
    "SELECT COUNT(*) AS n FROM upload_prepare WHERE state IN ('uploaded', 'verifying', 'committing')",
  );

  return {
    getRemoteFile: (phoneDeviceId, rootId, relativePath) =>
      mapRemoteFile(remoteFileStmt.get(phoneDeviceId, rootId, relativePath)),
    getRemoteVersion: (versionId) => mapRemoteVersion(remoteVersionStmt.get(versionId)),
    createPrepare: (input) => {
      createPrepareStmt.run(
        input.prepareId,
        input.phoneDeviceId,
        input.rootId,
        input.fileEntryId,
        input.relativePath,
        input.expectedSize,
        input.createdAt,
        input.expiresAt,
      );
    },
    getPrepare: (prepareId) => mapPrepare(getPrepareStmt.get(prepareId)),
    findReusablePrepare: (phoneDeviceId, rootId, relativePath, now) =>
      mapPrepare(reusablePrepareStmt.get(phoneDeviceId, rootId, relativePath, now)),
    setPrepareState: (prepareId, state, errorCode = null) => {
      setPrepareStateStmt.run(state, errorCode, prepareId);
    },
    listActivePrepares: (now) =>
      activePreparesStmt.all(now).map((raw) => {
        const r = raw as Record<string, unknown>;
        return {
          prepareId: asText(r.prepare_id),
          phoneDeviceId: asText(r.phone_device_id),
          rootId: asText(r.root_id),
        };
      }),
    markUploading: (prepareId, tusUploadId, tusLocation) => {
      markUploadingStmt.run(tusUploadId, tusLocation, prepareId);
    },
    recordCommittedVersion: (input) => {
      const existing = mapRemoteFile(
        remoteFileStmt.get(input.phoneDeviceId, input.rootId, input.relativePath),
      );
      const versionId = randomUUID();
      const remoteFileId = existing?.id ?? randomUUID();
      const destinationMtimeMs = input.destinationMtimeMs ?? null;

      db.exec('BEGIN');
      try {
        if (existing !== null) {
          if (existing.currentVersionId !== null) {
            supersedeVersionStmt.run(input.committedAt, existing.currentVersionId);
          }
          updateRemoteFileStmt.run(
            versionId,
            input.sha256,
            input.size,
            destinationMtimeMs,
            input.committedAt,
            remoteFileId,
          );
        } else {
          insertRemoteFileStmt.run(
            remoteFileId,
            input.phoneDeviceId,
            input.rootId,
            input.fileEntryId,
            input.relativePath,
            versionId,
            input.sha256,
            input.size,
            destinationMtimeMs,
            null,
            input.committedAt,
          );
        }
        insertRemoteVersionStmt.run(
          versionId,
          remoteFileId,
          input.sha256,
          input.size,
          input.relativePath,
          input.committedAt,
        );
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }

      return { versionId, remoteFileId };
    },
    getDeletionEvent: (eventId) => mapDeletionEvent(getDeletionEventStmt.get(eventId)),
    recordDeletion: (input) => {
      db.exec('BEGIN');
      try {
        if (input.appliedAction === 'trashed' && input.remoteFileId !== null) {
          trashRemoteFileStmt.run(input.remoteFileId);
        }
        insertDeletionEventStmt.run(
          input.eventId,
          input.remoteFileId,
          input.expectedVersionId,
          input.relativePath,
          input.appliedAction,
          input.trashPath,
          input.appliedAt,
        );
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    countPendingCommits: () => asInt(asRow(countPendingCommitsStmt.get())?.n),
  };
}
