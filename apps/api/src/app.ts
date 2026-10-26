import cookie from '@fastify/cookie';
import { and, asc, eq, isNull } from 'drizzle-orm';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { createDatabase, type Database } from './db/client.js';
import { createMailer, templates, type Mailer, type MailMessage } from './lib/mail.js';
import { migrate } from './db/migrate.js';
import { members, portals, sessions, spaceMembers, spaces, users, workspaces } from './db/schema.js';
import { assertCan } from './lib/access.js';
import { cookieOptions, createSessionToken, hashPassword, hashToken, SESSION_COOKIE, sessionExpiry, verifyPassword } from './lib/auth.js';
import { writeBuild } from './lib/deploy.js';
import { ApiError, badRequest, conflict, forbidden, notFound, unauthorized } from './lib/errors.js';
import { createLocalStore, deleteAttachment, getAttachment, listAttachments, saveAttachment, type AttachmentStore } from './modules/attachments.js';
import { actorFor, loadMembership, loadSpaceSubject, spaceRoleFor, visibleSpaceIds, type SessionUser } from './modules/context.js';
import {
  acceptInvitation,
  createInvitation,
  inspectInvitation,
  listInvitations,
  listMembers,
  listSpaceMembers,
  removeMember,
  removeSpaceMember,
  revokeInvitation,
  setSpaceMember,
  updateMemberRole,
} from './modules/members.js';
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
import { importPortal } from './modules/import.js';
import { buildPortal, recordPublish } from './modules/publish.js';

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

const emailSchema = z.string().trim().toLowerCase().email();

export interface CapidocsApp {
  fastify: FastifyInstance;
  db: Database;
  mailer: Mailer;
  store: AttachmentStore;
  inject: FastifyInstance['inject'];
  listen: FastifyInstance['listen'];
  close: () => Promise<void>;
}

