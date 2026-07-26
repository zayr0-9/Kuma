import { mkdir } from 'node:fs/promises';
import { FileStore } from '@tus/file-store';
import { Server as TusServer } from '@tus/server';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { uuidSchema } from '@foldersync/contracts';
import { ENDPOINTS } from '@foldersync/protocol';
import { isTerminalPrepareState, type Repositories } from '../db/index.ts';
import { stagingDirPath } from '../storage/layout.ts';
import type { CommitCoordinator } from '../sync/commitCoordinator.ts';
import { ApiError } from './errors.ts';

// Folds @tus/server into the authenticated control server (spec 18.4/18.5). The
// bytes travel over tus, but authorisation, the destination mapping and the
// staged file name are all resolved server-side from the authenticated device and
// the prepare record — never trusted from tus metadata.
//
// One @tus/server binds a single FileStore directory, but staging must live inside
// each destination volume so the commit can rename atomically within one filesystem
// (spec 22 / 6.5). So there is one tus server per destination staging directory,
// created lazily and cached, and every request is routed to the right one by
// resolving its prepare first. See
// docs/architecture-decisions/desktop-tus-per-destination-staging.md.

export interface UploadRoutingContext {
  repositories: Repositories;
  now: () => Date;
  // When present, a finished upload is handed to the commit pipeline; otherwise it
  // rests in the `uploaded` state.
  commitCoordinator?: CommitCoordinator;
}

// Parses the tus `Upload-Metadata` header: comma-separated `key <base64value>`
// pairs (RFC-style). Valueless keys are allowed by tus but ignored here — the only
// key read is prepareId, which always carries a value.
export function parseTusMetadata(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (header === undefined) return out;
  for (const pair of header.split(',')) {
    const trimmed = pair.trim();
    if (trimmed === '') continue;
    const spaceIndex = trimmed.indexOf(' ');
    if (spaceIndex === -1) continue;
    const key = trimmed.slice(0, spaceIndex);
    const value = Buffer.from(trimmed.slice(spaceIndex + 1), 'base64').toString('utf8');
    out[key] = value;
  }
  return out;
}

