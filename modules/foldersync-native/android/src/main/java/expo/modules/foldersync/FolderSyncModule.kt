package expo.modules.foldersync

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Skeleton of the native module boundary (spec 13). The real surface —
// pickDirectory, roots, service control, transfers, pairing — lands with the
// spikes; the JS runtime never runs the sync engine itself.
class FolderSyncModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("FolderSyncNative")

    Function("ping") {
      "pong"
    }
  }
}
