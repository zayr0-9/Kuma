import type { ReactElement } from 'react';

export function App(): ReactElement {
  // Defensive: if the preload bridge failed to load, say so instead of
  // crashing before first paint (a blank window is undebuggable for users).
  const runtime = window.folderSync?.runtimeVersions;

  return (
    <main>
      <h1>FolderSync companion</h1>
      {runtime ? (
        <p>
          Skeleton build — Electron {runtime.electron}, Node {runtime.node}.
        </p>
      ) : (
        <p>Preload bridge unavailable — this is a bug, check the main-process logs.</p>
      )}
      <p>Pairing, destinations and history arrive with the next phases.</p>
    </main>
  );
}
