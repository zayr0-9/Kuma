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
}

// null when the running dev client was built before this module existed —
// callers must handle it (a stale build is a normal dev-loop state, spec 32.2).
export const FolderSyncNative =
  requireOptionalNativeModule<FolderSyncNativeModule>('FolderSyncNative');
