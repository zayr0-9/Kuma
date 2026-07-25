import type { ReactElement } from 'react';
import { PairingPanel } from './PairingPanel.tsx';

export function App(): ReactElement {
  // Defensive: if the preload bridge failed to load, say so instead of
  // crashing before first paint (a blank window is undebuggable for users).
  const runtime = window.folderSync?.runtimeVersions;

  return (
    <main>
      <h1>FolderSync companion</h1>
      {runtime ? (
        <PairingPanel />
      ) : (
        <p>Preload bridge unavailable — this is a bug, check the main-process logs.</p>
      )}
      <p>Destinations and history arrive with the next phases.</p>
    </main>
  );
}
