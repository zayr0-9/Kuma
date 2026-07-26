// Gallery thumbnail generation boundary (spec 22.4). The interface is electron-free so the
// control server and its tests never import Electron; the real implementation
// (electronThumbnailer.ts, using `nativeImage`) is constructed by the main process and
// injected. A test may inject a fake, or omit the provider entirely — the routes then fall
// back to serving the original bytes.

export interface ThumbnailRequest {
  // Absolute path of the committed file on the destination volume.
  absolutePath: string;
  // Immutable remote version id — the cache key, so a re-backed-up file (new version) never
  // serves a stale thumbnail.
  versionId: string;
  // Longest-edge bound in pixels for the generated thumbnail.
  maxSize: number;
}

export interface ThumbnailResult {
  body: Buffer;
  contentType: string;
}

export interface ThumbnailProvider {
  // A downscaled thumbnail for the file, or null when the format cannot be decoded (the
  // caller then falls back to the original bytes — spec 22.4).
  getThumbnail(request: ThumbnailRequest): Promise<ThumbnailResult | null>;
}
