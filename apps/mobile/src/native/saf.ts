// Typed wrapper around the Kotlin SAF surface (spec 10, 13, 35 spike 1). Screens and
// components import from here — never from `foldersync-native` directly — so the app has
// one place that handles "module not linked" (a stale dev-client build, spec 32.2).
import { FolderSyncNative } from 'foldersync-native';
import type {
  AccessCheck,
  DeleteResult,
  PersistedPermission,
  PickedDirectory,
  TraversalResult,
} from 'foldersync-native';

export type {
  AccessCheck,
  DeleteResult,
  PersistedPermission,
  PickedDirectory,
  TraversalResult,
  TraversedFile,
} from 'foldersync-native';

/** Default cap on how many files a traversal returns to JS (aggregates cover the rest). */
export const DEFAULT_TRAVERSAL_SAMPLE = 50;

export class NativeModuleUnavailableError extends Error {
  constructor() {
    super('rebuild the dev client to include the native module');
    this.name = 'NativeModuleUnavailableError';
  }
}

export function isNativeLinked(): boolean {
  return FolderSyncNative !== null;
}

function required(): NonNullable<typeof FolderSyncNative> {
  if (!FolderSyncNative) throw new NativeModuleUnavailableError();
  return FolderSyncNative;
}

export function pickDirectory(): Promise<PickedDirectory> {
  return required().pickDirectory();
}

export function listPersistedPermissions(): Promise<PersistedPermission[]> {
  return required().listPersistedPermissions();
}

export function checkAccess(treeUri: string): Promise<AccessCheck> {
  return required().checkAccess(treeUri);
}

export function traverseTree(
  treeUri: string,
  sampleLimit: number = DEFAULT_TRAVERSAL_SAMPLE,
): Promise<TraversalResult> {
  return required().traverseTree(treeUri, sampleLimit);
}

export function deleteDocument(documentUri: string): Promise<DeleteResult> {
  return required().deleteDocument(documentUri);
}

export function releasePermission(treeUri: string): Promise<void> {
  return required().releasePermission(treeUri);
}
