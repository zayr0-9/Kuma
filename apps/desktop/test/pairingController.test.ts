import { describe, expect, it } from 'vitest';
import { createPairingController } from '../src/main/ui/pairingController.ts';
import { createPairingWindow } from '../src/main/auth/pairingWindow.ts';

// The security-critical invariant (spec 24.3/20.1): the QR path receives the freshly
// minted one-time secret, but the presentation returned to the renderer carries only
// the image + expiry — never the secret or the raw payload.

const IDENTITY = {
  deviceId: '11111111-2222-4333-8444-555555555555',
  spkiSha256: 'A'.repeat(43),
  displayName: 'Karn-PC',
};
const ENDPOINT = { host: '192.168.1.42', port: 8443 };
const CLOCK = '2026-07-25T12:00:00.000Z';

describe('createPairingController', () => {
  it('hands the secret to the QR path but never to the renderer presentation', async () => {
    let capturedSecret: string | null = null;
    const pairingWindow = createPairingWindow({
      now: () => new Date(CLOCK),
      generateSecret: () => 'B'.repeat(43),
    });
    const controller = createPairingController({
      pairingWindow,
      identity: IDENTITY,
      endpoint: ENDPOINT,
      renderQr: (input) => {
        capturedSecret = input.secret;
        return Promise.resolve({ payload: 'internal', imageDataUrl: 'data:image/png;base64,ZZ' });
      },
    });

    const presentation = await controller.start();

    expect(capturedSecret).toBe('B'.repeat(43));
    expect(presentation).toEqual({
      deviceId: IDENTITY.deviceId,
      desktopName: 'Karn-PC',
      qrImageDataUrl: 'data:image/png;base64,ZZ',
      expiresAt: '2026-07-25T12:05:00.000Z',
    });
    expect(Object.keys(presentation)).not.toContain('secret');
    expect(JSON.stringify(presentation)).not.toContain('B'.repeat(43));
  });

  it('mints a new secret each time pairing starts', async () => {
    let n = 0;
    const pairingWindow = createPairingWindow({ generateSecret: () => `secret-${(n += 1)}` });
    const captured: string[] = [];
    const controller = createPairingController({
      pairingWindow,
      identity: IDENTITY,
      endpoint: ENDPOINT,
      renderQr: (input) => {
        captured.push(input.secret);
        return Promise.resolve({ payload: '', imageDataUrl: '' });
      },
    });

    await controller.start();
    await controller.start();
    expect(captured).toEqual(['secret-1', 'secret-2']);
  });

  it('cancel closes the pairing window', async () => {
    const pairingWindow = createPairingWindow({});
    const controller = createPairingController({
      pairingWindow,
      identity: IDENTITY,
      endpoint: ENDPOINT,
      renderQr: () => Promise.resolve({ payload: '', imageDataUrl: '' }),
    });

    await controller.start();
    expect(pairingWindow.isOpen()).toBe(true);
    controller.cancel();
    expect(pairingWindow.isOpen()).toBe(false);
  });
});
