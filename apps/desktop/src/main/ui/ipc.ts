import { BrowserWindow, ipcMain } from 'electron';
import { PAIRING_CHANNELS } from '../../shared/pairing.ts';
import type { Backend } from '../backend.ts';
import { resolveLanHost } from '../net/lanHost.ts';
import { createPairingController } from './pairingController.ts';

// The Electron glue that exposes the pairing controller to the renderer over the
// narrow, named IPC channels (spec 20.1). The controller and QR rendering are
// electron-free and unit-tested; this file only binds them to ipcMain. Returns a
// disposer that removes the handlers on shutdown so a restart re-registers cleanly.
export function registerPairingIpc(backend: Backend): () => void {
  const controller = createPairingController({
    pairingWindow: backend.pairingWindow,
    identity: {
      deviceId: backend.deviceId,
      spkiSha256: backend.spkiSha256,
      displayName: backend.displayName,
    },
    endpoint: { host: resolveLanHost(), port: backend.port },
  });

  ipcMain.handle(PAIRING_CHANNELS.start, () => controller.start());
  ipcMain.handle(PAIRING_CHANNELS.cancel, () => {
    controller.cancel();
  });

  // Push a completed pairing to every open window so the pairing panel can show
  // success and the destinations panel can refresh without the manual button.
  const unsubscribe = backend.onPairingComplete((event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(PAIRING_CHANNELS.completed, event);
    }
  });

  return () => {
    unsubscribe();
    ipcMain.removeHandler(PAIRING_CHANNELS.start);
    ipcMain.removeHandler(PAIRING_CHANNELS.cancel);
  };
}
