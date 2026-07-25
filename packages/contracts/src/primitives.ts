import { z } from 'zod';

export const uuidSchema = z.uuid();

export const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/, 'lowercase sha-256 hex');

export const isoDateTimeSchema = z.iso.datetime();

// 32 bytes, base64url without padding (TLS SPKI pins, pairing secrets)
export const base64Url32Schema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/, '32 bytes as unpadded base64url');

export const protocolVersionSchema = z.number().int().positive();
