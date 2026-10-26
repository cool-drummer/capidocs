import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { portals } from '../db/schema.js';
import { assertCan } from '../lib/access.js';
import { deploy, deployTargetSchema } from '../lib/deploy.js';
import { notFound } from '../lib/errors.js';
import { templates } from '../lib/mail-templates.js';
import type { UrlSigner } from '../lib/preview.js';
import { actorFor, visibleSpaceIds } from '../modules/context.js';
import { importPortal } from '../modules/import.js';
import { buildPortal, recordPublish } from '../modules/publish.js';
import type { RouteContext } from './context.js';

export function portalRoutes(app: FastifyInstance, context: RouteContext, signer: UrlSigner) {
  const { db, config } = context;

  app.get('/portals', async (request) => {
    const user = await context.currentUser(request);
    const rows = await db.select().from(portals).where(eq(portals.workspaceId, user.workspaceId)).orderBy(asc(portals.name));
    return { portals: rows };
  });

  app.post('/portals', async (request, reply) => {
    const user = await context.currentUser(request);
    assertCan(actorFor(user), 'portal.create', { workspaceId: user.workspaceId });
    const body = z
      .object({
        name: z.string().trim().min(2),
        slug: z.string().trim().regex(/^[a-z0-9-]{2,50}$/),
        siteUrl: z.string().url().optional(),
        locales: z.array(z.string().min(2)).min(1).optional(),
        accessMode: z.enum(['open', 'gate', 'accounts']).optional(),
        brand: z.record(z.string(), z.unknown()).optional(),
        deployTarget: deployTargetSchema.optional(),
      })
      .parse(request.body);
    const workspace = await context.loadWorkspace(user.workspaceId);
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
    const user = await context.currentUser(request);
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
        deployTarget: deployTargetSchema.optional(),
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
    const user = await context.currentUser(request);
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
    const user = await context.currentUser(request);
    const params = z.object({ portalId: z.string().uuid() }).parse(request.params);
    const rows = await db
      .select()
      .from(portals)
      .where(and(eq(portals.id, params.portalId), eq(portals.workspaceId, user.workspaceId)))
      .limit(1);
    const portal = rows[0];
    if (!portal) throw notFound();
    assertCan(actorFor(user), 'portal.update', { workspaceId: user.workspaceId });

    const builds = await buildPortal(db, portal.id, { files: { mode: 'bundle', store: context.store } });
    let result: Awaited<ReturnType<typeof recordPublish>>;
    try {
      result = await recordPublish(db, portal.id, user.id, builds, (ready) =>
        deploy(portal.deployTarget, ready, context.runtimeDir, config.publish, (reason) => request.log.error({ reason }, 'deploy failed')),
      );
    } catch (error) {
      void context.notify(user.email, templates.publishFailed({ portal: portal.name }));
      throw error;
    }

    const routes = builds[0] ? Object.keys(builds[0].spec.pages).length : 0;
    if (result.status === 'done') {
      const output = result.output as { url?: string };
      await context.notify(
        user.email,
        templates.published({ portal: portal.name, pages: routes, ...(output.url?.startsWith('http') ? { url: output.url } : {}) }),
      );
    }

    return {
      status: result.status,
      checksum: builds.map((build) => build.checksum.slice(0, 12)),
      locales: builds.map((build) => build.locale),
      routes,
      output: result.output,
    };
  });

  app.get('/portals/:portalId/preview', async (request) => {
    const user = await context.currentUser(request);
    const params = z.object({ portalId: z.string().uuid() }).parse(request.params);
    const rows = await db
      .select({ id: portals.id })
      .from(portals)
      .where(and(eq(portals.id, params.portalId), eq(portals.workspaceId, user.workspaceId)))
      .limit(1);
    if (!rows.length) throw notFound();
    const visible = await visibleSpaceIds(db, user);
    const builds = await buildPortal(db, params.portalId, { files: { mode: 'sign', sign: (key) => signer.sign(key) }, spaceIds: visible });
    return {
      specs: builds.map((build) => ({
        locale: build.locale,
        spec: { ...build.spec, site_config: { ...build.spec.site_config, access: { mode: 'open' } } },
      })),
    };
  });
}
