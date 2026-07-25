import { describe, expect, it } from 'vitest';
import { parsePairingQrPayload } from '@foldersync/contracts';
import { renderPairingQr } from '../src/main/ui/pairingQr.ts';

// The QR is rendered in main (spec 24.3): the encoded payload must round-trip through
// the phone-side parser, and the image must be a self-contained PNG data URL.

const DEVICE = '11111111-2222-4333-8444-555555555555';
const PIN = 'A'.repeat(43); // base64url32 shape
const SECRET = 'B'.repeat(43);

describe('renderPairingQr', () => {
  it('encodes a payload the phone parser accepts, carrying pin/secret/host/port', async () => {
    const { payload, imageDataUrl } = await renderPairingQr({
      deviceId: DEVICE,
      spkiSha256: PIN,
      host: '192.168.1.42',
      port: 8443,
      secret: SECRET,
    });

    const parsed = parsePairingQrPayload(payload);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('expected a parseable payload');
    expect(parsed.payload).toEqual({
      version: 1,
      deviceId: DEVICE,
      host: '192.168.1.42',
      port: 8443,
      pin: PIN,
      secret: SECRET,
    });

    expect(imageDataUrl.startsWith('data:image/png;base64,')).toBe(true);
    expect(imageDataUrl.length).toBeGreaterThan(100);
  });
});
