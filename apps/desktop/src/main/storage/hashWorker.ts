import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { parentPort, workerData } from 'node:worker_threads';

// Worker entry (spec 20.2): streams one file through SHA-256 and posts the hex
// digest back, so hashing a multi-gigabyte upload never blocks the main process
// event loop. The file path arrives as workerData; the result is a discriminated
// message so the host can reject cleanly on a read error.

export interface HashWorkerResult {
  ok: boolean;
  digest?: string;
  error?: string;
}

async function run(): Promise<void> {
  const filePath = workerData as string;
  const hash = createHash('sha256');
  await pipeline(createReadStream(filePath), hash);
  const result: HashWorkerResult = { ok: true, digest: hash.digest('hex') };
  parentPort?.postMessage(result);
}

run().catch((error: unknown) => {
  const result: HashWorkerResult = {
    ok: false,
    error: error instanceof Error ? error.message : 'hash worker failed',
  };
  parentPort?.postMessage(result);
});
