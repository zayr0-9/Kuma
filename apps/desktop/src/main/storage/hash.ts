import { Worker } from 'node:worker_threads';
import type { HashWorkerResult } from './hashWorker.ts';

// Streaming SHA-256 offloaded to a worker thread (spec 20.2/29.1): the digest of a
// large upload is CPU-bound and would otherwise stall the main process during a
// commit. The read is streamed inside the worker, so nothing buffers the whole file.
// One worker per call is spawned and terminated — commits are infrequent relative to
// their cost, and a pool is a later optimisation.
//
// electron-vite's Node build does not transform `new Worker(new URL(...))`, so the
// worker is emitted as its own entry (`out/main/hashWorker.js`, see
// electron.vite.config.ts). The source module and the built entry sit at different
// relative locations, so resolve by which one is running: under vitest/Node the
// module URL ends in `.ts` and the sibling source worker is loaded directly; in the
// packaged app it ends in `.js` and the emitted worker sits beside `index.js`.
const workerUrl = new URL(
  import.meta.url.endsWith('.ts') ? './hashWorker.ts' : './hashWorker.js',
  import.meta.url,
);

export function sha256File(filePath: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const worker = new Worker(workerUrl, { workerData: filePath });
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      void worker.terminate();
      fn();
    };
    worker.once('message', (message: HashWorkerResult) => {
      if (message.ok && message.digest !== undefined) {
        const digest = message.digest;
        finish(() => resolve(digest));
      } else {
        finish(() => reject(new Error(message.error ?? 'hash worker failed')));
      }
    });
    worker.once('error', (error: Error) => finish(() => reject(error)));
  });
}
