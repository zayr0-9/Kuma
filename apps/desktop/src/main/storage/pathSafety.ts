import { realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { parseWirePath } from '@foldersync/contracts';

// Destination path safety (spec 22.1). The wire rules (spec 12.6) are enforced by
// parseWirePath; this module adds the desktop-platform validation on top. Every
// incoming path — prepare, delete, trash, conflict — must pass through here before
// touching the filesystem.

const BACKSLASH = String.fromCharCode(92);
const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])([.].*)?$/i;
const WINDOWS_INVALID_CHARS = /[<>:"|?*]/;
const WINDOWS_MAX_PATH = 259;

export type DestinationPathError =
  | { kind: 'invalid_wire_path'; detail: string }
  | { kind: 'invalid_platform_name'; segment: string }
  | { kind: 'reserved_name'; segment: string }
  | { kind: 'path_too_long' }
  | { kind: 'outside_root' };

export type DestinationPathResult =
  | { ok: true; absolutePath: string; relativePath: string }
  | { ok: false; error: DestinationPathError };

function hasControlChars(segment: string): boolean {
  for (const char of segment) {
    if (char.charCodeAt(0) < 0x20) return true;
  }
  return false;
}

export function resolveDestinationPath(
  destinationRoot: string,
  wirePath: string,
  platform: NodeJS.Platform = process.platform,
): DestinationPathResult {
  const parsed = parseWirePath(wirePath);
  if (!parsed.ok) {
    return { ok: false, error: { kind: 'invalid_wire_path', detail: parsed.error } };
  }

  const segments = parsed.path.split('/');
  for (const segment of segments) {
    if (hasControlChars(segment)) {
      return { ok: false, error: { kind: 'invalid_platform_name', segment } };
    }
    if (platform === 'win32') {
      if (WINDOWS_INVALID_CHARS.test(segment) || segment.includes(BACKSLASH)) {
        return { ok: false, error: { kind: 'invalid_platform_name', segment } };
      }
      if (segment.endsWith('.') || segment.endsWith(' ')) {
        return { ok: false, error: { kind: 'invalid_platform_name', segment } };
      }
      if (WINDOWS_RESERVED_NAMES.test(segment)) {
        return { ok: false, error: { kind: 'reserved_name', segment } };
      }
    }
  }

  const root = resolve(destinationRoot);
  const absolutePath = resolve(root, ...segments);

  // Defense in depth: the wire rules already exclude traversal, but containment is
  // re-verified on the resolved result — never trust a single layer for this.
  const relativeToRoot = relative(root, absolutePath);
  if (relativeToRoot === '' || relativeToRoot.startsWith('..') || isAbsolute(relativeToRoot)) {
    return { ok: false, error: { kind: 'outside_root' } };
  }

  if (platform === 'win32' && absolutePath.length > WINDOWS_MAX_PATH) {
    return { ok: false, error: { kind: 'path_too_long' } };
  }

  // parsed.path is the canonical `/`-joined relative path (segments.join('/')); it
  // is the key callers store in remote_file / upload_prepare so prepare, upload and
  // commit all agree on one normalised form.
  return { ok: true, absolutePath, relativePath: parsed.path };
}

// Symlink-escape check (spec 22.1 rules 7–8): the deepest existing ancestor of the
// target must resolve inside the destination root's real path. Call this after
// resolveDestinationPath and before any write/move/delete.
export async function parentsResolveInsideRoot(
  destinationRoot: string,
  absolutePath: string,
): Promise<boolean> {
  const rootReal = await realpath(resolve(destinationRoot));
  let candidate = dirname(absolutePath);
  for (;;) {
    try {
      const real = await realpath(candidate);
      return real === rootReal || real.startsWith(rootReal + sep);
    } catch {
      const parent = dirname(candidate);
      if (parent === candidate) return false;
      candidate = parent;
    }
  }
}
