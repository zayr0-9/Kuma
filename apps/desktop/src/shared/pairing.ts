// The pairing IPC contract shared by the main process (which fulfils it), the
// preload bridge (which exposes it), and the renderer (which types against it).
// The presentation deliberately carries no secret: only the rendered QR image and
// the window's expiry cross into the renderer (spec 24.3/20.1).

export const PAIRING_CHANNELS = {
  start: 'pairing:start',
  cancel: 'pairing:cancel',
} as const;

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
