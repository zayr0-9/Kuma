// Ambient type of the preload bridge (src/preload/index.ts). Kept in sync by
// hand for now; the bridge is intentionally tiny.
interface Window {
  folderSync: {
    runtimeVersions: {
      electron: string;
      node: string;
    };
  };
}
