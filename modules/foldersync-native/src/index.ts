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

/** Outcome of adding a folder: register it with the desktop, then persist it as a sync_root. */
export type AddRootResult = { ok: true; rootId: string } | { ok: false; reason: string };

/** One persisted phone folder with the per-root status the Folders list renders (spec 5.2). */
export type RootStatus = 'idle' | 'scanning' | 'syncing' | 'error';
export interface SyncRoot {
  id: string;
  displayName: string;
  treeUri: string;
  providerAuthority: string | null;
  /** Friendly name of the bound desktop destination (never an absolute path — spec 30). */
  destinationName: string;
  mappingId: string;
  phoneRetentionPolicy: PhoneRetentionPolicy;
  desktopDeletionPolicy: DesktopDeletionPolicy;
  enabled: boolean;
  status: RootStatus;
  /** Epoch millis, or null before the first run. */
  lastCompleteScanAt: number | null;
  lastSuccessfulSyncAt: number | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  pendingCount: number;
  pendingBytes: number;
  backedUpCount: number;
  /** Files freed from the phone by retention cleanup after a verified backup (spec 19). */
  cleanedCount: number;
  /** Files backed up but whose phone-side deletion failed — retryable (spec 19.3). */
  cleanupFailedCount: number;
}

/** The file currently being uploaded (spec 18.3, one at a time); null when the queue is idle. */
export interface ActiveTransfer {
  rootId: string;
  fileName: string;
  relativePath: string;
  state: string;
  bytesUploaded: number;
  expectedSize: number;
}

/** A queued/in-flight/failed transfer row (spec 16.1 transfer_job). */
export interface TransferJob {
  id: string;
  rootId: string;
  fileEntryId: string;
  state: 'pending' | 'uploading' | 'failed';
  attemptCount: number;
  bytesUploaded: number;
  expectedSize: number;
  lastErrorCode: string | null;
}

/** Pull-model snapshot of the transfer queue for the Transfers view (spec 5.5). */
export interface TransfersSnapshot {
  active: ActiveTransfer | null;
  jobs: TransferJob[];
}

/** A user-readable operational event (spec 5.5 History); never raw logs or secrets (spec 30). */
export interface SyncEvent {
  id: number;
  severity: string;
  eventType: string;
  rootId: string | null;
  message: string;
  createdAt: number;
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

  // Roots binding + the real scan/upload engine (spec 16-18). Authenticated control calls to
  // the paired desktop drive resumable tus uploads of a bound folder; the bearer token never
  // crosses to JS. State is durable in Room and observed via pull-model snapshots.

  /** Desktop-approved destinations this phone may bind (spec 5.1 step 10). */
  listAvailableDestinations(): Promise<ListDestinationsResult>;
  /** Bind a picked folder to a destination + policies, then persist it as a sync_root. */
  addRoot(
    treeUri: string,
    displayName: string,
    providerAuthority: string | null,
    mappingId: string,
    destinationName: string,
    retention: PhoneRetentionPolicy,
    deletion: DesktopDeletionPolicy,
  ): Promise<AddRootResult>;
  /** The phone's persisted folders with per-root status (spec 5.2). */
  listRoots(): Promise<SyncRoot[]>;
  /** Pause/resume a root's participation in sync (spec 5.2 pause/resume control). */
  setRootEnabled(rootId: string, enabled: boolean): Promise<void>;
  /** Forget a folder locally and best-effort unbind it on the desktop (spec 25.1). */
  removeRoot(rootId: string): Promise<{ ok: boolean }>;
  /** Trigger a full sync (scan enabled roots, then drain the queue); returns immediately. */
  syncNow(): Promise<{ started: boolean }>;
  /** Retry failed retention deletions on a root, then kick a sync to re-attempt (spec 19.3). */
  retryCleanup(rootId: string): Promise<{ started: boolean }>;
  /** Active + queued transfers for the Transfers view (spec 5.5). */
  getTransfers(): Promise<TransfersSnapshot>;
  /** Recent user-readable operational events, newest first (spec 5.5). */
  getSyncEvents(limit: number): Promise<SyncEvent[]>;
}

// null when the running dev client was built before this module existed —
// callers must handle it (a stale build is a normal dev-loop state, spec 32.2).
export const FolderSyncNative =
  requireOptionalNativeModule<FolderSyncNativeModule>('FolderSyncNative');
