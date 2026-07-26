// The devices + destinations IPC contract shared by the main process (which fulfils
// it), the preload bridge (which exposes it), and the renderer (which types against
// it). A destination is a root_mapping row the desktop creates for a paired phone
// (spec 25.2); the phone later binds one of its folders to it via /v1/roots/register.

export const IPC_CHANNELS = {
  devicesList: 'devices:list',
  destinationsList: 'destinations:list',
  destinationsPickFolder: 'destinations:pickFolder',
  destinationsAdd: 'destinations:add',
  destinationsUnbind: 'destinations:unbind',
} as const;

export interface DeviceSummary {
  deviceId: string;
  displayName: string;
  pairedAt: string;
  lastSeenAt: string | null;
}

export interface DestinationSummary {
  mappingId: string;
  phoneDeviceId: string;
  destinationRoot: string;
  displayName: string;
  // True once a phone folder has registered against this mapping (spec 25.2).
  bound: boolean;
}

export interface AddDestinationRequest {
  phoneDeviceId: string;
  // An absolute desktop path chosen via the native folder picker.
  destinationRoot: string;
  // Optional friendly name; the folder's basename is used when omitted.
  displayName?: string;
}

export type AddDestinationResult =
  | { outcome: 'created'; destination: DestinationSummary }
  // The chosen folder equals, contains, or sits inside an existing destination
  // (spec 12.5) — never silently share a directory between mappings.
  | { outcome: 'overlap'; conflictingMappingId: string }
  | { outcome: 'unknown_device' }
  | { outcome: 'invalid_destination' };

export type PickFolderResult = { path: string } | { cancelled: true };

// Detach the phone folder from a destination (spec 5.6 "destination mappings and
// revocation"): the mapping stays and its desktop files are untouched, but it returns to
// "Waiting for a phone folder" and can be re-bound. Idempotent — unbinding an already-unbound
// destination still reports `unbound`; only an unknown mapping is `not_found`.
export type UnbindDestinationResult = { outcome: 'unbound' } | { outcome: 'not_found' };
