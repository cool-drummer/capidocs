import { randomBytes } from 'node:crypto';
import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import { createDatabase, type Database } from './db/client.js';
import { migrate } from './db/migrate.js';
import { createCsrfGuard } from './lib/csrf.js';
import { RateLimiter } from './lib/rate-limit.js';
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
import { previewRoutes, runtimeRoutes } from './routes/preview.js';
import { studioRoutes } from './routes/studio.js';
import { securityHeaders } from './lib/security-headers.js';
import { loggerOptions, type LogDestination } from './lib/logging.js';
import { createUrlSigner } from './lib/preview.js';

export interface AppOverrides {
  logger?: boolean;
  logStream?: LogDestination;
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
    logger: overrides.logger || overrides.logStream ? loggerOptions(config.server.logLevel, overrides.logStream) : false,
    trustProxy: (_address: string, hop: number) => hop < config.server.trustProxyHops,
    bodyLimit: config.limits.bodyBytes,
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

  const signer = createUrlSigner(randomBytes(32), config.attachments.previewTtlSeconds);
  const limiter = new RateLimiter();
  const context = createRouteContext({
    config,
    limiter,
    db,
    runtimeDir: config.runtimeDir,
    studioUrl: config.publicUrl,
    sessionPolicy: { ...config.session, secure: config.secureCookies },
    mailer,
    store,
    onMailError: (error) => app.log.error({ reason: (error as Error).message }, 'mail delivery failed'),
  });

  app.addHook('onSend', securityHeaders({ secure: config.secureCookies, apiPrefix: API_PREFIX }));
  app.setErrorHandler(handleError);

  app.setNotFoundHandler((_request, reply) =>
    reply.status(404).send({ error: 'not_found', message: 'No encontramos lo que buscas.' }),
  );

  await app.register(
    async (api) => {
      api.addHook('onRequest', limiter.hook(config.rateLimits.api));
      api.addHook('onRequest', createCsrfGuard({ allowedOrigins: [config.publicOrigin], sessionToken: context.sessions.tokenOf }));
      api.get('/health', async () => ({ status: 'ok' }));
      authRoutes(api, context);
      contentRoutes(api, context);
      memberRoutes(api, context);
      attachmentRoutes(api, context);
      portalRoutes(api, context, signer);
      previewRoutes(api, context, signer);
    },
    { prefix: API_PREFIX },
  );
  runtimeRoutes(app, context);
  studioRoutes(app, { studioDir: config.studioDir, secure: config.secureCookies });

  return {
    fastify: app,
    db,
    mailer,
    store,
    inject: app.inject.bind(app),
    listen: app.listen.bind(app),
    close: async () => {
      limiter.close();
      await app.close();
      await close();
    },
  };
}
