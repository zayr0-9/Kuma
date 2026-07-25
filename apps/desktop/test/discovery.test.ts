import Bonjour from 'bonjour-service';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { startAdvertising, type Advertiser } from '../src/main/discovery/advertise.ts';

// Spike 3, desktop half: prove real DNS-SD advertisement on this machine using
// an independent implementation (bonjour-service) as the browser. The Android
// NsdManager half runs on the phone once the dev client exists.

interface DiscoveredService {
  port: number;
  txt: Record<string, string>;
}

// bonjour-service types `txt` as any; narrow it instead of trusting it
function asTxtRecord(value: unknown): Record<string, string> {
  const record: Record<string, string> = {};
  if (typeof value === 'object' && value !== null) {
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry === 'string') record[key] = entry;
    }
  }
  return record;
}

let advertiser: Advertiser | null = null;
let browser: Bonjour | null = null;

afterEach(async () => {
  browser?.destroy();
  browser = null;
  await advertiser?.stop();
  advertiser = null;
});

describe('DNS-SD advertisement', () => {
  it('is discoverable as _foldersync._tcp with only the public TXT keys', async () => {
    const deviceId = randomUUID();
    advertiser = await startAdvertising({
      deviceId,
      displayName: 'SpikeThree',
      port: 53817,
    });

    browser = new Bonjour();
    const bonjour = browser;
    const found = await new Promise<DiscoveredService>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('discovery timed out')), 15_000);
      bonjour.find({ type: 'foldersync' }, (service) => {
        const txt = asTxtRecord(service.txt);
        if (txt['id'] === deviceId) {
          clearTimeout(timer);
          resolve({ port: service.port, txt });
        }
      });
    });

    expect(found.port).toBe(53817);
    expect(found.txt).toEqual({
      v: '1',
      id: deviceId,
      name: 'SpikeThree',
      tls: '1',
    });
    // spec 23.1: nothing beyond these keys may ever be advertised
    expect(Object.keys(found.txt).sort()).toEqual(['id', 'name', 'tls', 'v']);
  }, 20_000);
});
