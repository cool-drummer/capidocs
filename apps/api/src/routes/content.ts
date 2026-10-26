import { and, asc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { portals, spaceMembers, spaces } from '../db/schema.js';
import { assertCan } from '../lib/access.js';
import { badRequest } from '../lib/errors.js';
import { assertWorkspaceLocale, displayNameSchema, iconSchema, localeSchema, slugSchema, titleSchema } from '../lib/validation.js';
import { actorFor, loadSpaceSubject, spaceRoleFor, visibleSpaceIds } from '../modules/context.js';
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
} from '../modules/pages.js';
import type { RouteContext } from './context.js';

export function contentRoutes(app: FastifyInstance, context: RouteContext) {
  const { db } = context;

  app.get('/spaces', async (request) => {
    const user = await context.currentUser(request);
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
    const user = await context.currentUser(request);
    assertCan(actorFor(user), 'space.create', { workspaceId: user.workspaceId });
    const body = z
      .object({
        name: displayNameSchema,
        slug: slugSchema,
        audience: z.enum(['public', 'customers', 'internal']),
        portalId: z.string().uuid().nullable().optional(),
        icon: iconSchema.optional(),
      })
      .parse(request.body);

    if (body.audience !== 'internal' && !body.portalId) {
      throw badRequest('Un espacio público o de clientes necesita un portal.');
    }
    if (body.portalId) {
      const owned = await db
        .select({ id: portals.id })
        .from(portals)
        .where(and(eq(portals.id, body.portalId), eq(portals.workspaceId, user.workspaceId)))
        .limit(1);
      if (!owned.length) throw badRequest('Ese portal no existe.');
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
    const user = await context.currentUser(request);
    const params = z.object({ spaceId: z.string().uuid() }).parse(request.params);
    const query = z.object({ locale: localeSchema.optional() }).parse(request.query);
    const subject = await loadSpaceSubject(db, user.workspaceId, params.spaceId, user.id);
    assertCan(actorFor(user), 'page.read', subject);
    const workspace = await context.loadWorkspace(user.workspaceId);
    const locale = query.locale ?? workspace.defaultLocale;
    assertWorkspaceLocale(workspace.locales, locale);
    return { tree: await spaceTree(db, params.spaceId, locale, workspace.defaultLocale), locale, locales: workspace.locales };
  });

  app.post('/spaces/:spaceId/pages', async (request, reply) => {
    const user = await context.currentUser(request);
    const params = z.object({ spaceId: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        title: titleSchema,
        kind: z.enum(['page', 'hero', 'endpoint', 'feature']).optional(),
        parentPageId: z.string().uuid().nullable().optional(),
        icon: iconSchema.optional(),
        locale: localeSchema.optional(),
      })
      .parse(request.body);
    const subject = await loadSpaceSubject(db, user.workspaceId, params.spaceId, user.id);
    assertCan(actorFor(user), 'page.create', subject);
    const workspace = await context.loadWorkspace(user.workspaceId);
    if (body.locale) assertWorkspaceLocale(workspace.locales, body.locale);

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
    const user = await context.currentUser(request);
    const params = z.object({ pageId: z.string().uuid() }).parse(request.params);
    const query = z.object({ locale: localeSchema.optional() }).parse(request.query);
    const page = await getPage(db, params.pageId);
    const subject = await loadSpaceSubject(db, user.workspaceId, page.spaceId, user.id);
    assertCan(actorFor(user), 'page.read', subject);
    const workspace = await context.loadWorkspace(user.workspaceId);
    const locale = query.locale ?? workspace.defaultLocale;
    assertWorkspaceLocale(workspace.locales, locale);
    const content = await contentOrFallback(db, page.id, locale, workspace.defaultLocale);
    return { page, content, locale, locales: workspace.locales, canEdit: subject.spaceRole !== 'reader' };
  });

  app.put('/pages/:pageId/content', { bodyLimit: context.config.limits.contentBytes }, async (request) => {
    const user = await context.currentUser(request);
    const params = z.object({ pageId: z.string().uuid() }).parse(request.params);
    const body = z.object({ locale: localeSchema, title: titleSchema, document: z.unknown() }).parse(request.body);
    const page = await getPage(db, params.pageId);
    if (page.isLocked) throw badRequest('Esta página está bloqueada.');
    const subject = await loadSpaceSubject(db, user.workspaceId, page.spaceId, user.id);
    assertCan(actorFor(user), 'page.update', subject);
    assertWorkspaceLocale((await context.loadWorkspace(user.workspaceId)).locales, body.locale);
    const saved = await saveContent(db, page.id, body.locale, body.title, body.document, user.id);
    return { ok: true, ...saved };
  });

  app.post('/pages/:pageId/versions', async (request) => {
    const user = await context.currentUser(request);
    const params = z.object({ pageId: z.string().uuid() }).parse(request.params);
    const body = z.object({ locale: localeSchema }).parse(request.body);
    const page = await getPage(db, params.pageId);
    const subject = await loadSpaceSubject(db, user.workspaceId, page.spaceId, user.id);
    assertCan(actorFor(user), 'page.update', subject);
    assertWorkspaceLocale((await context.loadWorkspace(user.workspaceId)).locales, body.locale);
    const version = await snapshotVersion(db, page.id, body.locale, user.id);
    return { version };
  });

  app.post('/pages/:pageId/publish', async (request) => {
    const user = await context.currentUser(request);
    const params = z.object({ pageId: z.string().uuid() }).parse(request.params);
    const body = z.object({ locale: localeSchema }).parse(request.body);
    const page = await getPage(db, params.pageId);
    const subject = await loadSpaceSubject(db, user.workspaceId, page.spaceId, user.id);
    assertCan(actorFor(user), 'page.publish', subject);
    assertWorkspaceLocale((await context.loadWorkspace(user.workspaceId)).locales, body.locale);
    const version = await publishVersion(db, page.id, body.locale, user.id);
    return { version: { id: version.id, version: version.version } };
  });

  app.post('/pages/:pageId/move', async (request) => {
    const user = await context.currentUser(request);
    const params = z.object({ pageId: z.string().uuid() }).parse(request.params);
    const body = z
      .object({ parentPageId: z.string().uuid().nullable(), index: z.number().int().min(0).max(10_000) })
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
    const user = await context.currentUser(request);
    const params = z.object({ pageId: z.string().uuid() }).parse(request.params);
    const page = await getPage(db, params.pageId);
    const subject = await loadSpaceSubject(db, user.workspaceId, page.spaceId, user.id);
    assertCan(actorFor(user), 'page.delete', subject);
    const removed = await softDeletePage(db, page.id);
    return { removed };
  });
}
