// Typed wrapper around the Kotlin scan/upload engine surface (spec 13, 16-18, 25). Screens
// import from here — never from `foldersync-native` directly. Control calls (list/add/remove)
// are request/response; sync is fire-and-poll — syncNow returns immediately and
// listRoots/getTransfers are polled (pull model, like discovery and the service).
import { requireNative } from './module.ts';
import type {
  AddRootResult,
  DesktopDeletionPolicy,
  ListDestinationsResult,
  PhoneRetentionPolicy,
  SyncEvent,
  SyncRoot,
  TransfersSnapshot,
} from 'foldersync-native';

export { isNativeLinked, NativeModuleUnavailableError } from './module.ts';

export type {
  ActiveTransfer,
  AddRootResult,
  AvailableDestination,
  DesktopDeletionPolicy,
  ListDestinationsResult,
  PhoneRetentionPolicy,
  RootStatus,
  SyncEvent,
  SyncRoot,
  TransferJob,
  TransfersSnapshot,
} from 'foldersync-native';

export function listAvailableDestinations(): Promise<ListDestinationsResult> {
  return requireNative().listAvailableDestinations();
}

export function addRoot(
  treeUri: string,
  displayName: string,
  providerAuthority: string | null,
  mappingId: string,
  destinationName: string,
  retention: PhoneRetentionPolicy,
  deletion: DesktopDeletionPolicy,
): Promise<AddRootResult> {
  return requireNative().addRoot(
    treeUri,
    displayName,
    providerAuthority,
    mappingId,
    destinationName,
    retention,
    deletion,
  );
}

export function listRoots(): Promise<SyncRoot[]> {
  return requireNative().listRoots();
}

export function setRootEnabled(rootId: string, enabled: boolean): Promise<void> {
  return requireNative().setRootEnabled(rootId, enabled);
}

export function removeRoot(rootId: string): Promise<{ ok: boolean }> {
  return requireNative().removeRoot(rootId);
}

export function syncNow(): Promise<{ started: boolean }> {
  return requireNative().syncNow();
}

export function getTransfers(): Promise<TransfersSnapshot> {
  return requireNative().getTransfers();
}

export function getSyncEvents(limit = 50): Promise<SyncEvent[]> {
  return requireNative().getSyncEvents(limit);
}
