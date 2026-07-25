import { contextBridge, ipcRenderer } from 'electron';
import { PAIRING_CHANNELS, type PairingPresentation } from '../shared/pairing.ts';
import {
  IPC_CHANNELS,
  type AddDestinationRequest,
  type AddDestinationResult,
  type DestinationSummary,
  type DeviceSummary,
  type PickFolderResult,
} from '../shared/destinations.ts';

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
  devices: {
    list: (): Promise<DeviceSummary[]> => ipcRenderer.invoke(IPC_CHANNELS.devicesList),
  },
  destinations: {
    list: (): Promise<DestinationSummary[]> => ipcRenderer.invoke(IPC_CHANNELS.destinationsList),
    // Opens the native folder picker in main.
    pickFolder: (): Promise<PickFolderResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.destinationsPickFolder),
    add: (request: AddDestinationRequest): Promise<AddDestinationResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.destinationsAdd, request),
  },
} as const;

contextBridge.exposeInMainWorld('folderSync', api);

export type FolderSyncBridge = typeof api;
