import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

// Streaming SHA-256 — never buffers the whole file (spec 29.1). Runs in-process
// for now; offloading to a worker thread (spec 20.2) happens when this is wired
// into the Electron main process, so large hashes stop competing with the event
// loop. Recorded in the spike-6 ADR.
export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(filePath), hash);
  return hash.digest('hex');
}