export function registerUploadRoutes(app: FastifyInstance, ctx: UploadRoutingContext): void {
  const { repositories, now } = ctx;
  const serversByStagingDir = new Map<string, TusServer>();

  function tusServerFor(stagingDir: string): TusServer {
    const cached = serversByStagingDir.get(stagingDir);
    if (cached !== undefined) return cached;
    const server = new TusServer({
      path: ENDPOINTS.uploads,
      datastore: new FileStore({ directory: stagingDir }),
      // Return a RELATIVE Location (/v1/uploads/:id) for the created upload. @tus/server
      // otherwise emits an absolute `http://host/...` URL — it can't see it is behind the
      // pinned TLS — so the phone's tus client would send every follow-up HEAD/PATCH as plain
      // HTTP to the HTTPS-only port, which resets ("unexpected end of stream"). A relative
      // Location makes the client resolve against its https base, keeping the pinned transport.
      relativeLocation: true,
      // The staged file is named by its prepare id so staging GC reconciles against
      // upload_prepare (spec 22.3) and commit can find it. The id is a validated
      // uuid bound to an owned prepare, never a client-chosen path.
      namingFunction: (_req, metadata) => {
        console.error('[TUSDEBUG] naming metadata=', JSON.stringify(metadata)); // TUSDEBUG
        const prepareId = metadata?.prepareId;
        if (prepareId === undefined || prepareId === null) {
          throw new Error('missing prepareId metadata');
        }
        return prepareId;
      },
      onUploadCreate: (_req, upload) => {
        repositories.files.markUploading(upload.id, upload.id, `${ENDPOINTS.uploads}/${upload.id}`);
        return Promise.resolve({});
      },
      onUploadFinish: (_req, upload) => {
        // Bytes fully received. Mark uploaded, then hand off to the commit pipeline
        // (verify -> hash -> atomic rename -> persist version) off the request path,
        // so the tus 204 is not held for a multi-gigabyte hash. The phone polls
        // prepare status for the terminal outcome (spec 18.5 step 10).
        repositories.files.setPrepareState(upload.id, 'uploaded');
        void ctx.commitCoordinator?.schedule(upload.id);
        return Promise.resolve({});
      },
    });
    serversByStagingDir.set(stagingDir, server);
    return server;
  }

  // Creation posts to the collection path with the id in Upload-Metadata (tus only
  // assigns the URL after naming); every other verb addresses `/v1/uploads/:id`.
  function extractPrepareId(request: FastifyRequest): string | undefined {
    const rawUrl = request.raw.url ?? request.url;
    const path = rawUrl.split('?')[0] ?? rawUrl;
    const isCollection = path === ENDPOINTS.uploads || path === `${ENDPOINTS.uploads}/`;
    if (request.method === 'POST' && isCollection) {
      const header = request.headers['upload-metadata'];
      return parseTusMetadata(typeof header === 'string' ? header : undefined).prepareId;
    }
    return path
      .split('/')
      .filter((segment) => segment.length > 0)
      .at(-1);
  }

  async function stagingDirForRequest(request: FastifyRequest): Promise<string> {
    const device = request.pairedDevice;
    if (device === null) {
      throw new ApiError('unauthorised', 'Not authenticated', { httpStatus: 401 });
    }
    const idParse = uuidSchema.safeParse(extractPrepareId(request));
    if (!idParse.success) {
      throw new ApiError('bad_request', 'Missing or malformed prepare id', { httpStatus: 400 });
    }
    const prepare = repositories.files.getPrepare(idParse.data);
    if (prepare === null || prepare.phoneDeviceId !== device.phoneDeviceId) {
      throw new ApiError('upload_not_found', 'Unknown upload', { httpStatus: 404 });
    }
    if (isTerminalPrepareState(prepare.state) || prepare.expiresAt <= now().toISOString()) {
      throw new ApiError('upload_expired', 'Upload reservation is no longer active', {
        httpStatus: 410,
      });
    }
    // A prepare always has a bound mapping; a missing one means the pairing was torn
    // down mid-flight — treat it as gone rather than leak state.
    const mapping = repositories.roots.getByPhoneRoot(prepare.phoneDeviceId, prepare.rootId);
    if (mapping === null) {
      throw new ApiError('upload_not_found', 'Unknown upload', { httpStatus: 404 });
    }
    const stagingDir = stagingDirPath(mapping.destinationRoot);
    await mkdir(stagingDir, { recursive: true });
    return stagingDir;
  }

  const dispatch = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    // TUSDEBUG (temporary): what the phone actually sent to the tus route.
    console.error(
      '[TUSDEBUG] dispatch',
      request.method,
      request.raw.url,
      'auth=',
      request.pairedDevice?.phoneDeviceId ?? 'NONE',
      'proto=',
      request.headers['x-foldersync-protocol'],
      'ct=',
      request.headers['content-type'],
      'ulen=',
      request.headers['upload-length'],
      'umeta=',
      typeof request.headers['upload-metadata'] === 'string'
        ? request.headers['upload-metadata'].slice(0, 80)
        : request.headers['upload-metadata'],
      'tusr=',
      request.headers['tus-resumable'],
    );
    // Validation runs before hijack, so a rejected upload gets the structured JSON
    // error envelope rather than a hung socket.
    const stagingDir = await stagingDirForRequest(request);
    const server = tusServerFor(stagingDir);
    reply.hijack();
    void server
      .handle(request.raw, reply.raw)
      .then(() =>
        console.error(
          '[TUSDEBUG] handle DONE',
          request.method,
          request.raw.url,
          'status=',
          reply.raw.statusCode,
          'ended=',
          reply.raw.writableEnded,
        ),
      )
      .catch((error: unknown) => {
        console.error('[TUSDEBUG] handle ERROR', request.method, request.raw.url, error);
      });
  };

  // Every tus request must reach @tus/server with its body unparsed. The PATCH chunks are
  // application/offset+octet-stream, but the creation POST also carries a content-type
  // Fastify has no parser for (a bare octet-stream from the Android client), which otherwise
  // fails with 415 Unsupported Media Type before the handler runs. A catch-all parser hands
  // the raw stream through without consuming it; the built-in application/json parser still
  // handles the control API's JSON routes (a specific parser wins over '*'). This is the
  // "bypass body parsing on upload routes" the spec calls for (spec 18.4/35 spike 6).
  app.addContentTypeParser('*', (_request, _payload, done) => {
    done(null, null);
  });
  app.all(ENDPOINTS.uploads, dispatch);
  app.all(`${ENDPOINTS.uploads}/*`, dispatch);
}
