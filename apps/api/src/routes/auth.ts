import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { members, users, workspaces } from '../db/schema.js';
import { hashPassword, verifyPassword } from '../lib/auth.js';
import { csrfTokenFor } from '../lib/csrf.js';
import { ApiError, conflict, forbidden } from '../lib/errors.js';
import { loadMembership } from '../modules/context.js';
import { emailSchema, type RouteContext } from './context.js';

export function authRoutes(app: FastifyInstance, context: RouteContext) {
  const { db } = context;

  app.post('/auth/setup', { config: { publicEntry: true } }, async (request, reply) => {
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

  app.post('/auth/login', { config: { publicEntry: true } }, async (request, reply) => {
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

    const { token } = await context.sessions.begin(request, reply, user.id);
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
    return { user: { id: user.id, name: user.name, email: user.email, role: membership.workspaceRole }, csrfToken: csrfTokenFor(token) };
  });

  app.post('/auth/logout', async (request, reply) => {
    await context.sessions.end(request, reply);
    return { ok: true };
  });

  app.get('/me', async (request) => {
    const user = await context.currentUser(request);
    const workspace = await context.loadWorkspace(user.workspaceId);
    return { user, workspace, csrfToken: csrfTokenFor(context.sessions.tokenOf(request)!) };
  });
}
