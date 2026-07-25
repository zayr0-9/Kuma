import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  openDatabase,
  resolveDatabasePath,
  runMigrations,
  createRepositories,
  LATEST_SCHEMA_VERSION,
  type Database,
  type Repositories,
} from '../src/main/db/index.ts';

const T0 = '2026-07-25T12:00:00.000Z';
const T1 = '2026-07-26T09:30:00.000Z';

function userVersion(db: Database): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  return Number(row.user_version);
}

function tableNames(db: Database): string[] {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((raw) => String((raw as Record<string, unknown>).name))
    .filter((name) => !name.startsWith('sqlite_'));
}

function pairDevice(repos: Repositories, id = 'dev-1'): void {
  repos.devices.insert({
    phoneDeviceId: id,
    phoneDisplayName: 'Pixel',
    tokenHash: `hash-${id}`,
    pairedAt: T0,
  });
}

let db: Database;
let repos: Repositories;

beforeEach(() => {
  db = openDatabase(':memory:');
  repos = createRepositories(db);
});

afterEach(() => {
  db.close();
});

describe('migrations', () => {
  it('brings a fresh database to the latest schema version', () => {
    expect(userVersion(db)).toBe(LATEST_SCHEMA_VERSION);
    expect(LATEST_SCHEMA_VERSION).toBe(1);
  });

  it('creates all eight spec-21.1 tables', () => {
    expect(tableNames(db)).toEqual([
      'deletion_event',
      'desktop_identity',
      'event_log',
      'paired_device',
      'remote_file',
      'remote_version',
      'root_mapping',
      'upload_prepare',
    ]);
  });

  it('enables foreign key enforcement', () => {
    const row = db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
    expect(Number(row.foreign_keys)).toBe(1);
  });

  it('is idempotent — re-running applies nothing', () => {
    expect(runMigrations(db)).toBe(LATEST_SCHEMA_VERSION);
    expect(userVersion(db)).toBe(LATEST_SCHEMA_VERSION);
  });
});

describe('file-based persistence', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'fsync-db-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('persists rows across close and reopen and does not re-migrate', () => {
    const path = resolveDatabasePath(dir);
    expect(path).toBe(join(dir, 'foldersync.db'));

    const first = openDatabase(path);
    createRepositories(first).devices.insert({
      phoneDeviceId: 'dev-persist',
      phoneDisplayName: 'Galaxy',
      tokenHash: 'hash-persist',
      pairedAt: T0,
    });
    first.close();

    const second = openDatabase(path);
    expect(userVersion(second)).toBe(LATEST_SCHEMA_VERSION);
    const row = createRepositories(second).devices.getByDeviceId('dev-persist');
    expect(row?.phoneDisplayName).toBe('Galaxy');
    second.close();
  });
});

describe('identity repository', () => {
  it('returns null before any identity is stored', () => {
    expect(repos.identity.get()).toBeNull();
  });

  it('round-trips the singleton identity', () => {
    repos.identity.set({
      deviceId: 'desk-1',
      displayName: 'Karn-PC',
      certificateRef: 'device-cert.pem',
      publicKeyPin: 'A'.repeat(43),
      createdAt: T0,
    });
    expect(repos.identity.get()).toEqual({
      deviceId: 'desk-1',
      displayName: 'Karn-PC',
      certificateRef: 'device-cert.pem',
      publicKeyPin: 'A'.repeat(43),
      createdAt: T0,
      rotatedAt: null,
    });
  });

  it('rotation updates fields and rotated_at but preserves created_at and singleton-ness', () => {
    repos.identity.set({
      deviceId: 'desk-1',
      displayName: 'Karn-PC',
      certificateRef: 'v1.pem',
      publicKeyPin: 'A'.repeat(43),
      createdAt: T0,
    });
    repos.identity.set({
      deviceId: 'desk-1',
      displayName: 'Karn-PC',
      certificateRef: 'v2.pem',
      publicKeyPin: 'B'.repeat(43),
      createdAt: T1, // ignored on update
      rotatedAt: T1,
    });

    const row = repos.identity.get();
    expect(row?.certificateRef).toBe('v2.pem');
    expect(row?.publicKeyPin).toBe('B'.repeat(43));
    expect(row?.createdAt).toBe(T0);
    expect(row?.rotatedAt).toBe(T1);

    const count = db.prepare('SELECT COUNT(*) AS n FROM desktop_identity').get() as { n: number };
    expect(Number(count.n)).toBe(1);
  });
});

