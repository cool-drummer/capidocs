import cookie from '@fastify/cookie';
import { and, asc, eq, isNull } from 'drizzle-orm';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { createDatabase, type Database } from './db/client.js';
import { migrate } from './db/migrate.js';
import { members, portals, sessions, spaceMembers, spaces, users, workspaces } from './db/schema.js';
import { assertCan } from './lib/access.js';
import { cookieOptions, createSessionToken, hashPassword, hashToken, SESSION_COOKIE, sessionExpiry, verifyPassword } from './lib/auth.js';
import { writeBuild } from './lib/deploy.js';
import { ApiError, badRequest, conflict, forbidden, notFound, unauthorized } from './lib/errors.js';
import { actorFor, loadMembership, loadSpaceSubject, spaceRoleFor, visibleSpaceIds, type SessionUser } from './modules/context.js';
import {
  contentOrFallback,
  createPage,
  getPage,
  movePage,
  publishVersion,
  resolvePosition,
  saveContent,
  siblingPositions,
  snapshotVersion,
  softDeletePage,
  spaceTree,
} from './modules/pages.js';
import { buildPortal, recordPublish } from './modules/publish.js';

export interface AppOptions {
  databaseUrl: string;
  runtimeDir: string;
  secureCookies?: boolean;
  logger?: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionUser;
  }
}

const emailSchema = z.string().trim().toLowerCase().email();

export interface CapidocsApp {
  fastify: FastifyInstance;
  db: Database;
  inject: FastifyInstance['inject'];
  listen: FastifyInstance['listen'];
  close: () => Promise<void>;
}

