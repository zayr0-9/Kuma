import type {
  DesktopDeletionPolicy,
  PhoneRetentionPolicy,
  PrepareState,
} from '@foldersync/contracts';

// TypeScript shapes for the rows defined in schema.ts. Columns are re-keyed to
// camelCase here; enum-valued columns use the shared contract unions so the DB
// layer and the wire protocol cannot drift. Nullable columns are `| null`,
// mirroring the DDL exactly.

export interface DesktopIdentityRow {
  deviceId: string;
  displayName: string;
  certificateRef: string;
  publicKeyPin: string;
  createdAt: string;
  rotatedAt: string | null;
}

export interface PairedDeviceRow {
  phoneDeviceId: string;
  phoneDisplayName: string;
  tokenHash: string;
  pairedAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
}

export interface RootMappingRow {
  mappingId: string;
  phoneDeviceId: string;
  phoneRootId: string | null;
  destinationRoot: string;
  destinationRelativeBase: string;
  phoneRetentionPolicy: PhoneRetentionPolicy | null;
  desktopDeletionPolicy: DesktopDeletionPolicy | null;
  displayName: string;
  createdAt: string;
  updatedAt: string;
}

// Remote-file state carries the section 26.1 lifecycle marker. Kept as a string
// union local to the DB layer until the full state machine lands with the sync
// engine; the contract enum for it does not exist yet.
export type RemoteFileState =
  'committed' | 'superseded' | 'trashed' | 'missing_unconfirmed' | 'delete_pending' | 'conflict';

export interface RemoteFileRow {
  id: string;
  phoneDeviceId: string;
  rootId: string;
  fileEntryId: string;
  relativePath: string;
  currentVersionId: string | null;
  sha256: string | null;
  size: number | null;
  destinationMtimeMs: number | null;
  destinationIdentity: string | null;
  committedAt: string | null;
  state: RemoteFileState;
}

export interface UploadPrepareRow {
  prepareId: string;
  phoneDeviceId: string;
  rootId: string;
  fileEntryId: string;
  relativePath: string;
  expectedSize: number;
  state: PrepareState;
  tusUploadId: string | null;
  tusLocation: string | null;
  errorCode: string | null;
  createdAt: string;
  expiresAt: string;
}

export interface RemoteVersionRow {
  versionId: string;
  remoteFileId: string;
  sha256: string;
  size: number;
  originalRelativePath: string;
  committedAt: string;
  supersededAt: string | null;
}

// What actually happened to the desktop copy, as stored in deletion_event
// (spec 6.4). `already_applied` is never stored — it is the wire response for an
// idempotent replay, resolved from the recorded action at read time.
export type DeletionAppliedAction = 'trashed' | 'preserved' | 'no_remote_file';

export interface DeletionEventRow {
  eventId: string;
  remoteFileId: string | null;
  expectedVersionId: string | null;
  relativePath: string;
  appliedAction: DeletionAppliedAction;
  trashPath: string | null;
  appliedAt: string;
}

export type EventLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface EventLogRow {
  id: number;
  at: string;
  level: EventLogLevel;
  category: string;
  message: string;
  details: string | null;
}
