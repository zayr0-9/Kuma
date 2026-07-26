import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  deviceResponseSchema,
  fileDeleteRequestSchema,
  fileDeleteResponseSchema,
  healthResponseSchema,
  pairRequestSchema,
  pairResponseSchema,
  prepareStatusResponseSchema,
  prepareUploadRequestSchema,
  prepareUploadResponseSchema,
  rootRegisterRequestSchema,
  rootRegisterResponseSchema,
  rootsAvailableResponseSchema,
  rootUnbindRequestSchema,
  rootUnbindResponseSchema,
  syncStatusResponseSchema,
  uuidSchema,
} from '@foldersync/contracts';
import {
  ENDPOINTS,
  HEADER_PROTOCOL,
  HEADER_REQUEST_ID,
  PROTOCOL_VERSION,
} from '@foldersync/protocol';
import {
  isTerminalPrepareState,
  type PairedDeviceRow,
  type Repositories,
  type RootMappingRow,
} from '../db/index.ts';
import type { PairingWindow } from '../auth/pairingWindow.ts';
import type { PairingCompletedEvent } from '../../shared/pairing.ts';
import type { CommitCoordinator } from '../sync/commitCoordinator.ts';
import { generateBearerToken, hashToken } from '../auth/token.ts';
import { createDeleteService } from '../sync/deleteService.ts';
import { freeBytesOnVolume } from '../storage/diskSpace.ts';
import { findDestinationOverlap } from '../storage/destinationOverlap.ts';
import { isReservedRelativePath } from '../storage/layout.ts';
import { resolveDestinationPath } from '../storage/pathSafety.ts';
import { ApiError, buildErrorResponse } from './errors.ts';
import { registerUploadRoutes } from './uploadRouting.ts';

// The desktop control API (spec 25) served over TLS on the pinned desktop identity
// (spec 24). This slice establishes the server and its cross-cutting middleware —
// request-id, protocol-version gate, bearer auth, structured errors — plus the two
// simplest endpoints (health, device). Pairing, roots, prepare and the tus mount
// attach to this same instance in later slices.

declare module 'fastify' {
  interface FastifyRequest {
    requestId: string;
    pairedDevice: PairedDeviceRow | null;
  }
}

export interface ControlServerContext {
  // PEM key/cert of the desktop identity (spec 24.2). The phone pins this cert.
  tls: { key: string; cert: string };
  // Authenticated identity summary returned by GET /v1/device, and the desktop
  // identity echoed in the pairing response.
  identity: { deviceId: string; name: string };
  repositories: Repositories;
  // Managed by the main process; POST /v1/pair consumes its one-time secret.
  pairingWindow: PairingWindow;
  // Notified after a phone successfully pairs, so the main process can push the news
  // to the renderer (retiring the manual Refresh). Fired only on success, with the
  // paired device's public identity — never the token or secret.
  onPairingComplete?: (event: PairingCompletedEvent) => void;
  // Free bytes available on a destination volume, used by the prepare disk-space
  // gate (spec 22.2). Injectable so insufficient_space is deterministic in tests;
  // defaults to statfs on the destination root.
  freeSpace?: (path: string) => Promise<number>;
  // Drives the commit pipeline when an upload finishes (spec 18.5). Optional: without
  // it a finished upload rests in the `uploaded` state (the tus-fold behaviour); the
  // main process supplies one so uploads become visible.
  commitCoordinator?: CommitCoordinator;
  // Injectable clock so last-seen and pairing timestamps are deterministic in tests.
  now?: () => Date;
}

// spec 22.3: prepares (and their tus uploads) live seven days so a multi-GB
// transfer can resume across days of flaky Wi-Fi.
const PREPARE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Headroom required beyond the file bytes themselves before accepting an upload
// (spec 22.2) — covers metadata and a small margin against a full volume.
const DISK_SPACE_SAFETY_MARGIN = 64 * 1024 * 1024;

// Routes reachable without a bearer token (spec 25.2): health, and pair (the phone
// has no token yet — it authenticates with the one-time secret in the body).
const PUBLIC_ROUTES = new Set<string>([ENDPOINTS.health, ENDPOINTS.pair]);

