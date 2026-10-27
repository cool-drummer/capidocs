import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { portals } from '../db/schema.js';
import { assertCan } from '../lib/access.js';
import { ApiError, notFound } from '../lib/errors.js';
import { templates } from '../lib/mail-templates.js';
import type { UrlSigner } from '../lib/preview.js';
import { readerCsp, readerExplorerPage, readerPage } from '../lib/reader-page.js';
import { actorFor } from '../modules/context.js';
import { buildPortal } from '../modules/publish.js';
import {
  addReader,
  consumeReaderCode,
  findPortalBySlug,
  isAllowedReader,
  issueReaderCode,
  listReaders,
  normalizePattern,
  readerCookieName,
  removeReader,
  resolveReaderSession,
  revokeReaderSession,
  startReaderSession,
} from '../modules/readers.js';
import { runtimeBase } from './preview.js';
import { emailSchema, type RouteContext } from './context.js';

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/;
const readerRequired = () => new ApiError(401, 'reader_required', 'Entra con tu correo para leer esta documentación.');

export function readerAdminRoutes(app: FastifyInstance, context: RouteContext) {
  const { db, config } = context;

  const managedPortal = async (request: FastifyRequest) => {
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
    return { user, portal };
  };

  app.get('/portals/:portalId/readers', async (request) => {
    const { portal } = await managedPortal(request);
    return { readers: await listReaders(db, portal.id), url: `${config.publicUrl}/read/${portal.slug}` };
  });

  app.post('/portals/:portalId/readers', async (request, reply) => {
    const { user, portal } = await managedPortal(request);
    const body = z.object({ pattern: z.string().max(320) }).parse(request.body);
    const reader = await addReader(db, portal.id, normalizePattern(body.pattern), user.id);
    return reply.status(reader ? 201 : 200).send({ reader });
  });

  app.delete('/portals/:portalId/readers/:readerId', async (request) => {
    const { portal } = await managedPortal(request);
    const params = z.object({ readerId: z.string().uuid() }).parse(request.params);
    if (!(await removeReader(db, portal.id, params.readerId))) throw notFound();
    return { ok: true };
  });
}

export function readerRoutes(app: FastifyInstance, context: RouteContext, signer: UrlSigner, secret: Buffer) {
  const { db, config, limiter } = context;
  const policy = config.readers;
  const entry = { config: { publicEntry: true }, onRequest: limiter.hook(config.rateLimits.auth) };

  const portalOf = async (request: FastifyRequest) => {
    const params = z.object({ slug: z.string().regex(SLUG) }).parse(request.params);
    const portal = await findPortalBySlug(db, params.slug);
    if (!portal) throw notFound();
    return portal;
  };

  const cookieOptions = () => ({
    path: '/',
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'lax' as const,
    maxAge: policy.absoluteDays * 86_400,
  });

  app.post('/read/:slug/code', entry, async (request, reply) => {
    const portal = await portalOf(request);
    const body = z.object({ email: emailSchema }).parse(request.body);
    if (!limiter.hit(config.rateLimits.readerCodePerEmail, `${portal.id}:${body.email}`).allowed) return reply.status(202).send({ ok: true });
    void (async () => {
      if (!(await isAllowedReader(db, portal.id, body.email))) return;
      const code = await issueReaderCode(db, secret, portal.id, body.email, policy);
      await context.notify(body.email, templates.readerCode({ portal: portal.name, code, expiresInMinutes: policy.codeTtlMinutes }));
    })().catch((error: Error) => request.log.error({ reason: error.message }, 'reader code request failed'));
    return reply.status(202).send({ ok: true });
  });

  app.post('/read/:slug/verify', entry, async (request, reply) => {
    const portal = await portalOf(request);
    const body = z.object({ email: emailSchema, code: z.string().trim().regex(/^\d{6}$/) }).safeParse(request.body);
    if (!body.success) throw new ApiError(400, 'reader_code_invalid', 'El código no es válido o ya venció. Pide uno nuevo.');
    await consumeReaderCode(db, secret, portal.id, body.data.email, body.data.code, policy);
    const { token } = await startReaderSession(db, portal.id, body.data.email, policy);
    reply.setCookie(readerCookieName(portal.id, config.secureCookies), token, cookieOptions());
    return { ok: true };
  });

  app.post('/read/:slug/logout', { config: { publicEntry: true } }, async (request, reply) => {
    const portal = await portalOf(request);
    const name = readerCookieName(portal.id, config.secureCookies);
    const token = request.cookies[name];
    if (token) await revokeReaderSession(db, token);
    const { path, httpOnly, secure, sameSite } = cookieOptions();
    reply.clearCookie(name, { path, httpOnly, secure, sameSite });
    return { ok: true };
  });

  app.get('/read/:slug/spec', async (request: FastifyRequest, reply: FastifyReply) => {
    const portal = await portalOf(request);
    const token = request.cookies[readerCookieName(portal.id, config.secureCookies)];
    const session = token ? await resolveReaderSession(db, token, portal.id, policy) : null;
    if (!session) {
      const error = readerRequired();
      return reply.status(error.statusCode).send({ error: error.code, message: error.message, portal: portal.name });
    }
    const query = z.object({ locale: z.string().max(10).optional() }).parse(request.query);
    const builds = await buildPortal(db, portal.id, { files: { mode: 'sign', sign: (key) => signer.sign(key) } });
    const build = builds.find((entry) => entry.locale === query.locale) ?? builds[0]!;
    return {
      spec: { ...build.spec, site_config: { ...build.spec.site_config, access: { mode: 'open' } } },
      reader: { email: session.email },
    };
  });
}

export function readerPageRoutes(app: FastifyInstance, context: RouteContext) {
  const send = (reply: FastifyReply, page: { html: string; nonce: string }) =>
    reply
      .headers({
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': readerCsp(context.config.publicOrigin, page.nonce),
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
        'X-Robots-Tag': 'noindex, nofollow',
        'Cache-Control': 'no-store',
      })
      .send(page.html);

  const slugOf = (request: FastifyRequest) => {
    const params = z.object({ slug: z.string().regex(SLUG) }).safeParse(request.params);
    if (!params.success) throw notFound();
    return params.data.slug;
  };

  app.get('/read/:slug', async (request, reply) => send(reply, readerPage(await runtimeBase(context.runtimeDir), slugOf(request))));
  app.get('/read/:slug/explorer', async (request, reply) =>
    send(reply, readerExplorerPage(await runtimeBase(context.runtimeDir), slugOf(request))),
  );
}
