import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import { createDatabase, type Database } from './db/client.js';
import { migrate } from './db/migrate.js';
import { createCsrfGuard } from './lib/csrf.js';
import { handleError } from './lib/error-handler.js';
import { createMailer, type Mailer } from './lib/mail.js';
import { createLocalStore, createS3Store, type AttachmentStore } from './lib/storage.js';
import type { SessionUser } from './modules/context.js';
import { purgeSessions } from './modules/sessions.js';
import { attachmentRoutes } from './routes/attachments.js';
import { authRoutes } from './routes/auth.js';
import { contentRoutes } from './routes/content.js';
import { createRouteContext } from './routes/context.js';
import { memberRoutes } from './routes/members.js';
import { portalRoutes } from './routes/portals.js';

export interface AppOverrides {
  logger?: boolean;
  mailer?: Mailer;
  store?: AttachmentStore;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionUser;
    sessionId?: string;
  }
  interface FastifyContextConfig {
    publicEntry?: boolean;
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

export async function createApp(config: Config, overrides: AppOverrides = {}): Promise<CapidocsApp> {
  const { db, sql, close } = createDatabase(config.databaseUrl, { max: config.databasePoolSize });
  await migrate(sql);
  await purgeSessions(db);

  const app = Fastify({
    logger: overrides.logger ? { level: config.server.logLevel } : false,
    trustProxy: (_address: string, hop: number) => hop < config.server.trustProxyHops,
    bodyLimit: 12 * 1024 * 1024,
  });
  await app.register(cookie);
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));

  const store =
    overrides.store ??
    (config.storage.driver === 's3' ? createS3Store(config.storage) : createLocalStore(config.storage.dir));
  const mailer =
    overrides.mailer ??
    createMailer(config.mail, {
      info: (data, message) => app.log.info(data, message),
      error: (data, message) => app.log.error(data, message),
    });

  const context = createRouteContext({
    config,
    db,
    runtimeDir: config.runtimeDir,
    studioUrl: config.publicUrl,
    sessionPolicy: { ...config.session, secure: config.secureCookies },
    mailer,
    store,
    onMailError: (error) => app.log.error({ reason: (error as Error).message }, 'mail delivery failed'),
  });

  app.setErrorHandler(handleError);

  app.setNotFoundHandler((_request, reply) =>
    reply.status(404).send({ error: 'not_found', message: 'No encontramos lo que buscas.' }),
  );

  await app.register(
    async (api) => {
      api.addHook('onRequest', createCsrfGuard({ allowedOrigins: [config.publicOrigin], sessionToken: context.sessions.tokenOf }));
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
