import type { PairingPresentation } from '../../shared/pairing.ts';
import type {
  AddDestinationRequest,
  AddDestinationResult,
  DestinationSummary,
  DeviceSummary,
  PickFolderResult,
} from '../../shared/destinations.ts';

// Ambient type of the preload bridge (src/preload/index.ts). Kept in sync by hand;
// the DTOs come from the shared IPC contracts so there is one source of truth.
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
      devices: {
        list: () => Promise<DeviceSummary[]>;
      };
      destinations: {
        list: () => Promise<DestinationSummary[]>;
        pickFolder: () => Promise<PickFolderResult>;
        add: (request: AddDestinationRequest) => Promise<AddDestinationResult>;
      };
    };
  }
}
