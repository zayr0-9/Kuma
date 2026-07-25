// Public surface of the desktop database layer (spec 21). Callers open a
// connection, then build repositories against it.
export { openDatabase, resolveDatabasePath, type Database } from './database.ts';
export { runMigrations, LATEST_SCHEMA_VERSION, type Migration } from './migrations.ts';
export { createRepositories, type Repositories } from './repositories/index.ts';
export {
  isTerminalPrepareState,
  type FilesRepository,
  type CreatePrepareInput,
  type RecordCommittedVersionInput,
} from './repositories/index.ts';
export type {
  DesktopIdentityRow,
  PairedDeviceRow,
  RootMappingRow,
  RemoteFileRow,
  RemoteFileState,
  UploadPrepareRow,
  RemoteVersionRow,
  DeletionEventRow,
  DeletionAppliedAction,
  EventLogRow,
  EventLogLevel,
} from './types.ts';
