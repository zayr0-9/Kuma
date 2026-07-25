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

export interface FolderSyncNativeModule {
  ping(): string;

  // Spike 1 — SAF persistence and traversal (spec 35).
  pickDirectory(): Promise<PickedDirectory>;
  listPersistedPermissions(): Promise<PersistedPermission[]>;
  checkAccess(treeUri: string): Promise<AccessCheck>;
  traverseTree(treeUri: string, sampleLimit: number): Promise<TraversalResult>;
  deleteDocument(documentUri: string): Promise<DeleteResult>;
  releasePermission(treeUri: string): Promise<void>;
}

// null when the running dev client was built before this module existed —
// callers must handle it (a stale build is a normal dev-loop state, spec 32.2).
export const FolderSyncNative =
  requireOptionalNativeModule<FolderSyncNativeModule>('FolderSyncNative');
