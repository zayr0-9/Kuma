import type { ReactElement } from 'react';
import { PairingPanel } from './PairingPanel.tsx';
import { DestinationsPanel } from './DestinationsPanel.tsx';

export function App(): ReactElement {
  // Defensive: if the preload bridge failed to load, say so instead of
  // crashing before first paint (a blank window is undebuggable for users).
  const runtime = window.folderSync?.runtimeVersions;

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1 className="display">FolderSync</h1>
        <p className="body muted">
          Desktop companion — receive backups from your paired phones over your Wi‑Fi network.
        </p>
      </header>
      {runtime ? (
        <>
          <PairingPanel />
          <DestinationsPanel />
        </>
      ) : (
        <div className="card alert alert--danger">
          <span className="body">
            Preload bridge unavailable — this is a bug, check the main-process logs.
          </span>
        </div>
      )}
    </div>
  );
}
