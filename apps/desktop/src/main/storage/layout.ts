import { join } from 'node:path';

// Managed directories inside every destination root (spec 22). They hold
// staged/recoverable content only — the primary database lives in the app data
// directory, never here.
export const STAGING_DIR = '.foldersync-staging';
export const TRASH_DIR = '.foldersync-trash';
export const CONFLICTS_DIR = '.foldersync-conflicts';
export const META_DIR = '.foldersync-meta';

const MANAGED_PREFIX = '.foldersync-';

// A wire path may never address the managed directories (defence in depth on top
// of spec 22.1 — nothing in the wire rules forbids a `.foldersync-*` first
// segment, so it is forbidden here).
export function isReservedRelativePath(relativePath: string): boolean {
  const firstSegment = relativePath.split('/')[0];
  return firstSegment !== undefined && firstSegment.startsWith(MANAGED_PREFIX);
}

export function stagingDirPath(destinationRoot: string): string {
  return join(destinationRoot, STAGING_DIR);
}

// Timestamped subdirectory name used by trash and conflicts (spec 22):
// 2026-07-25T120000Z
export function layoutTimestamp(date: Date): string {
  const iso = date.toISOString();
  return `${iso.slice(0, 10)}T${iso.slice(11, 19).split(':').join('')}Z`;
}

export function conflictPathFor(
  destinationRoot: string,
  timestamp: Date,
  relativePath: string,
): string {
  return join(
    destinationRoot,
    CONFLICTS_DIR,
    layoutTimestamp(timestamp),
    ...relativePath.split('/'),
  );
}

export function trashPathFor(
  destinationRoot: string,
  timestamp: Date,
  relativePath: string,
): string {
  return join(destinationRoot, TRASH_DIR, layoutTimestamp(timestamp), ...relativePath.split('/'));
}

// The trash location as a destination-root-relative, forward-slash path — what is
// stored in deletion_event and returned to the phone. The absolute filesystem path
// (trashPathFor) is used only for the on-disk move and is never sent (spec 30).
export function relativeTrashPath(timestamp: Date, relativePath: string): string {
  return `${TRASH_DIR}/${layoutTimestamp(timestamp)}/${relativePath}`;
}
