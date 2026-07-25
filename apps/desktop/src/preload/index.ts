import { contextBridge } from 'electron';

// The renderer's entire view of the system (spec 20.1). Grows only as narrow,
// named methods — never ipcRenderer, never generic filesystem access, never
// secrets.
const api = {
  runtimeVersions: {
    electron: process.versions.electron ?? 'unknown',
    node: process.versions.node,
  },
} as const;

contextBridge.exposeInMainWorld('folderSync', api);

export type FolderSyncBridge = typeof api;
