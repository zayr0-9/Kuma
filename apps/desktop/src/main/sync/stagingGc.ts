import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { stagingDirPath } from '../storage/layout.ts';

// Staging garbage collection (spec 22.3): no staged file is owned implicitly.
// Runs on startup and periodically; anything not belonging to an active prepare
// is deleted, anything active is kept for resume.
export async function garbageCollectStaging(
  destinationRoot: string,
  activeUploadIds: ReadonlySet<string>,
): Promise<string[]> {
  const stagingDir = stagingDirPath(destinationRoot);
  let entries: string[];
  try {
    entries = await readdir(stagingDir);
  } catch {
    return []; // no staging directory yet — nothing to collect
  }

  const removed: string[] = [];
  for (const entry of entries) {
    // @tus/file-store stores `<id>` plus a `<id>.json` sidecar
    const uploadId = entry.endsWith('.json') ? entry.slice(0, -'.json'.length) : entry;
    if (activeUploadIds.has(uploadId)) continue;
    await rm(join(stagingDir, entry), { force: true, recursive: true });
    removed.push(entry);
  }
  return removed;
}
