// Typed wrapper around the Kotlin SAF surface (spec 10, 13, 35 spike 1). Screens and
// components import from here — never from `foldersync-native` directly. The
// module-not-linked guard lives in ./module.ts and is shared with the other wrappers.
import { requireNative } from './module.ts';
import type {
  AccessCheck,
  DeleteResult,
  PersistedPermission,
  PickedDirectory,
  TraversalResult,
} from 'foldersync-native';

export { isNativeLinked, NativeModuleUnavailableError } from './module.ts';

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

export function pickDirectory(): Promise<PickedDirectory> {
  return requireNative().pickDirectory();
}

export function listPersistedPermissions(): Promise<PersistedPermission[]> {
  return requireNative().listPersistedPermissions();
}

export function checkAccess(treeUri: string): Promise<AccessCheck> {
  return requireNative().checkAccess(treeUri);
}

export function traverseTree(
  treeUri: string,
  sampleLimit: number = DEFAULT_TRAVERSAL_SAMPLE,
): Promise<TraversalResult> {
  return requireNative().traverseTree(treeUri, sampleLimit);
}

export function deleteDocument(documentUri: string): Promise<DeleteResult> {
  return requireNative().deleteDocument(documentUri);
}

export function releasePermission(treeUri: string): Promise<void> {
  return requireNative().releasePermission(treeUri);
}
