import { Server as TusServer } from '@tus/server';
import { FileStore } from '@tus/file-store';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { ENDPOINTS } from '@foldersync/protocol';

// Fastify + @tus/server integration (spec 35 spike 6): tus must receive the raw
// Node request/response. Two things make that work here:
//   1. a content-type parser for tus PATCH bodies that does NOT consume the
//      stream, so the raw request stays readable;
//   2. reply.hijack() so Fastify stops managing the response and tus can write
//      to reply.raw directly.
// The control API (auth, prepare validation) attaches to this same instance in
// the control-API slice; tus routes stay body-parser-free.
export function createUploadServer(stagingDir: string): FastifyInstance {
  const tus = new TusServer({
    path: ENDPOINTS.uploads,
    datastore: new FileStore({ directory: stagingDir }),
  });

  const app = Fastify({ logger: false });

  app.addContentTypeParser('application/offset+octet-stream', (_request, _payload, done) => {
    done(null, null);
  });

  const handleWithTus = (request: FastifyRequest, reply: FastifyReply): void => {
    reply.hijack();
    void tus.handle(request.raw, reply.raw);
  };

  app.all(ENDPOINTS.uploads, handleWithTus);
  app.all(`${ENDPOINTS.uploads}/*`, handleWithTus);

  return app;
}
