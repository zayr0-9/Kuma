import { getResponder } from '@homebridge/ciao';
import { PROTOCOL_VERSION, TXT_KEYS } from '@foldersync/protocol';

// DNS-SD advertisement (spec 23.1): `<displayName>._foldersync._tcp.local`.
// TXT carries only the four public keys — never tokens, secrets, paths or
// personal metadata beyond the chosen display name.
export interface AdvertisementConfig {
  deviceId: string;
  displayName: string;
  port: number;
}

export interface Advertiser {
  stop(): Promise<void>;
}

export async function startAdvertising(config: AdvertisementConfig): Promise<Advertiser> {
  const responder = getResponder();
  const service = responder.createService({
    name: config.displayName,
    type: 'foldersync',
    port: config.port,
    txt: {
      [TXT_KEYS.version]: String(PROTOCOL_VERSION),
      [TXT_KEYS.deviceId]: config.deviceId,
      [TXT_KEYS.displayName]: config.displayName,
      [TXT_KEYS.tls]: '1',
    },
  });

  await service.advertise();

  return {
    async stop(): Promise<void> {
      await service.end();
      await responder.shutdown();
    },
  };
}