function parseBearerToken(header: unknown): string | null {
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1] ?? null;
}

// The response requestId must be a uuid or absent (spec 25.3 schema). A client
// request-id that is a valid uuid is echoed; anything else gets a fresh one.
function normaliseRequestId(header: unknown): string {
  if (typeof header === 'string') {
    const parsed = uuidSchema.safeParse(header);
    if (parsed.success) return parsed.data;
  }
  return randomUUID();
}

export function createControlServer(context: ControlServerContext): FastifyInstance {
  const now = context.now ?? (() => new Date());
  const freeSpace = context.freeSpace ?? freeBytesOnVolume;
  const { repositories } = context;
  // The delete mechanics (trash move, version gate, idempotent record) live in an
  // electron-free service so they are unit-tested without HTTP; the endpoint below
  // does only auth, path safety and outcome-to-HTTP mapping.
  const deleteService = createDeleteService({ repositories, now });

  const app = Fastify({
    logger: false,
    https: { key: context.tls.key, cert: context.tls.cert },
  });

  app.decorateRequest('requestId', '');
  app.decorateRequest('pairedDevice', null);

  // onRequest runs after routing but before body parsing: a failed auth never
  // reaches a handler and never consumes a request body.
  app.addHook('onRequest', async (request, reply) => {
    const requestId = normaliseRequestId(request.headers[HEADER_REQUEST_ID]);
    request.requestId = requestId;
    void reply.header(HEADER_REQUEST_ID, requestId);

    const routeUrl = request.routeOptions.url ?? request.url;
    if (PUBLIC_ROUTES.has(routeUrl)) return;

    // Protocol version is mandatory on authenticated requests and rejected
    // explicitly when unsupported or missing (spec 24.6).
    const protocolHeader = request.headers[HEADER_PROTOCOL];
    const protocol = typeof protocolHeader === 'string' ? Number(protocolHeader) : Number.NaN;
    if (!Number.isInteger(protocol) || protocol !== PROTOCOL_VERSION) {
      throw new ApiError('protocol_version_unsupported', 'Unsupported protocol version', {
        httpStatus: 400,
      });
    }

    const token = parseBearerToken(request.headers.authorization);
    if (token === null) {
      throw new ApiError('unauthorised', 'Missing bearer token', { httpStatus: 401 });
    }
    const device = repositories.devices.findActiveByTokenHash(hashToken(token));
    if (device === null) {
      throw new ApiError('unauthorised', 'Invalid or revoked token', { httpStatus: 401 });
    }
    request.pairedDevice = device;
    repositories.devices.touchLastSeen(device.phoneDeviceId, now().toISOString());
  });

  app.setErrorHandler((error, request, reply) => {
    const requestId = request.requestId || normaliseRequestId(undefined);
    const apiError =
      error instanceof ApiError
        ? error
        : // Never surface internal error detail to the client (spec 30).
          new ApiError('internal_error', 'Internal error', { httpStatus: 500 });
    void reply.status(apiError.httpStatus).send(buildErrorResponse(apiError, requestId));
  });

  app.get(ENDPOINTS.health, () =>
    Promise.resolve(
      healthResponseSchema.parse({ status: 'ok', protocolVersion: PROTOCOL_VERSION }),
    ),
  );

  app.get(ENDPOINTS.device, () =>
    Promise.resolve(
      deviceResponseSchema.parse({
        deviceId: context.identity.deviceId,
        name: context.identity.name,
        protocolVersion: PROTOCOL_VERSION,
      }),
    ),
  );

  // POST /v1/pair (spec 24.5): available only during an open pairing window. The
  // secret is consumed only after the request is otherwise valid, so a client
  // error never burns the window. The token is returned once and stored only as a
  // hash.
  app.post(ENDPOINTS.pair, (request) => {
    const parsed = pairRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ApiError('bad_request', 'Malformed pairing request', { httpStatus: 400 });
    }
    const body = parsed.data;
    if (!body.supportedProtocolVersions.includes(PROTOCOL_VERSION)) {
      throw new ApiError('protocol_version_unsupported', 'No mutually supported protocol version', {
        httpStatus: 400,
      });
    }
    if (!context.pairingWindow.consume(body.secret)) {
      throw new ApiError('pairing_expired', 'Pairing window closed or secret invalid', {
        httpStatus: 403,
      });
    }
    const token = generateBearerToken();
    const pairedAt = now().toISOString();
    repositories.devices.recordPairing({
      phoneDeviceId: body.deviceId,
      phoneDisplayName: body.deviceName,
      tokenHash: hashToken(token),
      pairedAt,
    });
    // After the secret is consumed and the device is persisted — never on a failed
    // attempt. The token stays local to this handler; only public identity is emitted.
    context.onPairingComplete?.({
      deviceId: body.deviceId,
      displayName: body.deviceName,
      pairedAt,
    });
    return Promise.resolve(
      pairResponseSchema.parse({
        deviceToken: token,
        desktopDeviceId: context.identity.deviceId,
        desktopName: context.identity.name,
        protocolVersion: PROTOCOL_VERSION,
      }),
    );
  });

  // GET /v1/roots/available (spec 5.1 step 10): the desktop-approved destinations this
  // device may bind — its own mappings that no phone root is bound to yet ("Waiting for a
  // phone folder" in the desktop UI). The phone shows these in its Add-folder picker and
  // registers against a mappingId. An absolute destination path is never sent (spec 30);
  // an unreadable volume is reported unavailable rather than failing the whole list.
  app.get(ENDPOINTS.rootsAvailable, async (request) => {
    const device = request.pairedDevice;
    if (device === null) {
      throw new ApiError('unauthorised', 'Not authenticated', { httpStatus: 401 });
    }
    const unbound = repositories.roots
      .listByDevice(device.phoneDeviceId)
      .filter((mapping) => mapping.phoneRootId === null);

    const destinations = await Promise.all(
      unbound.map(async (mapping) => {
        try {
          return {
            mappingId: mapping.mappingId,
            displayName: mapping.displayName,
            destinationAvailable: true,
            freeBytes: await freeSpace(mapping.destinationRoot),
          };
        } catch {
          return {
            mappingId: mapping.mappingId,
            displayName: mapping.displayName,
            destinationAvailable: false,
            freeBytes: null,
          };
        }
      }),
    );

    return rootsAvailableResponseSchema.parse({ destinations });
  });

  // POST /v1/roots/register (spec 25.2): binds a phone root to a desktop-approved
  // mapping. The phone references a mappingId — it can never send an absolute
  // destination. Rejected with destination_overlap when the mapping's destination
  // nests with another (spec 12.5).
  app.post(ENDPOINTS.rootsRegister, (request) => {
    const device = request.pairedDevice;
    if (device === null) {
      throw new ApiError('unauthorised', 'Not authenticated', { httpStatus: 401 });
    }
    const parsed = rootRegisterRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ApiError('bad_request', 'Malformed root registration', { httpStatus: 400 });
    }
    const body = parsed.data;

    // The phone may only touch its own mappings (spec 25.1); an unknown or foreign
    // mapping is reported identically so existence is not leaked.
    const mapping = repositories.roots.getByMappingId(body.mappingId);
    if (mapping === null || mapping.phoneDeviceId !== device.phoneDeviceId) {
      throw new ApiError('root_not_mapped', 'Unknown mapping', { httpStatus: 404 });
    }

    // A mapping binds to one phone root and a phone root to one mapping. Re-binding
    // the same pair is the allowed "update" (spec 25.2); other re-pointing is a
    // conflict, never a silent overwrite.
    if (mapping.phoneRootId !== null && mapping.phoneRootId !== body.rootId) {
      throw new ApiError('bad_request', 'Mapping already bound to a different phone root', {
        httpStatus: 409,
      });
    }
    const existingForRoot = repositories.roots.getByPhoneRoot(device.phoneDeviceId, body.rootId);
    if (existingForRoot !== null && existingForRoot.mappingId !== body.mappingId) {
      throw new ApiError(
        'bad_request',
        'Phone root already registered to a different destination',
        {
          httpStatus: 409,
        },
      );
    }

    const overlap = findDestinationOverlap(
      mapping.destinationRoot,
      repositories.roots.listDestinations(),
      mapping.mappingId,
    );
    if (overlap !== null) {
      throw new ApiError('destination_overlap', 'Destination overlaps an existing mapping', {
        httpStatus: 409,
        details: { conflictingMappingId: overlap },
      });
    }

    repositories.roots.bind({
      mappingId: body.mappingId,
      phoneRootId: body.rootId,
      phoneRetentionPolicy: body.phoneRetentionPolicy,
      desktopDeletionPolicy: body.desktopDeletionPolicy,
      updatedAt: now().toISOString(),
    });

    return Promise.resolve(
      rootRegisterResponseSchema.parse({
        rootId: body.rootId,
        mappingId: body.mappingId,
        status: 'registered',
      }),
    );
  });

  // POST /v1/roots/unbind (spec 25.1): detaches the phone root from a mapping so the
  // destination returns to /v1/roots/available and can be re-bound. The phone calls this
  // when it forgets a folder. Idempotent — unbinding an already-unbound mapping succeeds —
  // so a retried request is safe. Only the calling device's own mapping may be touched;
  // an unknown or foreign mapping is reported identically so existence is not leaked. The
  // desktop copies already made are never removed here (that is deletion policy, spec 19).
  app.post(ENDPOINTS.rootsUnbind, (request) => {
    const device = request.pairedDevice;
    if (device === null) {
      throw new ApiError('unauthorised', 'Not authenticated', { httpStatus: 401 });
    }
    const parsed = rootUnbindRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ApiError('bad_request', 'Malformed unbind request', { httpStatus: 400 });
    }
    const { mappingId } = parsed.data;

    const mapping = repositories.roots.getByMappingId(mappingId);
    if (mapping === null || mapping.phoneDeviceId !== device.phoneDeviceId) {
      throw new ApiError('root_not_mapped', 'Unknown mapping', { httpStatus: 404 });
    }

    // Already unbound → nothing to do, but still a success (idempotent retry).
    if (mapping.phoneRootId !== null) {
      repositories.roots.unbind(mappingId, now().toISOString());
    }

    return Promise.resolve(rootUnbindResponseSchema.parse({ mappingId, status: 'unbound' }));
  });

  // POST /v1/files/prepare (spec 25.2): reserves an upload for one file, or tells
  // the phone the desktop already has this version (skip). The phone references a
  // phone rootId — the destination is resolved server-side from the bound mapping
  // and never trusted from the payload (spec 18.4). Returns the tus endpoint for
  // the bytes; the tus mount and commit pipeline attach in later slices.
  app.post(ENDPOINTS.filesPrepare, async (request) => {
    const device = request.pairedDevice;
    if (device === null) {
      throw new ApiError('unauthorised', 'Not authenticated', { httpStatus: 401 });
    }
    const parsed = prepareUploadRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ApiError('bad_request', 'Malformed prepare request', { httpStatus: 400 });
    }
    const body = parsed.data;

    // The phone's rootId is its own root id; only a bound mapping resolves it, and
    // only one owned by this device (spec 25.1). Unknown/foreign are indistinguishable.
    const mapping = repositories.roots.getByPhoneRoot(device.phoneDeviceId, body.rootId);
    if (mapping === null) {
      throw new ApiError('root_not_mapped', 'Unknown root', { httpStatus: 404 });
    }

    // Path safety (spec 22.1) before anything touches the filesystem. Any failure
    // is one code — the specific kind rides in details, never the resolved path.
    const resolved = resolveDestinationPath(mapping.destinationRoot, body.relativePath);
    if (!resolved.ok) {
      throw new ApiError('invalid_relative_path', 'Rejected relative path', {
        httpStatus: 400,
        details: { kind: resolved.error.kind },
      });
    }
    if (isReservedRelativePath(resolved.relativePath)) {
      throw new ApiError('invalid_relative_path', 'Rejected relative path', {
        httpStatus: 400,
        details: { kind: 'reserved_managed_dir' },
      });
    }
    const relativePath = resolved.relativePath;

    // Skip when the phone already knows the current committed version (spec 6.5): an
    // idempotent re-prepare needs no upload. A null/mismatched knownRemoteVersionId
    // falls through to upload; adopt-in-place then dedupes at commit time.
    const remoteFile = repositories.files.getRemoteFile(
      device.phoneDeviceId,
      body.rootId,
      relativePath,
    );
    if (
      remoteFile !== null &&
      remoteFile.state === 'committed' &&
      remoteFile.currentVersionId !== null &&
      body.knownRemoteVersionId === remoteFile.currentVersionId
    ) {
      const version = repositories.files.getRemoteVersion(remoteFile.currentVersionId);
      if (version !== null) {
        return prepareUploadResponseSchema.parse({
          action: 'skip',
          remoteVersionId: version.versionId,
          sha256: version.sha256,
          size: version.size,
        });
      }
    }

    // Disk-space gate (spec 22.2): the incoming bytes, a conflict/version copy if a
    // file already exists at the path, and a safety margin.
    const required = body.size + (remoteFile?.size ?? 0) + DISK_SPACE_SAFETY_MARGIN;
    if ((await freeSpace(mapping.destinationRoot)) < required) {
      throw new ApiError('insufficient_space', 'Not enough free space in the destination volume', {
        httpStatus: 507,
      });
    }

    // Idempotent retry: reuse the live reservation for this path rather than
    // orphaning staging with a fresh prepare id (spec 25.2).
    const nowIso = now().toISOString();
    const reusable = repositories.files.findReusablePrepare(
      device.phoneDeviceId,
      body.rootId,
      relativePath,
      nowIso,
    );
    if (reusable !== null) {
      return prepareUploadResponseSchema.parse({
        action: 'upload',
        prepareId: reusable.prepareId,
        tusEndpoint: ENDPOINTS.uploads,
        expiresAt: reusable.expiresAt,
      });
    }

    const prepareId = randomUUID();
    const expiresAt = new Date(now().getTime() + PREPARE_TTL_MS).toISOString();
    repositories.files.createPrepare({
      prepareId,
      phoneDeviceId: device.phoneDeviceId,
      rootId: body.rootId,
      fileEntryId: body.fileEntryId,
      relativePath,
      expectedSize: body.size,
      createdAt: nowIso,
      expiresAt,
    });

    return prepareUploadResponseSchema.parse({
      action: 'upload',
      prepareId,
      tusEndpoint: ENDPOINTS.uploads,
      expiresAt,
    });
  });

  // GET /v1/files/prepare/:prepareId (spec 25.2): upload/verify/commit status for a
  // reservation the authenticated device owns. A foreign or unknown prepare is
  // reported identically (upload_not_found) so existence is not leaked.
  app.get(`${ENDPOINTS.filesPrepare}/:prepareId`, (request) => {
    const device = request.pairedDevice;
    if (device === null) {
      throw new ApiError('unauthorised', 'Not authenticated', { httpStatus: 401 });
    }
    const params = request.params as { prepareId?: unknown };
    const idParse = uuidSchema.safeParse(params.prepareId);
    if (!idParse.success) {
      throw new ApiError('bad_request', 'Malformed prepare id', { httpStatus: 400 });
    }
    const prepare = repositories.files.getPrepare(idParse.data);
    if (prepare === null || prepare.phoneDeviceId !== device.phoneDeviceId) {
      throw new ApiError('upload_not_found', 'Unknown prepare', { httpStatus: 404 });
    }

    // Lazy expiry so a status read reflects the seven-day lifetime even before the
    // staging GC runs (spec 22.3).
    let state = prepare.state;
    if (!isTerminalPrepareState(state) && prepare.expiresAt <= now().toISOString()) {
      repositories.files.setPrepareState(prepare.prepareId, 'expired');
      state = 'expired';
    }

    // Once committed, surface the winning version's identity/hash so the phone can
    // verify before deleting its source (spec 19.2); populated by the commit slice.
    let remoteVersionId: string | null = null;
    let sha256: string | null = null;
    if (state === 'committed') {
      const remoteFile = repositories.files.getRemoteFile(
        prepare.phoneDeviceId,
        prepare.rootId,
        prepare.relativePath,
      );
      if (remoteFile?.currentVersionId != null) {
        remoteVersionId = remoteFile.currentVersionId;
        sha256 = repositories.files.getRemoteVersion(remoteFile.currentVersionId)?.sha256 ?? null;
      }
    }

    return Promise.resolve(
      prepareStatusResponseSchema.parse({
        prepareId: prepare.prepareId,
        state,
        remoteVersionId,
        sha256,
        errorCode: prepare.errorCode,
      }),
    );
  });

  // POST /v1/files/delete (spec 6.4/25.2/26.2): mirrors a phone-reported user/external
  // deletion to the desktop copy — moving it to managed trash when the mapping's
  // policy is mirror_user_deletions, preserving it otherwise (spec 6.1). The
  // retention_cleanup cause is rejected at the schema (spec 6.2), and the delete is
  // gated on the version the phone last saw (spec 26.2).
  app.post(ENDPOINTS.filesDelete, async (request) => {
    const device = request.pairedDevice;
    if (device === null) {
      throw new ApiError('unauthorised', 'Not authenticated', { httpStatus: 401 });
    }
    const parsed = fileDeleteRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ApiError('bad_request', 'Malformed delete request', { httpStatus: 400 });
    }
    const body = parsed.data;

    const mapping = repositories.roots.getByPhoneRoot(device.phoneDeviceId, body.rootId);
    if (mapping === null) {
      throw new ApiError('root_not_mapped', 'Unknown root', { httpStatus: 404 });
    }

    const resolved = resolveDestinationPath(mapping.destinationRoot, body.relativePath);
    if (!resolved.ok) {
      throw new ApiError('invalid_relative_path', 'Rejected relative path', {
        httpStatus: 400,
        details: { kind: resolved.error.kind },
      });
    }
    if (isReservedRelativePath(resolved.relativePath)) {
      throw new ApiError('invalid_relative_path', 'Rejected relative path', {
        httpStatus: 400,
        details: { kind: 'reserved_managed_dir' },
      });
    }

    const result = await deleteService.applyDeletion({
      eventId: body.eventId,
      phoneDeviceId: device.phoneDeviceId,
      rootId: body.rootId,
      destinationRoot: mapping.destinationRoot,
      relativePath: resolved.relativePath,
      expectedRemoteVersionId: body.expectedRemoteVersionId,
      desktopDeletionPolicy: mapping.desktopDeletionPolicy,
    });

    if (result.outcome === 'version_conflict') {
      throw new ApiError('remote_version_conflict', 'Expected version is not current', {
        httpStatus: 409,
      });
    }

    return fileDeleteResponseSchema.parse({
      eventId: body.eventId,
      action: result.outcome === 'already_applied' ? 'already_applied' : result.action,
      trashPath: result.trashPath,
    });
  });

  // GET /v1/sync/status (spec 25.2): the phone's own mapping health, the commit
  // backlog and per-destination free space. Scoped to the authenticated device
  // (spec 25.1); unbound mappings (no phone root yet) are omitted.
  app.get(ENDPOINTS.syncStatus, async (request) => {
    const device = request.pairedDevice;
    if (device === null) {
      throw new ApiError('unauthorised', 'Not authenticated', { httpStatus: 401 });
    }
    const bound = repositories.roots
      .listByDevice(device.phoneDeviceId)
      .filter((m): m is RootMappingRow & { phoneRootId: string } => m.phoneRootId !== null);

    const mappings = await Promise.all(
      bound.map(async (m) => {
        // A destination volume that is unplugged or unreadable fails statfs — surfaced
        // as unavailable rather than a 500 (spec 25.2 disk-space state).
        try {
          const freeBytes = await freeSpace(m.destinationRoot);
          return {
            rootId: m.phoneRootId,
            mappingId: m.mappingId,
            destinationAvailable: true,
            freeBytes,
          };
        } catch {
          return {
            rootId: m.phoneRootId,
            mappingId: m.mappingId,
            destinationAvailable: false,
            freeBytes: null,
          };
        }
      }),
    );

    return syncStatusResponseSchema.parse({
      mappings,
      pendingCommits: repositories.files.countPendingCommits(),
    });
  });

  // tus upload transport (spec 18.4/18.5): authenticated by the onRequest hook like
  // every other non-public route, routed to per-destination staging by prepare id.
  registerUploadRoutes(app, {
    repositories,
    now,
    ...(context.commitCoordinator !== undefined
      ? { commitCoordinator: context.commitCoordinator }
      : {}),
  });

  return app;
}
