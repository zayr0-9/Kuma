import { contextBridge, ipcRenderer } from 'electron';
import { PAIRING_CHANNELS, type PairingPresentation } from '../shared/pairing.ts';

// The renderer's entire view of the system (spec 20.1). Grows only as narrow,
// named methods — never raw ipcRenderer, never generic filesystem access, never
// secrets. ipcRenderer is used only here, inside the bridge, to back those methods.
const api = {
  runtimeVersions: {
    electron: process.versions.electron ?? 'unknown',
    node: process.versions.node,
  },
  pairing: {
    // Opens a pairing window in main and returns the rendered QR image + expiry.
    // The raw pairing secret never crosses this boundary (spec 24.3).
    start: (): Promise<PairingPresentation> => ipcRenderer.invoke(PAIRING_CHANNELS.start),
    cancel: (): Promise<void> => ipcRenderer.invoke(PAIRING_CHANNELS.cancel),
  },
} as const;

contextBridge.exposeInMainWorld('folderSync', api);

export type FolderSyncBridge = typeof api;
