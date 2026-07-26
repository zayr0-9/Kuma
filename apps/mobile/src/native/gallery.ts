// Typed wrapper around the native remote-gallery surface (spec 6.6). Screens import from here
// — never from `foldersync-native` directly. The desktop is the source of truth for what is
// backed up: listRemoteImages pages the listing, and fetchThumbnail/fetchRemoteImage return a
// local `file://` URI (the native module fetches the bytes over the pinned TLS client with the
// bearer token, which never crosses to JS). downloadRemoteImage saves into the photo library.
import { requireNative } from './module.ts';
import type {
  DownloadImageResult,
  ListRemoteImagesResult,
  LocalMediaResult,
} from 'foldersync-native';

export { isNativeLinked, NativeModuleUnavailableError } from './module.ts';

export type {
  DownloadImageResult,
  ListRemoteImagesResult,
  LocalMediaResult,
  RemoteImageItem,
} from 'foldersync-native';

export function listRemoteImages(
  rootId: string,
  cursor: string | null,
  limit = 60,
): Promise<ListRemoteImagesResult> {
  return requireNative().listRemoteImages(rootId, cursor, limit);
}

export function fetchThumbnail(fileId: string, versionId: string): Promise<LocalMediaResult> {
  return requireNative().fetchThumbnail(fileId, versionId);
}

export function fetchRemoteImage(fileId: string, versionId: string): Promise<LocalMediaResult> {
  return requireNative().fetchRemoteImage(fileId, versionId);
}

export function downloadRemoteImage(
  fileId: string,
  name: string,
  contentType: string,
): Promise<DownloadImageResult> {
  return requireNative().downloadRemoteImage(fileId, name, contentType);
}
