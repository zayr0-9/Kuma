// DNS-SD/mDNS advertisement (spec 23.1). TXT records stay small and never carry
// tokens, secrets, paths, or personal metadata.
export const DNSSD_SERVICE_TYPE = '_foldersync._tcp';

export const TXT_KEYS = {
  version: 'v',
  deviceId: 'id',
  displayName: 'name',
  tls: 'tls',
} as const;
