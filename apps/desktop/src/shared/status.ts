import type { DesktopDeletionPolicy, PhoneRetentionPolicy } from '@foldersync/contracts';

// The sync-status IPC contract shared by the main process (which fulfils it), the
// preload bridge (which exposes it), and the renderer (which types against it). This
// is the desktop's own management view of every destination (agent_design §5) — richer
// than the phone-facing GET /v1/sync/status, which is scoped to one device and omits
// unbound mappings. Here every destination is reported by mappingId, bound or not, so
// the destination card can show free space before a phone links a folder.

export const STATUS_CHANNELS = {
  get: 'status:get',
} as const;

export interface DestinationStatus {
  mappingId: string;
  // False when the destination volume is unplugged or unreadable (statfs failed) —
  // a "Needs attention" state, never implied data loss (agent_design §2/§3).
  destinationAvailable: boolean;
  // Free bytes on the destination volume; null when unavailable.
  freeBytes: number | null;
  // The two independent policies (spec 6.1), null until the phone binds a folder.
  phoneRetentionPolicy: PhoneRetentionPolicy | null;
  desktopDeletionPolicy: DesktopDeletionPolicy | null;
  // Uploads that finished transferring but are not yet committed for this destination
  // (0 for an unbound destination — prepares only exist for a bound root).
  pendingCommits: number;
}

export interface SyncStatusView {
  destinations: DestinationStatus[];
  // The commit backlog across every destination (spec 25.2) — the top-line total.
  pendingCommits: number;
}
