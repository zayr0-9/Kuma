// Ambient type of the preload bridge (src/preload/index.ts). Kept in sync by
// hand for now; the bridge is intentionally tiny. Optional because a broken
// preload must degrade to a visible error, not a blank window.
interface Window {
  folderSync?: {
    runtimeVersions: {
      electron: string;
      node: string;
    };
  };
}
