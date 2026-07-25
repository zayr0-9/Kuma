import type { ReactElement } from 'react';

export function App(): ReactElement {
  const { electron, node } = window.folderSync.runtimeVersions;

  return (
    <main>
      <h1>FolderSync companion</h1>
      <p>
        Skeleton build — Electron {electron}, Node {node}.
      </p>
      <p>Pairing, destinations and history arrive with the next phases.</p>
    </main>
  );
}
