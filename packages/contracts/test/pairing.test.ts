import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildPairingQrPayload,
  parsePairingQrPayload,
  type PairingQrPayload,
} from '../src/index.ts';

const DIR = join(import.meta.dirname, '../../test-fixtures/fixtures/pairing-qr');

const golden = JSON.parse(readFileSync(join(DIR, 'valid-basic.json'), 'utf8')) as {
  payload: string;
  parsed: PairingQrPayload;
};
const wrongScheme = JSON.parse(readFileSync(join(DIR, 'invalid-wrong-scheme.json'), 'utf8')) as {
  payload: string;
};

describe('pairing QR payload', () => {
  it('parses the golden payload', () => {
    expect(parsePairingQrPayload(golden.payload)).toEqual({ ok: true, payload: golden.parsed });
  });

  it('round-trips build -> parse byte-identically', () => {
    expect(buildPairingQrPayload(golden.parsed)).toBe(golden.payload);
  });

  it('rejects a wrong scheme', () => {
    expect(parsePairingQrPayload(wrongScheme.payload)).toEqual({
      ok: false,
      reason: 'wrong_scheme',
    });
  });

  it('rejects tampered fields', () => {
    const badPort = golden.payload.replace('port=53817', 'port=999999');
    expect(parsePairingQrPayload(badPort)).toEqual({ ok: false, reason: 'invalid_fields' });

    const badPin = golden.payload.replace(/pin=[^&]+/, 'pin=short');
    expect(parsePairingQrPayload(badPin)).toEqual({ ok: false, reason: 'invalid_fields' });

    const missingSecret = golden.payload.replace(/&secret=[^&]+/, '');
    expect(parsePairingQrPayload(missingSecret)).toEqual({ ok: false, reason: 'invalid_fields' });
  });
});
