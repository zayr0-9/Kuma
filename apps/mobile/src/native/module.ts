// Shared access to the Kotlin module for the typed wrappers in this directory. One place
// handles "module not linked" (a stale dev-client build, spec 32.2) so every wrapper —
// saf.ts, service.ts, … — reuses the same guard rather than re-implementing it.
import { FolderSyncNative } from 'foldersync-native';

export class NativeModuleUnavailableError extends Error {
  constructor() {
    super('rebuild the dev client to include the native module');
    this.name = 'NativeModuleUnavailableError';
  }
}

export function isNativeLinked(): boolean {
  return FolderSyncNative !== null;
}

export function requireNative(): NonNullable<typeof FolderSyncNative> {
  if (!FolderSyncNative) throw new NativeModuleUnavailableError();
  return FolderSyncNative;
}
