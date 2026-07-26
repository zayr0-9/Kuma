import { requireOptionalNativeModule } from 'expo';

// TypeScript surface of the Kotlin module (spec 13.2). This interface grows in
// lockstep with FolderSyncModule.kt; React Native asks for actions and observes
// state — it never runs the sync loop. These SAF types are the native-module
// boundary, not wire contracts, so they live here rather than in
// `@foldersync/contracts` (spec 10: SAF scanning is not force-shared).

/** Result of the system directory picker (spec 12.1). */
export type PickedDirectory =
  | { cancelled: true }
  | {
      cancelled: false;
      treeUri: string;
      displayName: string;
      providerAuthority: string | null;
      canRead: boolean;
      canWrite: boolean;
    };

/** A persisted URI grant the OS still honours for this app (spec 12.1, 12.3). */
export interface PersistedPermission {
  uri: string;
  readable: boolean;
  writable: boolean;
  persistedTimeMs: number;
}

/** Root accessibility re-test (spec 12.3): a persisted grant is not permanent truth. */
export interface AccessCheck {
  accessible: boolean;
}

/** One file surfaced in a traversal sample (never the whole tree — spec 17). */
export interface TraversedFile {
  documentId: string;
  documentUri: string;
  relativePath: string;
  displayName: string;
  mimeType: string | null;
  sizeBytes: number;
  lastModifiedMs: number | null;
}

/** Aggregate result of a recursive SAF traversal (spec 35 spike 1, spec 17.2). */
export interface TraversalResult {
  rootUri: string;
  fileCount: number;
  dirCount: number;
  totalBytes: number;
  elapsedMs: number;
  unreadableDirs: number;
  skippedEntries: number;
  sample: TraversedFile[];
  sampleTruncated: boolean;
}

/** Outcome of a controlled single-document deletion (spec 35 spike 1). */
export interface DeleteResult {
  deleted: boolean;
}

/** Foreground-service lifecycle state persisted durably by the service (spec 14.5). */
export type ServiceState = 'running' | 'paused' | 'stopped';

/** Service status read from the durable cell — correct even if the JS runtime was dead. */
export interface ServiceStatus {
  state: ServiceState;
  ticks: number;
  updatedAtMs: number;
}

/** A desktop discovered over DNS-SD (spec 23). host/port populated once resolved. */
export interface DiscoveredDesktop {
  serviceName: string;
  host: string | null;
  port: number;
  deviceId: string | null;
  displayName: string | null;
  protocolVersion: number | null;
  tls: boolean;
}

/** Outcome of pairing from a scanned/pasted QR payload (spec 24). */
export type PairingResult =
  | { ok: true; deviceId: string; displayName: string }
  | {
      ok: false;
      reason:
        | 'wrong_scheme'
        | 'invalid_fields'
        | 'pin_mismatch'
        | 'network'
        | 'rejected'
        | 'protocol_mismatch';
    };

/** A paired desktop (non-secret metadata; the token stays Keystore-encrypted, native-only). */
export interface PairedDevice {
  deviceId: string;
  displayName: string;
  host: string;
  port: number;
  pairedAt: string;
}

/** The two independent per-root policies (spec 6.1); string-mirrored from @foldersync/contracts. */
export type PhoneRetentionPolicy = 'keep_on_phone' | 'delete_after_verified_backup';
export type DesktopDeletionPolicy = 'preserve_desktop_copy' | 'mirror_user_deletions';

/** A desktop-approved destination this phone may bind (GET /v1/roots/available, spec 5.1). */
export interface AvailableDestination {
  mappingId: string;
  displayName: string;
  destinationAvailable: boolean;
  freeBytes: number | null;
}

/** Outcome of listing bindable destinations. `reason` carries the structured error code. */
export type ListDestinationsResult =
  { ok: true; destinations: AvailableDestination[] } | { ok: false; reason: string };

/** Outcome of binding a phone root to a destination (POST /v1/roots/register). */
export type RegisterRootResult =
  { ok: true; rootId: string; mappingId: string } | { ok: false; reason: string };

/** Acknowledgement that a background upload started (or why it could not). */
export type StartUploadResult =
  { started: true; fileEntryId: string } | { started: false; reason: string };

/**
 * Pull-model snapshot of the single active upload (spec 18.3). `state` walks
 * preparing → uploading → verifying → committed, or skipped (desktop already had it) /
 * failed (see `reason`). Bytes are numbers so RN can render a progress bar.
 */
export interface UploadStatus {
  state: 'idle' | 'preparing' | 'uploading' | 'verifying' | 'committed' | 'skipped' | 'failed';
  bytesUploaded: number;
  expectedSize: number;
  prepareId: string | null;
  remoteVersionId: string | null;
  fileName: string | null;
  reason: string | null;
}

export interface FolderSyncNativeModule {
  ping(): string;

  // Spike 1 — SAF persistence and traversal (spec 35).
  pickDirectory(): Promise<PickedDirectory>;
  listPersistedPermissions(): Promise<PersistedPermission[]>;
  checkAccess(treeUri: string): Promise<AccessCheck>;
  traverseTree(treeUri: string, sampleLimit: number): Promise<TraversalResult>;
  deleteDocument(documentUri: string): Promise<DeleteResult>;
  releasePermission(treeUri: string): Promise<void>;

  // Spike 2 — native foreground service (spec 35, 13.2, 14). startSyncService doubles as
  // resume; getServiceStatus reads the durable persisted state, not a live handle.
  startSyncService(): Promise<void>;
  pauseSyncService(): Promise<void>;
  stopSyncService(): Promise<void>;
  getServiceStatus(): Promise<ServiceStatus>;

  // Spike 3 — DNS-SD discovery (spec 35, 23). Pull model: poll getDiscoveredDesktops.
  startDiscovery(): Promise<void>;
  stopDiscovery(): Promise<void>;
  getDiscoveredDesktops(): Promise<DiscoveredDesktop[]>;

  // Spike 4 — pinned-TLS pairing (spec 35, 24). QR parsed + verified natively.
  startPairingFromQr(payload: string): Promise<PairingResult>;
  listPairedDevices(): Promise<PairedDevice[]>;
  removePairedDevice(deviceId: string): Promise<void>;

  // Roots binding + spike 5 upload (spec 35, 25.2, 18). Authenticated control calls to the
  // paired desktop and a resumable tus upload; the bearer token never crosses to JS.
  listAvailableDestinations(): Promise<ListDestinationsResult>;
  registerRoot(
    mappingId: string,
    displayName: string,
    retention: PhoneRetentionPolicy,
    deletion: DesktopDeletionPolicy,
  ): Promise<RegisterRootResult>;
  startUpload(
    rootId: string,
    documentUri: string,
    relativePath: string,
    sizeBytes: number,
    mimeType: string | null,
    modifiedAtMs: number | null,
  ): Promise<StartUploadResult>;
  getUploadStatus(): Promise<UploadStatus>;
  cancelUpload(): Promise<void>;
}

// null when the running dev client was built before this module existed —
// callers must handle it (a stale build is a normal dev-loop state, spec 32.2).
export const FolderSyncNative =
  requireOptionalNativeModule<FolderSyncNativeModule>('FolderSyncNative');