export async function createApp(options: AppOptions): Promise<CapidocsApp> {
  const { db, sql, close } = createDatabase(options.databaseUrl);
  await migrate(sql);

  const app = Fastify({ logger: options.logger ?? false });
  await app.register(cookie);

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

  async function currentUser(request: FastifyRequest): Promise<SessionUser> {
    const token = request.cookies[SESSION_COOKIE];
    if (!token) throw unauthorized();
    const rows = await db
      .select({ userId: sessions.userId, expiresAt: sessions.expiresAt, revokedAt: sessions.revokedAt })
      .from(sessions)
      .where(eq(sessions.tokenHash, hashToken(token)))
      .limit(1);
    const session = rows[0];
    if (!session || session.revokedAt || session.expiresAt < new Date()) throw unauthorized();
    const user = await loadMembership(db, session.userId);
    if (!user) throw unauthorized();
    request.user = user;
    return user;
  }

  app.get('/health', async () => ({ status: 'ok' }));

  app.post('/auth/setup', async (request, reply) => {
    const existing = await db.select({ id: workspaces.id }).from(workspaces).limit(1);
    if (existing.length) throw conflict('Este espacio de trabajo ya está configurado.');

    const body = z
      .object({
        workspaceName: z.string().trim().min(2),
        workspaceSlug: z.string().trim().regex(/^[a-z0-9-]{2,50}$/),
        name: z.string().trim().min(2),
        email: emailSchema,
        password: z.string().min(10),
        locales: z.array(z.string().min(2)).min(1).optional(),
      })
      .parse(request.body);

    const locales = body.locales ?? ['es'];
    const [workspace] = await db
      .insert(workspaces)
      .values({ name: body.workspaceName, slug: body.workspaceSlug, defaultLocale: locales[0]!, locales })
      .returning();
    const [user] = await db
      .insert(users)
      .values({ email: body.email, name: body.name, passwordHash: await hashPassword(body.password) })
      .returning();
    await db.insert(members).values({ workspaceId: workspace!.id, userId: user!.id, role: 'owner' });

    return reply.status(201).send({ workspace: { id: workspace!.id, name: workspace!.name }, user: { id: user!.id, email: user!.email } });
  });

  app.post('/auth/login', async (request, reply) => {
    const body = z.object({ email: emailSchema, password: z.string().min(1) }).parse(request.body);
    const rows = await db.select().from(users).where(eq(users.email, body.email)).limit(1);
    const user = rows[0];
    const ok = await verifyPassword(body.password, user?.passwordHash ?? null);
    if (!user || !ok) {
      request.log.warn({ email: body.email }, 'failed login');
      throw new ApiError(401, 'unauthorized', 'Correo o contraseña incorrectos.');
    }
    const membership = await loadMembership(db, user.id);
    if (!membership) throw forbidden();

    const { token, tokenHash } = createSessionToken();
    await db.insert(sessions).values({
      userId: user.id,
      tokenHash,
      expiresAt: sessionExpiry(),
      userAgent: request.headers['user-agent'] ?? null,
    });
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
    reply.setCookie(SESSION_COOKIE, token, cookieOptions(options.secureCookies ?? false));
    return { user: { id: user.id, name: user.name, email: user.email, role: membership.workspaceRole } };
  });

  app.post('/auth/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) {
      await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.tokenHash, hashToken(token)));
    }
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/me', async (request) => {
    const user = await currentUser(request);
    const rows = await db.select().from(workspaces).where(eq(workspaces.id, user.workspaceId)).limit(1);
    return { user, workspace: rows[0] };
  });

  app.get('/spaces', async (request) => {
    const user = await currentUser(request);
    const visible = await visibleSpaceIds(db, user);
    const rows = await db
      .select()
      .from(spaces)
      .where(and(eq(spaces.workspaceId, user.workspaceId), isNull(spaces.deletedAt)))
      .orderBy(asc(spaces.name));
    const allowed = visible === 'all' ? rows : rows.filter((row) => visible.includes(row.id));
    return {
      spaces: await Promise.all(
        allowed.map(async (space) => ({
          ...space,
          role: visible === 'all' ? 'admin' : await spaceRoleFor(db, space.id, user.id),
        })),
      ),
    };
  });

  app.post('/spaces', async (request, reply) => {
    const user = await currentUser(request);
    assertCan(actorFor(user), 'space.create', { workspaceId: user.workspaceId });
    const body = z
      .object({
        name: z.string().trim().min(2),
        slug: z.string().trim().regex(/^[a-z0-9-]{2,50}$/),
        audience: z.enum(['public', 'customers', 'internal']),
        portalId: z.string().uuid().nullable().optional(),
        icon: z.string().optional(),
      })
      .parse(request.body);

    if (body.audience !== 'internal' && !body.portalId) {
      throw badRequest('Un espacio público o de clientes necesita un portal.');
    }

    const [space] = await db
      .insert(spaces)
      .values({
        workspaceId: user.workspaceId,
        name: body.name,
        slug: body.slug,
        audience: body.audience,
        portalId: body.portalId ?? null,
        icon: body.icon ?? null,
      })
      .returning();
    await db.insert(spaceMembers).values({ spaceId: space!.id, userId: user.id, role: 'admin', addedById: user.id });
    return reply.status(201).send({ space });
  });

  app.get('/spaces/:spaceId/tree', async (request) => {
    const user = await currentUser(request);
    const params = z.object({ spaceId: z.string().uuid() }).parse(request.params);
    const query = z.object({ locale: z.string().optional() }).parse(request.query);
    const subject = await loadSpaceSubject(db, user.workspaceId, params.spaceId, user.id);
    assertCan(actorFor(user), 'page.read', subject);
    const workspace = (await db.select().from(workspaces).where(eq(workspaces.id, user.workspaceId)).limit(1))[0]!;
    const locale = query.locale ?? workspace.defaultLocale;
    return { tree: await spaceTree(db, params.spaceId, locale, workspace.defaultLocale), locale, locales: workspace.locales };
  });

  app.post('/spaces/:spaceId/pages', async (request, reply) => {
    const user = await currentUser(request);
    const params = z.object({ spaceId: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        title: z.string().trim().min(1),
        kind: z.enum(['page', 'hero', 'endpoint', 'feature']).optional(),
        parentPageId: z.string().uuid().nullable().optional(),
        icon: z.string().optional(),
        locale: z.string().optional(),
      })
      .parse(request.body);
    const subject = await loadSpaceSubject(db, user.workspaceId, params.spaceId, user.id);
    assertCan(actorFor(user), 'page.create', subject);
    const workspace = (await db.select().from(workspaces).where(eq(workspaces.id, user.workspaceId)).limit(1))[0]!;

    const page = await createPage(db, {
      workspaceId: user.workspaceId,
      spaceId: params.spaceId,
      title: body.title,
      kind: body.kind ?? 'page',
      parentPageId: body.parentPageId ?? null,
      icon: body.icon ?? null,
      locale: body.locale ?? workspace.defaultLocale,
      creatorId: user.id,
    });
    return reply.status(201).send({ page });
  });

  app.get('/pages/:pageId', async (request) => {
    const user = await currentUser(request);
    const params = z.object({ pageId: z.string().uuid() }).parse(request.params);
    const query = z.object({ locale: z.string().optional() }).parse(request.query);
    const page = await getPage(db, params.pageId);
    const subject = await loadSpaceSubject(db, user.workspaceId, page.spaceId, user.id);
    assertCan(actorFor(user), 'page.read', subject);
    const workspace = (await db.select().from(workspaces).where(eq(workspaces.id, user.workspaceId)).limit(1))[0]!;
    const locale = query.locale ?? workspace.defaultLocale;
    const content = await contentOrFallback(db, page.id, locale, workspace.defaultLocale);
    return { page, content, locale, locales: workspace.locales, canEdit: subject.spaceRole !== 'reader' };
  });

  app.put('/pages/:pageId/content', async (request) => {
    const user = await currentUser(request);
    const params = z.object({ pageId: z.string().uuid() }).parse(request.params);
    const body = z
      .object({ locale: z.string().min(2), title: z.string().trim().min(1), document: z.unknown() })
      .parse(request.body);
    const page = await getPage(db, params.pageId);
    if (page.isLocked) throw badRequest('Esta página está bloqueada.');
    const subject = await loadSpaceSubject(db, user.workspaceId, page.spaceId, user.id);
    assertCan(actorFor(user), 'page.update', subject);
    const saved = await saveContent(db, page.id, body.locale, body.title, body.document, user.id);
    return { ok: true, ...saved };
  });

  app.post('/pages/:pageId/versions', async (request) => {
    const user = await currentUser(request);
    const params = z.object({ pageId: z.string().uuid() }).parse(request.params);
    const body = z.object({ locale: z.string().min(2) }).parse(request.body);
    const page = await getPage(db, params.pageId);
    const subject = await loadSpaceSubject(db, user.workspaceId, page.spaceId, user.id);
    assertCan(actorFor(user), 'page.update', subject);
    const version = await snapshotVersion(db, page.id, body.locale, user.id);
    return { version };
  });

  app.post('/pages/:pageId/publish', async (request) => {
    const user = await currentUser(request);
    const params = z.object({ pageId: z.string().uuid() }).parse(request.params);
    const body = z.object({ locale: z.string().min(2) }).parse(request.body);
    const page = await getPage(db, params.pageId);
    const subject = await loadSpaceSubject(db, user.workspaceId, page.spaceId, user.id);
    assertCan(actorFor(user), 'page.publish', subject);
    const version = await publishVersion(db, page.id, body.locale, user.id);
    return { version: { id: version.id, version: version.version } };
  });

  app.post('/pages/:pageId/move', async (request) => {
    const user = await currentUser(request);
    const params = z.object({ pageId: z.string().uuid() }).parse(request.params);
    const body = z
      .object({ parentPageId: z.string().uuid().nullable(), index: z.number().int().min(0) })
      .parse(request.body);
    const page = await getPage(db, params.pageId);
    const subject = await loadSpaceSubject(db, user.workspaceId, page.spaceId, user.id);
    assertCan(actorFor(user), 'page.move', subject);
    const positions = (await siblingPositions(db, page.spaceId, body.parentPageId)).filter((value) => value !== page.position);
    const moved = await movePage(db, page.id, {
      parentPageId: body.parentPageId,
      position: resolvePosition(positions, Math.min(body.index, positions.length)),
    });
    return { page: moved };
  });

  app.delete('/pages/:pageId', async (request) => {
    const user = await currentUser(request);
    const params = z.object({ pageId: z.string().uuid() }).parse(request.params);
    const page = await getPage(db, params.pageId);
    const subject = await loadSpaceSubject(db, user.workspaceId, page.spaceId, user.id);
    assertCan(actorFor(user), 'page.delete', subject);
    const removed = await softDeletePage(db, page.id);
    return { removed };
  });

  app.get('/portals', async (request) => {
    const user = await currentUser(request);
    const rows = await db.select().from(portals).where(eq(portals.workspaceId, user.workspaceId)).orderBy(asc(portals.name));
    return { portals: rows };
  });

  app.post('/portals', async (request, reply) => {
    const user = await currentUser(request);
    assertCan(actorFor(user), 'portal.create', { workspaceId: user.workspaceId });
    const body = z
      .object({
        name: z.string().trim().min(2),
        slug: z.string().trim().regex(/^[a-z0-9-]{2,50}$/),
        siteUrl: z.string().url().optional(),
        locales: z.array(z.string().min(2)).min(1).optional(),
        accessMode: z.enum(['open', 'gate', 'accounts']).optional(),
        brand: z.record(z.string(), z.unknown()).optional(),
        deployTarget: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(request.body);
    const workspace = (await db.select().from(workspaces).where(eq(workspaces.id, user.workspaceId)).limit(1))[0]!;
    const [portal] = await db
      .insert(portals)
      .values({
        workspaceId: user.workspaceId,
        name: body.name,
        slug: body.slug,
        siteUrl: body.siteUrl ?? null,
        locales: body.locales ?? workspace.locales,
        accessMode: body.accessMode ?? 'open',
        brand: body.brand ?? {},
        deployTarget: body.deployTarget ?? {},
      })
      .returning();
    return reply.status(201).send({ portal });
  });

  app.post('/portals/:portalId/publish', async (request) => {
    const user = await currentUser(request);
    const params = z.object({ portalId: z.string().uuid() }).parse(request.params);
    const rows = await db
      .select()
      .from(portals)
      .where(and(eq(portals.id, params.portalId), eq(portals.workspaceId, user.workspaceId)))
      .limit(1);
    const portal = rows[0];
    if (!portal) throw notFound();
    assertCan(actorFor(user), 'portal.update', { workspaceId: user.workspaceId });

    const builds = await buildPortal(db, portal.id);
    const target = portal.deployTarget as { kind?: string; path?: string };
    const result = await recordPublish(db, portal.id, user.id, builds, async (ready) => {
      if (target.kind !== 'directory' || !target.path) {
        return { detail: 'Portal compilado. Configura un destino de despliegue para publicarlo.' };
      }
      return writeBuild({ kind: 'directory', path: target.path }, ready, options.runtimeDir);
    });

    return {
      status: result.status,
      checksum: builds.map((build) => build.checksum.slice(0, 12)),
      locales: builds.map((build) => build.locale),
      routes: builds[0] ? Object.keys(builds[0].spec.pages).length : 0,
      output: result.output,
    };
  });

  app.get('/portals/:portalId/preview', async (request) => {
    const user = await currentUser(request);
    const params = z.object({ portalId: z.string().uuid() }).parse(request.params);
    const rows = await db
      .select()
      .from(portals)
      .where(and(eq(portals.id, params.portalId), eq(portals.workspaceId, user.workspaceId)))
      .limit(1);
    if (!rows.length) throw notFound();
    const builds = await buildPortal(db, params.portalId);
    return { specs: builds.map((build) => ({ locale: build.locale, spec: build.spec })) };
  });

  return {
    fastify: app,
    db,
    inject: app.inject.bind(app),
    listen: app.listen.bind(app),
    close: async () => {
      await app.close();
      await close();
    },
  };
}
