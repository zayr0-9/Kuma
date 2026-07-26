// Structured error codes of the control protocol (spec 25.3). New codes are added
// here and to the spec list in the same PR.
export const ERROR_CODES = [
  'bad_request',
  'unauthorised',
  'protocol_version_unsupported',
  'pairing_expired',
  'root_not_mapped',
  'invalid_relative_path',
  'path_collision',
  'destination_overlap',
  'insufficient_space',
  'source_changed',
  'remote_version_conflict',
  'upload_not_found',
  'upload_expired',
  'file_not_found',
  'destination_unavailable',
  'internal_error',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
