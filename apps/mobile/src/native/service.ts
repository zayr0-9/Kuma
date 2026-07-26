// Typed wrapper around the Kotlin foreground service (spec 13, 14, 35 spike 2). Screens
// import from here — never from `foldersync-native` directly. `startSyncService` also
// resumes from paused. Service state is always re-queried via `getServiceStatus`
// (native events are freshness hints, not the durable truth — spec 13.3).
import { requireNative } from './module.ts';
import type { ServiceStatus } from 'foldersync-native';

export type { ServiceState, ServiceStatus } from 'foldersync-native';

export function startSyncService(): Promise<void> {
  return requireNative().startSyncService();
}

export function pauseSyncService(): Promise<void> {
  return requireNative().pauseSyncService();
}

export function stopSyncService(): Promise<void> {
  return requireNative().stopSyncService();
}

export function getServiceStatus(): Promise<ServiceStatus> {
  return requireNative().getServiceStatus();
}

// Turn continuous background sync on/off durably (spec 14.1); starts/stops the foreground service.
export function setBackgroundSyncEnabled(enabled: boolean): Promise<void> {
  return requireNative().setBackgroundSyncEnabled(enabled);
}

// Resume automatic sync on app open (spec 14.3), but only if the user wants it and has a folder.
export function ensureBackgroundSync(): Promise<void> {
  return requireNative().ensureBackgroundSync();
}
