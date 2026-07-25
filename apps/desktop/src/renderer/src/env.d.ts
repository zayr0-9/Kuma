import type { PairingPresentation } from '../../shared/pairing.ts';

// Ambient type of the preload bridge (src/preload/index.ts). Kept in sync by hand;
// the pairing DTO comes from the shared IPC contract so there is one source of truth.
// Optional because a broken preload must degrade to a visible error, not a blank
// window.
declare global {
  interface Window {
    folderSync?: {
      runtimeVersions: {
        electron: string;
        node: string;
      };
      pairing: {
        start: () => Promise<PairingPresentation>;
        cancel: () => Promise<void>;
      };
    };
  }
}
