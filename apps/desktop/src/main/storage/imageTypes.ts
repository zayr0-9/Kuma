// Which committed files the remote gallery surfaces, and their content type (spec 6.6).
// Version one is images only; other media types are deferred. Extension-based because the
// desktop does not persist a per-file MIME type — the committed relative path is the truth.

const IMAGE_CONTENT_TYPES: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  heic: 'image/heic',
  heif: 'image/heif',
};

// The recognised image extensions (lowercase, no dot). Trusted constants — the gallery
// listing query builds a fixed LIKE clause from these, never from user input.
export const IMAGE_EXTENSIONS: readonly string[] = Object.keys(IMAGE_CONTENT_TYPES);

// The lowercase extension of a wire path (no dot), or null when there is none. Wire paths
// are always `/`-separated (spec 12.6), so the basename is the last `/` segment.
export function imageExtension(relativePath: string): string | null {
  const name = relativePath.split('/').pop() ?? relativePath;
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return null;
  return name.slice(dot + 1).toLowerCase();
}

export function isImageRelativePath(relativePath: string): boolean {
  const ext = imageExtension(relativePath);
  return ext !== null && ext in IMAGE_CONTENT_TYPES;
}

// The content type for a gallery file. Falls back to a generic binary type for a path that
// is not a recognised image (defensive — only image paths reach the gallery routes).
export function imageContentType(relativePath: string): string {
  const ext = imageExtension(relativePath);
  return (ext !== null && IMAGE_CONTENT_TYPES[ext]) || 'application/octet-stream';
}
