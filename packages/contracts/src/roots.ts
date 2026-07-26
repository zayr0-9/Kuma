import { z } from 'zod';
import { desktopDeletionPolicySchema, phoneRetentionPolicySchema } from './policies.ts';
import { uuidSchema } from './primitives.ts';

// POST /v1/roots/register (spec 25.2). The phone references a mapping approved in
// the desktop UI — it can never send an absolute destination path. Registration
// is rejected with `destination_overlap` when destinations nest (spec 12.5).
export const rootRegisterRequestSchema = z.object({
  requestId: uuidSchema,
  rootId: uuidSchema,
  mappingId: uuidSchema,
  displayName: z.string().min(1).max(128),
  phoneRetentionPolicy: phoneRetentionPolicySchema,
  desktopDeletionPolicy: desktopDeletionPolicySchema,
});
export type RootRegisterRequest = z.infer<typeof rootRegisterRequestSchema>;

export const rootRegisterResponseSchema = z.object({
  rootId: uuidSchema,
  mappingId: uuidSchema,
  status: z.literal('registered'),
});
export type RootRegisterResponse = z.infer<typeof rootRegisterResponseSchema>;

// GET /v1/roots/available (spec 5.1 step 10, 5.5 "Add/edit folder … sets destination
// mapping"). The phone must see which desktop-approved destinations it can bind before
// calling register — it references a mappingId, never an absolute path. Only the calling
// device's *unbound* mappings are returned; an absolute destination path is never sent
// (spec 30), only a display name and the volume's free space.
export const availableDestinationSchema = z.object({
  mappingId: uuidSchema,
  displayName: z.string().min(1).max(128),
  destinationAvailable: z.boolean(),
  freeBytes: z.number().int().nonnegative().nullable(),
});
export type AvailableDestination = z.infer<typeof availableDestinationSchema>;

export const rootsAvailableResponseSchema = z.object({
  destinations: z.array(availableDestinationSchema),
});
export type RootsAvailableResponse = z.infer<typeof rootsAvailableResponseSchema>;

// POST /v1/roots/unbind (spec 25.1). Detaches the phone root from a mapping so the desktop
// destination returns to `/v1/roots/available` and can be re-bound — the phone calls this when
// it forgets a folder, which is what lets a destination be reused instead of stranded. Only the
// mappingId is referenced; the desktop copies already made are untouched. Idempotent: unbinding
// an already-unbound mapping succeeds.
export const rootUnbindRequestSchema = z.object({
  requestId: uuidSchema,
  mappingId: uuidSchema,
});
export type RootUnbindRequest = z.infer<typeof rootUnbindRequestSchema>;

export const rootUnbindResponseSchema = z.object({
  mappingId: uuidSchema,
  status: z.literal('unbound'),
});
export type RootUnbindResponse = z.infer<typeof rootUnbindResponseSchema>;
