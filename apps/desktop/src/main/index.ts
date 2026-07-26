import { app, BrowserWindow } from 'electron';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { startBackend, type Backend } from './backend.ts';
import { registerPairingIpc } from './ui/ipc.ts';
import { registerDestinationsIpc } from './ui/destinationsIpc.ts';
import { registerStatusIpc } from './ui/statusIpc.ts';

// A fixed high port in the IANA dynamic/private range (49152-65535) so the control server
// lands at the same address every launch. Only used when FOLDERSYNC_PORT is unset.
const DEFAULT_CONTROL_PORT = 51384;

// Electron security defaults are spec 20.1 requirements, not preferences:
// isolated, sandboxed renderer with no Node integration and no remote content.
function createWindow(): void {
  const window = new BrowserWindow({
    width: 1000,
    height: 700,
    show: false,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.on('ready-to-show', () => {
    window.show();
  });

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
  if (rendererUrl) {
    // Dev only: surface renderer console output (CSP violations, preload
    // failures) in the terminal — a blank window must never be silent.
    window.webContents.on('console-message', (event) => {
      console.log(`[renderer:${event.level}] ${event.message}`);
    });
    window.webContents.on('preload-error', (_event, preloadPath, error) => {
      console.error(`[preload-error] ${preloadPath}: ${error.message}`);
    });
    void window.loadURL(rendererUrl);
  } else {
    void window.loadFile(join(import.meta.dirname, '../renderer/index.html'));
  }
}

// The privileged backend (control server, database, discovery) lives in main; the
// renderer never gets network-server or filesystem authority (spec 20.1). All the
// wiring is in the electron-free backend module so it stays testable.
let backend: Backend | null = null;
let disposeIpc: (() => void) | null = null;

void app.whenReady().then(async () => {
  try {
    backend = await startBackend({
      userDataDir: app.getPath('userData'),
      displayName: hostname(),
      // A STABLE control-server port so the phone's stored pairing target stays valid
      // across desktop restarts (an OS-assigned port 0 moves every launch, stranding a
      // paired phone at a dead port). Overridable via FOLDERSYNC_PORT; the desktop
      // Settings port (spec 5.6) supersedes this later. Discovery-based reconnection
      // (spec 24.6) — matching the paired desktop by device id — is the eventual robust path.
      port: Number(process.env.FOLDERSYNC_PORT) || DEFAULT_CONTROL_PORT,
    });
    const disposePairing = registerPairingIpc(backend);
    const disposeDestinations = registerDestinationsIpc(backend);
    const disposeStatus = registerStatusIpc(backend);
    disposeIpc = () => {
      disposePairing();
      disposeDestinations();
      disposeStatus();
    };
    console.log(
      `[backend] control server listening on ${backend.url} (device ${backend.deviceId})`,
    );
  } catch (error) {
    console.error('[backend] failed to start', error);
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Tray/minimise behaviour is a later, explicit feature (spec 20.3); for the
// skeleton, closing the window quits.
app.on('window-all-closed', () => {
  app.quit();
});

// Stop the backend cleanly on quit so the port is released and the advert withdrawn.
app.on('will-quit', (event) => {
  if (backend === null) return;
  const stopping = backend;
  backend = null;
  disposeIpc?.();
  disposeIpc = null;
  event.preventDefault();
  void stopping.close().finally(() => {
    app.quit();
  });
});
