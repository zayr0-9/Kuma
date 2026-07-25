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
