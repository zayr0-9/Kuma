// The pairing IPC contract shared by the main process (which fulfils it), the
// preload bridge (which exposes it), and the renderer (which types against it).
// The presentation deliberately carries no secret: only the rendered QR image and
// the window's expiry cross into the renderer (spec 24.3/20.1).

export const PAIRING_CHANNELS = {
  start: 'pairing:start',
  cancel: 'pairing:cancel',
  // main→renderer push, fired when a phone finishes POST /v1/pair. Carries only the
  // paired device's public identity — never the issued token or the pairing secret.
  completed: 'pairing:completed',
} as const;

export interface PairingCompletedEvent {
  // The paired phone's own device id and display name (agent_design §5). Public
  // identity only; the token is returned to the phone and never crosses to the
  // renderer (spec 24.3/20.1).
  deviceId: string;
  displayName: string;
  // ISO-8601 UTC instant the pairing was recorded.
  pairedAt: string;
}

export interface PairingPresentation {
  // The desktop identity the phone will pin, shown on both sides during pairing
  // (agent_design §5). Not a secret — the public device id and display name.
  deviceId: string;
  desktopName: string;
  // A rendered QR image (PNG data URL). The raw pairing secret it encodes never
  // exists as a renderer-readable value.
  qrImageDataUrl: string;
  // ISO-8601 UTC instant the pairing window closes; the UI counts down to it.
  expiresAt: string;
}
