// Typed wrapper around the Kotlin pinned-TLS pairing surface (spec 13, 24, 35 spike 4).
// The QR string is parsed and verified natively; the raw secret and bearer token never
// reach JS. startPairingFromQr resolves to a discriminated PairingResult.
import { requireNative } from './module.ts';
import type { PairedDevice, PairingResult } from 'foldersync-native';

export type { PairedDevice, PairingResult } from 'foldersync-native';

export function startPairingFromQr(payload: string): Promise<PairingResult> {
  return requireNative().startPairingFromQr(payload);
}

export function listPairedDevices(): Promise<PairedDevice[]> {
  return requireNative().listPairedDevices();
}

export function removePairedDevice(deviceId: string): Promise<void> {
  return requireNative().removePairedDevice(deviceId);
}
