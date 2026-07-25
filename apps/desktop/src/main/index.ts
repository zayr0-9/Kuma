import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';

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
    void window.loadURL(rendererUrl);
  } else {
    void window.loadFile(join(import.meta.dirname, '../renderer/index.html'));
  }
}

void app.whenReady().then(() => {
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
