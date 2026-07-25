import { z } from 'zod';
import { errorCodeSchema } from './error.ts';
import { isoDateTimeSchema, sha256HexSchema, uuidSchema } from './primitives.ts';
import { wirePathSchema } from './wirePath.ts';

// POST /v1/files/prepare (spec 25.2). Authorisation and destination mapping are
// resolved server-side from the authenticated device — never from this payload.
export const prepareUploadRequestSchema = z.object({
  requestId: uuidSchema,
  rootId: uuidSchema,
  fileEntryId: uuidSchema,
  relativePath: wirePathSchema,
  size: z.number().int().nonnegative(),
  modifiedAtMs: z.number().int().nonnegative().nullable(),
  mimeType: z.string().min(1).nullable(),
  knownRemoteVersionId: uuidSchema.nullable(),
});
export type PrepareUploadRequest = z.infer<typeof prepareUploadRequestSchema>;

export const prepareUploadResponseSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('upload'),
    prepareId: uuidSchema,
    tusEndpoint: z.string().startsWith('/'),
    expiresAt: isoDateTimeSchema,
  }),
  z.object({
    action: z.literal('skip'),
    remoteVersionId: uuidSchema,
    sha256: sha256HexSchema,
    size: z.number().int().nonnegative(),
  }),
]);
export type PrepareUploadResponse = z.infer<typeof prepareUploadResponseSchema>;

// GET /v1/files/prepare/:prepareId
export const PREPARE_STATES = [
  'prepared',
  'uploading',
  'uploaded',
  'verifying',
  'committing',
  'committed',
  'failed',
  'expired',
] as const;
export const prepareStateSchema = z.enum(PREPARE_STATES);
export type PrepareState = z.infer<typeof prepareStateSchema>;

export const prepareStatusResponseSchema = z.object({
  prepareId: uuidSchema,
  state: prepareStateSchema,
  remoteVersionId: uuidSchema.nullable(),
  sha256: sha256HexSchema.nullable(),
  errorCode: errorCodeSchema.nullable(),
});
export type PrepareStatusResponse = z.infer<typeof prepareStatusResponseSchema>;

// POST /v1/files/delete. `retention_cleanup` must never appear as a remote delete
// request (spec 6.2), so the schema admits only the user/external cause — sending
// cleanup as deletion is a protocol violation, not a server-side judgement call.
export const fileDeleteRequestSchema = z.object({
  eventId: uuidSchema,
  rootId: uuidSchema,
  fileEntryId: uuidSchema,
  relativePath: wirePathSchema,
  expectedRemoteVersionId: uuidSchema,
  cause: z.literal('user_or_external_deletion'),
});
export type FileDeleteRequest = z.infer<typeof fileDeleteRequestSchema>;

// The four outcomes of a remote delete (spec 6.4). `trashed` moved the desktop copy
// into managed trash; `preserved` kept it because the mapping's desktop policy is
// preserve_desktop_copy (spec 6.1) — the desktop is never a disposable mirror;
// `no_remote_file` had nothing committed at the path; `already_applied` is the
// idempotent replay of a prior event id. `trashPath` is relative to the destination
// root (an absolute server path is never sent to the phone — spec 30) and is null
// for every non-trashed outcome.
export const fileDeleteResponseSchema = z.object({
  eventId: uuidSchema,
  action: z.enum(['trashed', 'preserved', 'no_remote_file', 'already_applied']),
  trashPath: z.string().nullable(),
});
export type FileDeleteResponse = z.infer<typeof fileDeleteResponseSchema>;
