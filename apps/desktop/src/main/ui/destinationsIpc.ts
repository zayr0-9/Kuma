import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from 'electron';
import {
  IPC_CHANNELS,
  type AddDestinationRequest,
  type PickFolderResult,
} from '../../shared/destinations.ts';
import type { Backend } from '../backend.ts';
import { createDestinationsController } from './destinationsController.ts';

// The Electron glue exposing the destinations controller over the narrow, named IPC
// channels (spec 20.1). The controller is electron-free and unit-tested; only the
// native folder picker lives here. Returns a disposer that removes the handlers on
// shutdown so a restart re-registers cleanly.
export function registerDestinationsIpc(backend: Backend): () => void {
  const controller = createDestinationsController({ repositories: backend.repositories });

  ipcMain.handle(IPC_CHANNELS.devicesList, () => controller.listDevices());
  ipcMain.handle(IPC_CHANNELS.destinationsList, () => controller.listDestinations());

  ipcMain.handle(IPC_CHANNELS.destinationsPickFolder, async (): Promise<PickFolderResult> => {
    const parent = BrowserWindow.getAllWindows()[0] ?? null;
    const options: OpenDialogOptions = { properties: ['openDirectory', 'createDirectory'] };
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    const [path] = result.filePaths;
    if (result.canceled || path === undefined) return { cancelled: true };
    return { path };
  });

  ipcMain.handle(IPC_CHANNELS.destinationsAdd, (_event, request: AddDestinationRequest) =>
    controller.addDestination(request),
  );

  ipcMain.handle(IPC_CHANNELS.destinationsUnbind, (_event, mappingId: string) =>
    controller.unbindDestination(mappingId),
  );

  return () => {
    for (const channel of Object.values(IPC_CHANNELS)) ipcMain.removeHandler(channel);
  };
}
