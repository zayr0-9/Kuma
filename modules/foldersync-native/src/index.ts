import { requireOptionalNativeModule } from 'expo';

// TypeScript surface of the Kotlin module (spec 13.2). This interface grows in
// lockstep with FolderSyncModule.kt; React Native asks for actions and observes
// state — it never runs the sync loop.
export interface FolderSyncNativeModule {
  ping(): string;
}

// null when the running dev client was built before this module existed —
// callers must handle it (a stale build is a normal dev-loop state, spec 32.2).
export const FolderSyncNative =
  requireOptionalNativeModule<FolderSyncNativeModule>('FolderSyncNative');