describe('devices repository', () => {
  it('inserts and reads a paired device', () => {
    pairDevice(repos);
    expect(repos.devices.getByDeviceId('dev-1')).toEqual({
      phoneDeviceId: 'dev-1',
      phoneDisplayName: 'Pixel',
      tokenHash: 'hash-dev-1',
      pairedAt: T0,
      lastSeenAt: null,
      revokedAt: null,
    });
  });

  it('rejects a duplicate device id', () => {
    pairDevice(repos);
    expect(() => pairDevice(repos)).toThrow();
  });

  it('resolves an active token hash but not a revoked one', () => {
    pairDevice(repos);
    expect(repos.devices.findActiveByTokenHash('hash-dev-1')?.phoneDeviceId).toBe('dev-1');

    repos.devices.revoke('dev-1', T1);
    expect(repos.devices.findActiveByTokenHash('hash-dev-1')).toBeNull();
    // The row survives with revoked_at set — history is not deleted.
    expect(repos.devices.getByDeviceId('dev-1')?.revokedAt).toBe(T1);
  });

  it('records last-seen time', () => {
    pairDevice(repos);
    repos.devices.touchLastSeen('dev-1', T1);
    expect(repos.devices.getByDeviceId('dev-1')?.lastSeenAt).toBe(T1);
  });
});

describe('roots repository', () => {
  beforeEach(() => {
    pairDevice(repos);
  });

  it('creates a UI-approved pending mapping, then binds a phone root and policies', () => {
    repos.roots.create({
      mappingId: 'map-1',
      phoneDeviceId: 'dev-1',
      destinationRoot: '/backups/pixel/camera',
      displayName: 'Camera',
      createdAt: T0,
    });

    const pending = repos.roots.getByMappingId('map-1');
    expect(pending?.phoneRootId).toBeNull();
    expect(pending?.phoneRetentionPolicy).toBeNull();
    expect(pending?.destinationRelativeBase).toBe('');

    repos.roots.bind({
      mappingId: 'map-1',
      phoneRootId: 'root-1',
      phoneRetentionPolicy: 'delete_after_verified_backup',
      desktopDeletionPolicy: 'preserve_desktop_copy',
      updatedAt: T1,
    });

    const bound = repos.roots.getByPhoneRoot('dev-1', 'root-1');
    expect(bound?.mappingId).toBe('map-1');
    expect(bound?.phoneRetentionPolicy).toBe('delete_after_verified_backup');
    expect(bound?.desktopDeletionPolicy).toBe('preserve_desktop_copy');
    expect(bound?.updatedAt).toBe(T1);
  });

  it('enforces the (phone_device_id, phone_root_id) unique key', () => {
    repos.roots.create({
      mappingId: 'map-1',
      phoneDeviceId: 'dev-1',
      destinationRoot: '/backups/a',
      displayName: 'A',
      createdAt: T0,
    });
    repos.roots.create({
      mappingId: 'map-2',
      phoneDeviceId: 'dev-1',
      destinationRoot: '/backups/b',
      displayName: 'B',
      createdAt: T0,
    });
    repos.roots.bind({
      mappingId: 'map-1',
      phoneRootId: 'root-1',
      phoneRetentionPolicy: 'keep_on_phone',
      desktopDeletionPolicy: 'preserve_desktop_copy',
      updatedAt: T1,
    });
    expect(() =>
      repos.roots.bind({
        mappingId: 'map-2',
        phoneRootId: 'root-1',
        phoneRetentionPolicy: 'keep_on_phone',
        desktopDeletionPolicy: 'preserve_desktop_copy',
        updatedAt: T1,
      }),
    ).toThrow();
  });

  it('lists destinations for overlap checks and mappings by device', () => {
    repos.roots.create({
      mappingId: 'map-1',
      phoneDeviceId: 'dev-1',
      destinationRoot: '/backups/a',
      displayName: 'A',
      createdAt: T0,
    });
    repos.roots.create({
      mappingId: 'map-2',
      phoneDeviceId: 'dev-1',
      destinationRoot: '/backups/b',
      displayName: 'B',
      createdAt: T0,
    });

    expect(repos.roots.listDestinations()).toEqual([
      { mappingId: 'map-1', destinationRoot: '/backups/a' },
      { mappingId: 'map-2', destinationRoot: '/backups/b' },
    ]);
    expect(repos.roots.listByDevice('dev-1')).toHaveLength(2);
    expect(repos.roots.listByDevice('dev-unknown')).toHaveLength(0);
  });

  it('rejects a mapping for an unknown device (foreign key)', () => {
    expect(() =>
      repos.roots.create({
        mappingId: 'map-x',
        phoneDeviceId: 'ghost',
        destinationRoot: '/backups/x',
        displayName: 'X',
        createdAt: T0,
      }),
    ).toThrow();
  });

  it('cascades mapping deletion when the paired device is removed', () => {
    repos.roots.create({
      mappingId: 'map-1',
      phoneDeviceId: 'dev-1',
      destinationRoot: '/backups/a',
      displayName: 'A',
      createdAt: T0,
    });
    db.prepare('DELETE FROM paired_device WHERE phone_device_id = ?').run('dev-1');
    expect(repos.roots.getByMappingId('map-1')).toBeNull();
  });
});
