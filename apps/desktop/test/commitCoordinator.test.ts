import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createRepositories,
  openDatabase,
  type Database,
  type Repositories,
} from '../src/main/db/index.ts';
import { createCommitCoordinator } from '../src/main/sync/commitCoordinator.ts';
import type { CommitPrepareResult, CommitService } from '../src/main/sync/commitService.ts';

// The coordinator serialises commits per (rootId, relativePath) (spec 18.5). A fake
// service records call ordering so we can prove same-path commits never interleave
// while different-path commits do.

const T0 = '2026-07-25T12:00:00.000Z';

let db: Database;
let repos: Repositories;
let order: string[];

function recordingService(): CommitService {
  return {
    commitPrepare: async (prepareId: string): Promise<CommitPrepareResult> => {
      order.push(`start:${prepareId}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push(`end:${prepareId}`);
      return { prepareState: 'skipped' };
    },
  };
}

function seedPrepare(prepareId: string, relativePath: string): void {
  repos.files.createPrepare({
    prepareId,
    phoneDeviceId: 'dev-1',
    rootId: 'root-1',
    fileEntryId: 'file-1',
    relativePath,
    expectedSize: 1,
    createdAt: T0,
    expiresAt: '2026-08-01T00:00:00.000Z',
  });
}

beforeEach(() => {
  db = openDatabase(':memory:');
  repos = createRepositories(db);
  order = [];
  repos.devices.insert({
    phoneDeviceId: 'dev-1',
    phoneDisplayName: 'Pixel',
    tokenHash: 'h',
    pairedAt: T0,
  });
});

afterEach(() => {
  db.close();
});

describe('commitCoordinator', () => {
  it('serialises commits for the same path key', async () => {
    seedPrepare('p1', 'Camera/IMG.jpg');
    seedPrepare('p2', 'Camera/IMG.jpg');
    const coord = createCommitCoordinator({ repositories: repos, service: recordingService() });

    await Promise.all([coord.schedule('p1'), coord.schedule('p2')]);
    // p2 must wait for p1 to finish — no interleaving.
    expect(order).toEqual(['start:p1', 'end:p1', 'start:p2', 'end:p2']);
  });

  it('runs commits for different path keys concurrently', async () => {
    seedPrepare('p1', 'Camera/A.jpg');
    seedPrepare('p2', 'Camera/B.jpg');
    const coord = createCommitCoordinator({ repositories: repos, service: recordingService() });

    await Promise.all([coord.schedule('p1'), coord.schedule('p2')]);
    // both start before either ends
    expect(order.slice(0, 2).sort()).toEqual(['start:p1', 'start:p2']);
  });

  it('resolves null for an unknown prepare', async () => {
    const coord = createCommitCoordinator({ repositories: repos, service: recordingService() });
    expect(await coord.schedule('nope')).toBeNull();
  });

  it('idle resolves after fire-and-forget commits settle', async () => {
    seedPrepare('p1', 'Camera/IMG.jpg');
    const coord = createCommitCoordinator({ repositories: repos, service: recordingService() });
    void coord.schedule('p1');
    await coord.idle();
    expect(order).toContain('end:p1');
  });
});