export async function createApp(options: AppOptions): Promise<CapidocsApp> {
  const { db, sql, close } = createDatabase(options.databaseUrl);
  await migrate(sql);

  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 12 * 1024 * 1024 });
  await app.register(cookie);
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));

  const studioUrl = (options.studioUrl ?? 'http://localhost:5190').replace(/\/$/, '');
  const store = createLocalStore(options.filesDir ?? '.tmp/files');
  const mailer =
    options.mailer ??
    createMailer({
      ...(options.mail?.apiKey ? { apiKey: options.mail.apiKey } : {}),
      ...(options.mail?.from ? { from: options.mail.from } : {}),
      logger: (message) => app.log.warn(message),
    });
  const notify = async (to: string, template: Omit<MailMessage, 'to'>) => {
    try {
      await mailer.send({ to, ...template });
    } catch (error) {
      app.log.error({ err: error }, 'mail delivery failed');
    }
  };

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

  app.get('/members', async (request) => {
    const user = await currentUser(request);
    return { members: await listMembers(db, user.workspaceId), invitations: await listInvitations(db, user.workspaceId) };
  });

  app.post('/members/invitations', async (request, reply) => {
    const user = await currentUser(request);
    assertCan(actorFor(user), 'member.invite', { workspaceId: user.workspaceId });
    const body = z.object({ email: emailSchema, role: z.enum(['admin', 'member']) }).parse(request.body);
    const { invitation, token } = await createInvitation(db, user.workspaceId, user.id, body.email, body.role);
    const workspace = (await db.select().from(workspaces).where(eq(workspaces.id, user.workspaceId)).limit(1))[0]!;
    await notify(
      body.email,
      templates.invitation({
        workspace: workspace.name,
        inviter: user.name,
        role: body.role === 'admin' ? 'administrador' : 'miembro',
        url: `${studioUrl}/?invitation=${token}`,
      }),
    );
    return reply.status(201).send({ invitation: { id: invitation.id, email: invitation.email, role: invitation.role, expiresAt: invitation.expiresAt } });
  });

  app.delete('/members/invitations/:invitationId', async (request) => {
    const user = await currentUser(request);
    assertCan(actorFor(user), 'member.invite', { workspaceId: user.workspaceId });
    const params = z.object({ invitationId: z.string().uuid() }).parse(request.params);
    await revokeInvitation(db, user.workspaceId, params.invitationId);
    return { ok: true };
  });

  app.get('/invitations/:token', async (request) => {
    const params = z.object({ token: z.string().min(10) }).parse(request.params);
    const invitation = await inspectInvitation(db, params.token);
    const workspace = (await db.select().from(workspaces).where(eq(workspaces.id, invitation.workspaceId)).limit(1))[0]!;
    return { email: invitation.email, role: invitation.role, workspace: workspace.name };
  });

  app.post('/invitations/:token/accept', async (request, reply) => {
    const params = z.object({ token: z.string().min(10) }).parse(request.params);
    const body = z.object({ name: z.string().trim().min(2), password: z.string().min(10) }).parse(request.body);
    const { userId, invitation } = await acceptInvitation(db, params.token, body.name, body.password);

    const workspace = (await db.select().from(workspaces).where(eq(workspaces.id, invitation.workspaceId)).limit(1))[0]!;
    const inviter = (await db.select().from(users).where(eq(users.id, invitation.invitedById)).limit(1))[0];
    if (inviter) await notify(inviter.email, templates.invitationAccepted({ workspace: workspace.name, who: body.name }));
    await notify(invitation.email, templates.welcome({ workspace: workspace.name, url: studioUrl }));

    const { token, tokenHash } = createSessionToken();
    await db.insert(sessions).values({ userId, tokenHash, expiresAt: sessionExpiry(), userAgent: request.headers['user-agent'] ?? null });
    reply.setCookie(SESSION_COOKIE, token, cookieOptions(options.secureCookies ?? false));
    return reply.status(201).send({ workspace: workspace.name });
  });

  app.put('/members/:userId', async (request) => {
    const user = await currentUser(request);
    assertCan(actorFor(user), 'member.update', { workspaceId: user.workspaceId });
    const params = z.object({ userId: z.string().uuid() }).parse(request.params);
    const body = z.object({ role: z.enum(['admin', 'member']) }).parse(request.body);
    await updateMemberRole(db, user.workspaceId, params.userId, body.role, user.id);
    return { ok: true };
  });

  app.delete('/members/:userId', async (request) => {
    const user = await currentUser(request);
    assertCan(actorFor(user), 'member.remove', { workspaceId: user.workspaceId });
    const params = z.object({ userId: z.string().uuid() }).parse(request.params);
    await removeMember(db, user.workspaceId, params.userId, user.id);
    return { ok: true };
  });

  app.get('/spaces/:spaceId/members', async (request) => {
    const user = await currentUser(request);
    const params = z.object({ spaceId: z.string().uuid() }).parse(request.params);
    const subject = await loadSpaceSubject(db, user.workspaceId, params.spaceId, user.id);
    assertCan(actorFor(user), 'page.read', subject);
    return { members: await listSpaceMembers(db, params.spaceId) };
  });

  app.put('/spaces/:spaceId/members/:userId', async (request) => {
    const user = await currentUser(request);
    const params = z.object({ spaceId: z.string().uuid(), userId: z.string().uuid() }).parse(request.params);
    const body = z.object({ role: z.enum(['admin', 'writer', 'reader']) }).parse(request.body);
    const subject = await loadSpaceSubject(db, user.workspaceId, params.spaceId, user.id);
    assertCan(actorFor(user), 'space.members', subject);
    await setSpaceMember(db, params.spaceId, params.userId, body.role, user.id);
    return { ok: true };
  });

  app.delete('/spaces/:spaceId/members/:userId', async (request) => {
    const user = await currentUser(request);
    const params = z.object({ spaceId: z.string().uuid(), userId: z.string().uuid() }).parse(request.params);
    const subject = await loadSpaceSubject(db, user.workspaceId, params.spaceId, user.id);
    assertCan(actorFor(user), 'space.members', subject);
    await removeSpaceMember(db, params.spaceId, params.userId);
    return { ok: true };
  });

  app.get('/attachments', async (request) => {
    const user = await currentUser(request);
    const query = z.object({ spaceId: z.string().uuid().optional() }).parse(request.query);
    if (query.spaceId) {
      const subject = await loadSpaceSubject(db, user.workspaceId, query.spaceId, user.id);
      assertCan(actorFor(user), 'page.read', subject);
    }
    return { attachments: await listAttachments(db, user.workspaceId, query.spaceId ?? null, store) };
  });

  app.post('/attachments', async (request, reply) => {
    const user = await currentUser(request);
    const query = z
      .object({ spaceId: z.string().uuid(), pageId: z.string().uuid().optional(), name: z.string().min(1).max(300) })
      .parse(request.query);
    const subject = await loadSpaceSubject(db, user.workspaceId, query.spaceId, user.id);
    assertCan(actorFor(user), 'page.update', subject);
    const bytes = request.body;
    if (!Buffer.isBuffer(bytes)) throw badRequest('Envía el archivo como cuerpo binario.');
    const record = await saveAttachment(db, store, {
      workspaceId: user.workspaceId,
      spaceId: query.spaceId,
      pageId: query.pageId ?? null,
      fileName: query.name,
      bytes,
      creatorId: user.id,
    });
    return reply.status(201).send({ attachment: { id: record.id, url: record.url, fileName: record.fileName, size: record.size, mime: record.mime } });
  });

  app.get('/files/:key', async (request, reply) => {
    const user = await currentUser(request);
    const params = z.object({ key: z.string().min(5) }).parse(request.params);
    const record = await getAttachment(db, user.workspaceId, params.key);
    const bytes = await store.get(record.storageKey);
    return reply.header('Content-Type', record.mime).header('Cache-Control', 'private, max-age=300').send(bytes);
  });

  app.delete('/attachments/:key', async (request) => {
    const user = await currentUser(request);
    const params = z.object({ key: z.string().min(5) }).parse(request.params);
    const record = await getAttachment(db, user.workspaceId, params.key);
    if (record.spaceId) {
      const subject = await loadSpaceSubject(db, user.workspaceId, record.spaceId, user.id);
      assertCan(actorFor(user), 'page.update', subject);
    }
    await deleteAttachment(db, store, user.workspaceId, params.key);
    return { ok: true };
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

  app.put('/portals/:portalId', async (request) => {
    const user = await currentUser(request);
    assertCan(actorFor(user), 'portal.update', { workspaceId: user.workspaceId });
    const params = z.object({ portalId: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        name: z.string().trim().min(2).optional(),
        siteUrl: z.string().url().nullable().optional(),
        locales: z.array(z.string().min(2)).min(1).optional(),
        accessMode: z.enum(['open', 'gate', 'accounts']).optional(),
        brand: z.record(z.string(), z.unknown()).optional(),
        accessConfig: z.record(z.string(), z.unknown()).optional(),
        deployTarget: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(request.body);

    const rows = await db
      .select({ id: portals.id })
      .from(portals)
      .where(and(eq(portals.id, params.portalId), eq(portals.workspaceId, user.workspaceId)))
      .limit(1);
    if (!rows.length) throw notFound();

    const [portal] = await db
      .update(portals)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(portals.id, params.portalId))
      .returning();
    return { portal };
  });

  app.post('/portals/import', async (request, reply) => {
    const user = await currentUser(request);
    assertCan(actorFor(user), 'portal.create', { workspaceId: user.workspaceId });
    const body = z
      .object({ spec: z.unknown(), name: z.string().trim().min(2).optional(), publish: z.boolean().optional() })
      .parse(request.body);
    const result = await importPortal(db, user.workspaceId, user.id, body.spec, {
      label: 'spec importado',
      ...(body.name ? { portalName: body.name } : {}),
      ...(body.publish === undefined ? {} : { publish: body.publish }),
    });
    return reply.status(201).send(result);
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
