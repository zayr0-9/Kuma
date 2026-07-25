import { open } from 'node:fs/promises';

// Durable-commit helpers (spec 18.5): the staged file is fsynced before it
// becomes visible, and the parent directory is fsynced after the rename so the
// directory entry itself is durable. Note: on macOS, fsync does not guarantee
// platter durability (F_FULLFSYNC would); this is the standard approximation —
// recorded in the spike-6 ADR.
export async function fsyncFile(filePath: string): Promise<void> {
  const handle = await open(filePath, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function fsyncDir(dirPath: string): Promise<void> {
  try {
    await fsyncFile(dirPath);
  } catch {
    // Directory fsync is unsupported on some platforms (notably Windows);
    // rename durability then rides on the filesystem's own guarantees.
  }
}
