export {
  uuidSchema,
  sha256HexSchema,
  isoDateTimeSchema,
  base64Url32Schema,
  protocolVersionSchema,
} from './primitives.ts';

export {
  PHONE_RETENTION_POLICIES,
  phoneRetentionPolicySchema,
  type PhoneRetentionPolicy,
  DESKTOP_DELETION_POLICIES,
  desktopDeletionPolicySchema,
  type DesktopDeletionPolicy,
  DELETION_CAUSES,
  deletionCauseSchema,
  type DeletionCause,
} from './policies.ts';

export {
  WIRE_PATH_SEPARATOR,
  parseWirePath,
  wirePathSchema,
  type WirePathError,
  type WirePathResult,
} from './wirePath.ts';

export { errorCodeSchema, errorResponseSchema, type ErrorResponse } from './error.ts';

export {
  pairRequestSchema,
  type PairRequest,
  pairResponseSchema,
  type PairResponse,
  PAIRING_QR_PREFIX,
  pairingQrPayloadSchema,
  type PairingQrPayload,
  buildPairingQrPayload,
  parsePairingQrPayload,
  type ParsePairingQrResult,
} from './pairing.ts';

export {
  prepareUploadRequestSchema,
  type PrepareUploadRequest,
  prepareUploadResponseSchema,
  type PrepareUploadResponse,
  PREPARE_STATES,
  prepareStateSchema,
  type PrepareState,
  prepareStatusResponseSchema,
  type PrepareStatusResponse,
  fileDeleteRequestSchema,
  type FileDeleteRequest,
  fileDeleteResponseSchema,
  type FileDeleteResponse,
} from './files.ts';

export {
  rootRegisterRequestSchema,
  type RootRegisterRequest,
  rootRegisterResponseSchema,
  type RootRegisterResponse,
  availableDestinationSchema,
  type AvailableDestination,
  rootsAvailableResponseSchema,
  type RootsAvailableResponse,
  rootUnbindRequestSchema,
  type RootUnbindRequest,
  rootUnbindResponseSchema,
  type RootUnbindResponse,
} from './roots.ts';

export {
  healthResponseSchema,
  type HealthResponse,
  deviceResponseSchema,
  type DeviceResponse,
  syncStatusResponseSchema,
  type SyncStatusResponse,
} from './status.ts';
