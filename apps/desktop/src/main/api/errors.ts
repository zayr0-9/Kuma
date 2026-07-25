import { errorResponseSchema, type ErrorResponse } from '@foldersync/contracts';
import type { ErrorCode } from '@foldersync/protocol';

// Structured control-protocol errors (spec 25.3). The code is the contract; the
// message is supplementary and must never leak internals (spec 30). Handlers and
// hooks throw ApiError; the Fastify error handler renders it into the envelope.
export interface ApiErrorOptions {
  httpStatus?: number;
  retryable?: boolean;
  details?: Record<string, unknown>;
}

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly retryable: boolean;
  readonly details: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, options: ApiErrorOptions = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.httpStatus = options.httpStatus ?? 400;
    this.retryable = options.retryable ?? false;
    this.details = options.details ?? {};
  }
}

// Builds the on-the-wire envelope and validates it against the shared schema, so a
// drift between server and contract fails loudly in tests rather than on a phone.
export function buildErrorResponse(error: ApiError, requestId: string): ErrorResponse {
  return errorResponseSchema.parse({
    error: {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      requestId,
      ...(Object.keys(error.details).length > 0 ? { details: error.details } : {}),
    },
  });
}
