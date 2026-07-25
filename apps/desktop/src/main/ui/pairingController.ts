import type { PairingWindow } from '../auth/pairingWindow.ts';
import type { PairingPresentation } from '../../shared/pairing.ts';
import { renderPairingQr, type RenderedPairingQr } from './pairingQr.ts';

// Orchestrates a desktop-initiated pairing session with no Electron dependency, so
// the security-critical invariant — the raw secret never leaves the main process —
// is unit-tested. It opens the pairing window, renders the QR from the freshly minted
// secret, and returns only the image + expiry for the renderer (spec 24.3/20.1).

export interface PairingIdentity {
  deviceId: string;
  spkiSha256: string;
  displayName: string;
}

export interface PairingEndpoint {
  host: string;
  port: number;
}

export type RenderPairingQrFn = (input: {
  deviceId: string;
  spkiSha256: string;
  host: string;
  port: number;
  secret: string;
}) => Promise<RenderedPairingQr>;

export interface PairingControllerDeps {
  pairingWindow: PairingWindow;
  identity: PairingIdentity;
  endpoint: PairingEndpoint;
  // Injectable so tests can capture the secret handed to the QR path without a real
  // encoder; defaults to the production PNG renderer.
  renderQr?: RenderPairingQrFn;
}

export interface PairingController {
  start(): Promise<PairingPresentation>;
  cancel(): void;
}

export function createPairingController(deps: PairingControllerDeps): PairingController {
  const renderQr = deps.renderQr ?? renderPairingQr;
  const { pairingWindow, identity, endpoint } = deps;

  return {
    start: async () => {
      const { secret, expiresAt } = pairingWindow.open();
      const { imageDataUrl } = await renderQr({
        deviceId: identity.deviceId,
        spkiSha256: identity.spkiSha256,
        host: endpoint.host,
        port: endpoint.port,
        secret,
      });
      // The returned shape carries no secret and no payload — only what the renderer
      // is permitted to hold.
      return {
        deviceId: identity.deviceId,
        desktopName: identity.displayName,
        qrImageDataUrl: imageDataUrl,
        expiresAt: expiresAt.toISOString(),
      };
    },
    cancel: () => {
      pairingWindow.close();
    },
  };
}
