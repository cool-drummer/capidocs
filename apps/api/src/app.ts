import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createDatabase, type Database } from './db/client.js';
import { migrate } from './db/migrate.js';
import { ApiError } from './lib/errors.js';
import { createMailer, type Mailer } from './lib/mail.js';
import { createLocalStore, type AttachmentStore } from './modules/attachments.js';
import type { SessionUser } from './modules/context.js';
import { attachmentRoutes } from './routes/attachments.js';
import { authRoutes } from './routes/auth.js';
import { contentRoutes } from './routes/content.js';
import { createRouteContext } from './routes/context.js';
import { memberRoutes } from './routes/members.js';
import { portalRoutes } from './routes/portals.js';

export interface AppOptions {
  databaseUrl: string;
  runtimeDir: string;
  secureCookies?: boolean;
  logger?: boolean;
  studioUrl?: string;
  filesDir?: string;
  mailer?: Mailer;
  mail?: { apiKey?: string; from?: string };
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionUser;
  }
}

export interface CapidocsApp {
  fastify: FastifyInstance;
  db: Database;
  mailer: Mailer;
  store: AttachmentStore;
  inject: FastifyInstance['inject'];
  listen: FastifyInstance['listen'];
  close: () => Promise<void>;
}

export const API_PREFIX = '/api';

export async function createApp(options: AppOptions): Promise<CapidocsApp> {
  const { db, sql, close } = createDatabase(options.databaseUrl);
  await migrate(sql);

  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 12 * 1024 * 1024 });
  await app.register(cookie);
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));

  const store = createLocalStore(options.filesDir ?? '.tmp/files');
  const mailer =
    options.mailer ??
    createMailer({
      ...(options.mail?.apiKey ? { apiKey: options.mail.apiKey } : {}),
      ...(options.mail?.from ? { from: options.mail.from } : {}),
      logger: (message) => app.log.warn(message),
    });

  const context = createRouteContext({
    db,
    runtimeDir: options.runtimeDir,
    studioUrl: (options.studioUrl ?? 'http://localhost:5190').replace(/\/$/, ''),
    secureCookies: options.secureCookies ?? false,
    mailer,
    store,
    onMailError: (error) => app.log.error({ err: error }, 'mail delivery failed'),
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      return reply.status(error.statusCode).send({ error: error.code, message: error.message });
    }
    if (error instanceof z.ZodError) {
      request.log.error({ issues: error.issues }, 'validation failed');
      return reply.status(400).send({ error: 'bad_request', message: 'Revisa los datos e inténtalo de nuevo.' });
    }
    request.log.error(error);
    return reply.status(500).send({ error: 'internal', message: 'Algo salió mal, inténtalo de nuevo en un momento.' });
  });

  app.setNotFoundHandler((_request, reply) =>
    reply.status(404).send({ error: 'not_found', message: 'No encontramos lo que buscas.' }),
  );

  await app.register(
    async (api) => {
      api.get('/health', async () => ({ status: 'ok' }));
      authRoutes(api, context);
      contentRoutes(api, context);
      memberRoutes(api, context);
      attachmentRoutes(api, context);
      portalRoutes(api, context);
    },
    { prefix: API_PREFIX },
  );

  return {
    fastify: app,
    db,
    mailer,
    store,
    inject: app.inject.bind(app),
    listen: app.listen.bind(app),
    close: async () => {
      await app.close();
      await close();
    },
  };
}
