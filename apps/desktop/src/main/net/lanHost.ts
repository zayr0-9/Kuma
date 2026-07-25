import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';

// The LAN address embedded in the pairing QR (spec 24.3) as the phone's initial
// hint. Identity is the pinned public key, not the address (spec 24.4), so this is
// only a starting point — mDNS re-discovers the desktop if the address changes.
// The first non-internal IPv4 wins; loopback is the fallback when the host is
// offline (the QR still renders, and pairing just waits for a network).
export function resolveLanHost(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces(),
): string {
  for (const infos of Object.values(interfaces)) {
    for (const info of infos ?? []) {
      if (!info.internal && info.family === 'IPv4') return info.address;
    }
  }
  return '127.0.0.1';
}
