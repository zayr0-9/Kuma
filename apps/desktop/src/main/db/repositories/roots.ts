import type { DesktopDeletionPolicy, PhoneRetentionPolicy } from '@foldersync/contracts';
import type { Database } from '../database.ts';
import { asRow, asText, asTextOrNull } from '../row.ts';
import type { RootMappingRow } from '../types.ts';

// root_mapping binds a phone root to a desktop destination (spec 25.2). The
// destination is approved in the desktop UI first (created here with a null
// phone_root_id and null policies); POST /v1/roots/register then binds the phone
// root id and the two independent policies. Destination-overlap rejection
// (spec 12.5) is enforced in endpoint code using `listDestinations()`.

function mapRow(raw: unknown): RootMappingRow | null {
  const r = asRow(raw);
  if (r === null) return null;
  return {
    mappingId: asText(r.mapping_id),
    phoneDeviceId: asText(r.phone_device_id),
    phoneRootId: asTextOrNull(r.phone_root_id),
    destinationRoot: asText(r.destination_root),
    destinationRelativeBase: asText(r.destination_relative_base),
    phoneRetentionPolicy: asTextOrNull(r.phone_retention_policy) as PhoneRetentionPolicy | null,
    desktopDeletionPolicy: asTextOrNull(r.desktop_deletion_policy) as DesktopDeletionPolicy | null,
    displayName: asText(r.display_name),
    createdAt: asText(r.created_at),
    updatedAt: asText(r.updated_at),
  };
}

export interface CreateRootMappingInput {
  mappingId: string;
  phoneDeviceId: string;
  destinationRoot: string;
  destinationRelativeBase?: string;
  displayName: string;
  createdAt: string;
  // Present only when the phone binds at creation time; normally null until bind().
  phoneRootId?: string | null;
  phoneRetentionPolicy?: PhoneRetentionPolicy | null;
  desktopDeletionPolicy?: DesktopDeletionPolicy | null;
}

export interface BindRootMappingInput {
  mappingId: string;
  phoneRootId: string;
  phoneRetentionPolicy: PhoneRetentionPolicy;
  desktopDeletionPolicy: DesktopDeletionPolicy;
  updatedAt: string;
}

export interface RootDestination {
  mappingId: string;
  destinationRoot: string;
}

export interface RootsRepository {
  create(input: CreateRootMappingInput): void;
  getByMappingId(mappingId: string): RootMappingRow | null;
  getByPhoneRoot(phoneDeviceId: string, phoneRootId: string): RootMappingRow | null;
  bind(input: BindRootMappingInput): void;
  listDestinations(): RootDestination[];
  listByDevice(phoneDeviceId: string): RootMappingRow[];
  // Every mapping, newest first — the flat device-agnostic view the desktop
  // destinations UI renders (listByDevice scopes to one phone).
  list(): RootMappingRow[];
}

export function createRootsRepository(db: Database): RootsRepository {
  const createStmt = db.prepare(`
    INSERT INTO root_mapping
      (mapping_id, phone_device_id, phone_root_id, destination_root,
       destination_relative_base, phone_retention_policy, desktop_deletion_policy,
       display_name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const byMappingStmt = db.prepare('SELECT * FROM root_mapping WHERE mapping_id = ?');
  const byPhoneRootStmt = db.prepare(
    'SELECT * FROM root_mapping WHERE phone_device_id = ? AND phone_root_id = ?',
  );
  const bindStmt = db.prepare(`
    UPDATE root_mapping SET
      phone_root_id = ?,
      phone_retention_policy = ?,
      desktop_deletion_policy = ?,
      updated_at = ?
    WHERE mapping_id = ?
  `);
  const destinationsStmt = db.prepare('SELECT mapping_id, destination_root FROM root_mapping');
  const byDeviceStmt = db.prepare('SELECT * FROM root_mapping WHERE phone_device_id = ?');
  const listStmt = db.prepare('SELECT * FROM root_mapping ORDER BY created_at DESC');

  return {
    create: (input) => {
      createStmt.run(
        input.mappingId,
        input.phoneDeviceId,
        input.phoneRootId ?? null,
        input.destinationRoot,
        input.destinationRelativeBase ?? '',
        input.phoneRetentionPolicy ?? null,
        input.desktopDeletionPolicy ?? null,
        input.displayName,
        input.createdAt,
        input.createdAt,
      );
    },
    getByMappingId: (mappingId) => mapRow(byMappingStmt.get(mappingId)),
    getByPhoneRoot: (phoneDeviceId, phoneRootId) =>
      mapRow(byPhoneRootStmt.get(phoneDeviceId, phoneRootId)),
    bind: (input) => {
      bindStmt.run(
        input.phoneRootId,
        input.phoneRetentionPolicy,
        input.desktopDeletionPolicy,
        input.updatedAt,
        input.mappingId,
      );
    },
    listDestinations: () =>
      destinationsStmt.all().map((raw) => {
        const r = raw as Record<string, unknown>;
        return { mappingId: asText(r.mapping_id), destinationRoot: asText(r.destination_root) };
      }),
    listByDevice: (phoneDeviceId) =>
      byDeviceStmt
        .all(phoneDeviceId)
        .map(mapRow)
        .filter((row): row is RootMappingRow => row !== null),
    list: () =>
      listStmt
        .all()
        .map(mapRow)
        .filter((row): row is RootMappingRow => row !== null),
  };
}
