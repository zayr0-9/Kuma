import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  deviceResponseSchema,
  healthResponseSchema,
  pairRequestSchema,
  pairResponseSchema,
  uuidSchema,
} from '@foldersync/contracts';
import {
  ENDPOINTS,
  HEADER_PROTOCOL,
  HEADER_REQUEST_ID,
  PROTOCOL_VERSION,
} from '@foldersync/protocol';
import type { PairedDeviceRow, Repositories } from '../db/index.ts';
import type { PairingWindow } from '../auth/pairingWindow.ts';
import { generateBearerToken, hashToken } from '../auth/token.ts';
import { ApiError, buildErrorResponse } from './errors.ts';

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
  // Injectable clock so last-seen and pairing timestamps are deterministic in tests.
  now?: () => Date;
}

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
  const { repositories } = context;

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
    repositories.devices.recordPairing({
      phoneDeviceId: body.deviceId,
      phoneDisplayName: body.deviceName,
      tokenHash: hashToken(token),
      pairedAt: now().toISOString(),
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

  return app;
}
