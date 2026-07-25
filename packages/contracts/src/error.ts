import { z } from 'zod';
import { ERROR_CODES } from '@foldersync/protocol';
import { uuidSchema } from './primitives.ts';

export const errorCodeSchema = z.enum(ERROR_CODES);

// Structured error envelope (spec 25.3). Human text is supplementary; code is the contract.
export const errorResponseSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    retryable: z.boolean(),
    requestId: uuidSchema.optional(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
