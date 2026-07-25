// Typed wrapper around the Kotlin module (spec 10, 13). Screens and components
// import from here — never from `foldersync-native` directly — so the app has one
// place that handles "module not linked" (a stale dev-client build).
import { FolderSyncNative } from 'foldersync-native';

export type PingResult = { ok: true; reply: string } | { ok: false; reason: string };

export function pingNativeModule(): PingResult {
  if (!FolderSyncNative) {
    return { ok: false, reason: 'rebuild the dev client to include the native module' };
  }
  return { ok: true, reply: FolderSyncNative.ping() };
}
