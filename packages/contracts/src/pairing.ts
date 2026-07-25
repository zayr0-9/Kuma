import { z } from 'zod';
import { base64Url32Schema, protocolVersionSchema, uuidSchema } from './primitives.ts';

// POST /v1/pair (spec 24.5). Only valid during an open pairing window; the secret
// is one-time and never logged.
export const pairRequestSchema = z.object({
  secret: base64Url32Schema,
  deviceId: uuidSchema,
  deviceName: z.string().min(1).max(64),
  supportedProtocolVersions: z.array(protocolVersionSchema).min(1),
});
export type PairRequest = z.infer<typeof pairRequestSchema>;

export const pairResponseSchema = z.object({
  deviceToken: z.string().min(32),
  desktopDeviceId: uuidSchema,
  desktopName: z.string().min(1).max(64),
  protocolVersion: protocolVersionSchema,
});
export type PairResponse = z.infer<typeof pairResponseSchema>;

// QR payload (spec 24.3): foldersync://pair?v=1&device=..&host=..&port=..&pin=..&secret=..
// Built by the desktop (in the Electron main process), parsed by the phone. The
// Kotlin parser is held to this grammar by the pairing-qr fixtures.
export const PAIRING_QR_PREFIX = 'foldersync://pair?';

export const pairingQrPayloadSchema = z.object({
  version: protocolVersionSchema,
  deviceId: uuidSchema,
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  pin: base64Url32Schema,
  secret: base64Url32Schema,
});
export type PairingQrPayload = z.infer<typeof pairingQrPayloadSchema>;

export function buildPairingQrPayload(payload: PairingQrPayload): string {
  const query = new URLSearchParams({
    v: String(payload.version),
    device: payload.deviceId,
    host: payload.host,
    port: String(payload.port),
    pin: payload.pin,
    secret: payload.secret,
  });
  return `${PAIRING_QR_PREFIX}${query.toString()}`;
}

export type ParsePairingQrResult =
  | { ok: true; payload: PairingQrPayload }
  | { ok: false; reason: 'wrong_scheme' | 'invalid_fields' };

export function parsePairingQrPayload(raw: string): ParsePairingQrResult {
  if (!raw.startsWith(PAIRING_QR_PREFIX)) return { ok: false, reason: 'wrong_scheme' };
  const query = new URLSearchParams(raw.slice(PAIRING_QR_PREFIX.length));
  const result = pairingQrPayloadSchema.safeParse({
    version: Number(query.get('v')),
    deviceId: query.get('device'),
    host: query.get('host'),
    port: Number(query.get('port')),
    pin: query.get('pin'),
    secret: query.get('secret'),
  });
  return result.success
    ? { ok: true, payload: result.data }
    : { ok: false, reason: 'invalid_fields' };
}
