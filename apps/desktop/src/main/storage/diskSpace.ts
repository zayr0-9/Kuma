import { statfs } from 'node:fs/promises';

// Free bytes available on the volume backing `path` (spec 22.2). Shared by the
// prepare disk-space gate and the desktop status view; both accept an injectable
// override so the disk-space states are deterministic in tests — this is the
// production default. Throws when the path is unreachable (e.g. an unplugged
// destination volume); callers decide whether that is a 507 or an "unavailable"
// destination.
export async function freeBytesOnVolume(path: string): Promise<number> {
  const stats = await statfs(path);
  return stats.bavail * stats.bsize;
}
