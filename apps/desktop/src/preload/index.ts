import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  PAIRING_CHANNELS,
  type PairingCompletedEvent,
  type PairingPresentation,
} from '../shared/pairing.ts';
import {
  IPC_CHANNELS,
  type AddDestinationRequest,
  type AddDestinationResult,
  type DestinationSummary,
  type DeviceSummary,
  type PickFolderResult,
  type UnbindDestinationResult,
} from '../shared/destinations.ts';
import { STATUS_CHANNELS, type SyncStatusView } from '../shared/status.ts';

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
    // Subscribe to main's push when a phone pairs. The IpcRendererEvent is stripped so
    // the renderer only ever sees the public payload. Returns an unsubscribe function.
    onPaired: (listener: (event: PairingCompletedEvent) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, payload: PairingCompletedEvent): void =>
        listener(payload);
      ipcRenderer.on(PAIRING_CHANNELS.completed, handler);
      return () => ipcRenderer.removeListener(PAIRING_CHANNELS.completed, handler);
    },
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
    // Detach the phone folder from a destination so it is bindable again (spec 5.6).
    unbind: (mappingId: string): Promise<UnbindDestinationResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.destinationsUnbind, mappingId),
  },
  status: {
    // Per-destination free space, policies and pending-commit backlog (spec 25.2).
    get: (): Promise<SyncStatusView> => ipcRenderer.invoke(STATUS_CHANNELS.get),
  },
} as const;

contextBridge.exposeInMainWorld('folderSync', api);

export type FolderSyncBridge = typeof api;
