import { ipcMain } from 'electron';
import { STATUS_CHANNELS } from '../../shared/status.ts';
import type { Backend } from '../backend.ts';
import { createStatusController } from './statusController.ts';

// The Electron glue exposing the status controller over its narrow, named IPC channel
// (spec 20.1). The controller is electron-free and unit-tested; this only bridges it.
// Returns a disposer that removes the handler on shutdown so a restart re-registers
// cleanly.
export function registerStatusIpc(backend: Backend): () => void {
  const controller = createStatusController({ repositories: backend.repositories });

  ipcMain.handle(STATUS_CHANNELS.get, () => controller.getStatus());

  return () => {
    for (const channel of Object.values(STATUS_CHANNELS)) ipcMain.removeHandler(channel);
  };
}
