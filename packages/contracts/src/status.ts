import { z } from 'zod';
import { protocolVersionSchema, uuidSchema } from './primitives.ts';

// GET /v1/health — unauthenticated; exposes nothing beyond protocol availability
// (spec 25.2).
export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  protocolVersion: protocolVersionSchema,
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

// GET /v1/device — authenticated identity summary.
export const deviceResponseSchema = z.object({
  deviceId: uuidSchema,
  name: z.string().min(1).max(64),
  protocolVersion: protocolVersionSchema,
});
export type DeviceResponse = z.infer<typeof deviceResponseSchema>;

// GET /v1/sync/status — mapping health, pending commits, disk-space state.
export const syncStatusResponseSchema = z.object({
  mappings: z.array(
    z.object({
      rootId: uuidSchema,
      mappingId: uuidSchema,
      destinationAvailable: z.boolean(),
      freeBytes: z.number().int().nonnegative().nullable(),
    }),
  ),
  pendingCommits: z.number().int().nonnegative(),
});
export type SyncStatusResponse = z.infer<typeof syncStatusResponseSchema>;
