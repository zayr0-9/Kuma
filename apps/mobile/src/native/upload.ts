// Typed wrapper around the Kotlin roots-binding + tus-upload surface (spec 13, 18, 25.2,
// 35 spike 5). Control calls (list/register) are request/response; the upload is fire-and-poll
// — startUpload returns immediately and getUploadStatus is polled (pull model, like discovery).
import { requireNative } from './module.ts';
import type {
  DesktopDeletionPolicy,
  ListDestinationsResult,
  PhoneRetentionPolicy,
  RegisterRootResult,
  StartUploadResult,
  UploadStatus,
} from 'foldersync-native';

export type {
  AvailableDestination,
  DesktopDeletionPolicy,
  ListDestinationsResult,
  PhoneRetentionPolicy,
  RegisterRootResult,
  StartUploadResult,
  UploadStatus,
} from 'foldersync-native';

export function listAvailableDestinations(): Promise<ListDestinationsResult> {
  return requireNative().listAvailableDestinations();
}

export function registerRoot(
  mappingId: string,
  displayName: string,
  retention: PhoneRetentionPolicy,
  deletion: DesktopDeletionPolicy,
): Promise<RegisterRootResult> {
  return requireNative().registerRoot(mappingId, displayName, retention, deletion);
}

export function startUpload(
  rootId: string,
  documentUri: string,
  relativePath: string,
  sizeBytes: number,
  mimeType: string | null,
  modifiedAtMs: number | null,
): Promise<StartUploadResult> {
  return requireNative().startUpload(
    rootId,
    documentUri,
    relativePath,
    sizeBytes,
    mimeType,
    modifiedAtMs,
  );
}

export function getUploadStatus(): Promise<UploadStatus> {
  return requireNative().getUploadStatus();
}

export function cancelUpload(): Promise<void> {
  return requireNative().cancelUpload();
}
