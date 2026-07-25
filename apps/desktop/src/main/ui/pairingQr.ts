import { toDataURL } from 'qrcode';
import { buildPairingQrPayload, type PairingQrPayload } from '@foldersync/contracts';
import { PROTOCOL_VERSION } from '@foldersync/protocol';

// Renders the pairing QR entirely in the main process (spec 24.3): the payload
// string — which encodes the one-time secret and the SPKI pin — is turned into a PNG
// data URL here, so only the image ever crosses to the renderer. The payload is
// returned alongside for the caller's internal use only and is never logged.

export interface RenderPairingQrInput {
  deviceId: string;
  // The desktop SPKI pin the phone will trust (base64url SHA-256).
  spkiSha256: string;
  host: string;
  port: number;
  // The pairing window's one-time secret (base64url).
  secret: string;
}

export interface RenderedPairingQr {
  payload: string;
  imageDataUrl: string;
}

export async function renderPairingQr(input: RenderPairingQrInput): Promise<RenderedPairingQr> {
  const qr: PairingQrPayload = {
    version: PROTOCOL_VERSION,
    deviceId: input.deviceId,
    host: input.host,
    port: input.port,
    pin: input.spkiSha256,
    secret: input.secret,
  };
  const payload = buildPairingQrPayload(qr);
  // 'M' error correction balances module density against camera robustness for a
  // payload of this size.
  const imageDataUrl = await toDataURL(payload, { errorCorrectionLevel: 'M' });
  return { payload, imageDataUrl };
}
