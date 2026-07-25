import { isAbsolute, relative, resolve } from 'node:path';

// Destination-overlap detection (spec 12.5): a new root mapping is rejected when
// its destination equals, is an ancestor of, or is a descendant of an existing
// mapping's destination. Two roots writing into the same or nested directories
// would clobber each other, and the (deviceId, rootId, relativePath) uniqueness
// guard does not prevent that.

export interface ExistingDestination {
  mappingId: string;
  destinationRoot: string;
}

function normalise(path: string, platform: NodeJS.Platform): string {
  const resolved = resolve(path);
  // macOS and Windows default volumes are case-insensitive, so /Backups and
  // /backups are the same directory. Folding case can over-block on a
  // case-sensitive volume, but that is the safe direction — spec 12.5 prefers
  // blocking over a silent shared-directory overwrite. (A realpath-based check is
  // the eventual precise answer; tracked as a hardening follow-up.)
  return platform === 'win32' || platform === 'darwin' ? resolved.toLowerCase() : resolved;
}

function isAncestorOrEqual(parent: string, child: string): boolean {
  if (parent === child) return true;
  const rel = relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

export function destinationsOverlap(
  a: string,
  b: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const na = normalise(a, platform);
  const nb = normalise(b, platform);
  return isAncestorOrEqual(na, nb) || isAncestorOrEqual(nb, na);
}

// Returns the mappingId of the first existing destination that overlaps the
// candidate, or null. `excludeMappingId` skips the candidate's own row.
export function findDestinationOverlap(
  candidate: string,
  existing: ExistingDestination[],
  excludeMappingId?: string,
  platform: NodeJS.Platform = process.platform,
): string | null {
  for (const entry of existing) {
    if (entry.mappingId === excludeMappingId) continue;
    if (destinationsOverlap(candidate, entry.destinationRoot, platform)) return entry.mappingId;
  }
  return null;
}
