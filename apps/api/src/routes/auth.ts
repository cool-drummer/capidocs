import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { members, sessions, users, workspaces } from '../db/schema.js';
import { hashPassword, MAX_PASSWORD_LENGTH, safeCompare, verifyPassword } from '../lib/auth.js';
import { csrfTokenFor } from '../lib/csrf.js';
import { describeDevice } from '../lib/device.js';
import { ApiError, conflict } from '../lib/errors.js';
import { maskAddress } from '../lib/mail.js';
import { templates } from '../lib/mail-templates.js';
import { assertStrongPassword } from '../lib/password-policy.js';
import { loadMembership } from '../modules/context.js';
import { consumePasswordReset, createPasswordReset, findPasswordReset, setPassword } from '../modules/passwords.js';
import { revokeUserSessions } from '../modules/sessions.js';
import { emailSchema, type RouteContext } from './context.js';

const SETUP_LOCK = 7_310_221_905;
export const passwordSchema = z.string().min(1).max(MAX_PASSWORD_LENGTH);
export const personNameSchema = z.string().trim().min(2).max(120);
const invalidCredentials = () => new ApiError(401, 'invalid_credentials', 'Correo o contraseña incorrectos.');
const setupClosed = () => new ApiError(403, 'setup_closed', 'El código de configuración no es válido o este servidor ya no admite la configuración inicial.');

export function authRoutes(app: FastifyInstance, context: RouteContext) {
  const { db, config, limiter } = context;
  const rules = config.rateLimits;
  const entry = { config: { publicEntry: true }, onRequest: limiter.hook(rules.auth) };
  const formatDate = new Intl.DateTimeFormat('es-MX', { dateStyle: 'long', timeStyle: 'short', timeZone: config.mail.timeZone });

  app.post('/auth/setup', entry, async (request, reply) => {
    const existing = await db.select({ id: workspaces.id }).from(workspaces).limit(1);
    if (existing.length) throw conflict('Este espacio de trabajo ya está configurado.');

    const body = z
      .object({
        workspaceName: z.string().trim().min(2).max(120),
        workspaceSlug: z.string().trim().regex(/^[a-z0-9-]{2,50}$/),
        name: personNameSchema,
        email: emailSchema,
        password: passwordSchema,
        locales: z.array(z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/)).min(1).max(10).optional(),
        setupToken: z.string().max(200).optional(),
      })
      .safeParse(request.body);

    if (config.environment === 'production' && !config.setupToken) throw setupClosed();
    if (config.setupToken && !safeCompare(config.setupToken, body.data?.setupToken ?? '')) throw setupClosed();
    if (!body.success) throw body.error;

    const input = body.data;
    assertStrongPassword(input.password, { email: input.email, name: input.name, workspace: input.workspaceName });
    const passwordHash = await hashPassword(input.password);
    const locales = input.locales ?? ['es'];

    const created = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${SETUP_LOCK})`);
      const again = await tx.select({ id: workspaces.id }).from(workspaces).limit(1);
      if (again.length) throw conflict('Este espacio de trabajo ya está configurado.');
      const [workspace] = await tx
        .insert(workspaces)
        .values({ name: input.workspaceName, slug: input.workspaceSlug, defaultLocale: locales[0]!, locales })
        .returning();
      const [user] = await tx.insert(users).values({ email: input.email, name: input.name, passwordHash }).returning();
      await tx.insert(members).values({ workspaceId: workspace!.id, userId: user!.id, role: 'owner' });
      return { workspace: workspace!, user: user! };
    });

    return reply.status(201).send({
      workspace: { id: created.workspace.id, name: created.workspace.name },
      user: { id: created.user.id, email: created.user.email },
    });
  });

  app.post('/auth/login', entry, async (request, reply) => {
    const body = z.object({ email: emailSchema, password: passwordSchema }).parse(request.body);
    limiter.enforce(rules.loginPerEmail, body.email, reply);
    const rows = await db.select().from(users).where(eq(users.email, body.email)).limit(1);
    const user = rows[0];
    const ok = await verifyPassword(body.password, user?.passwordHash ?? null);
    const membership = user && ok ? await loadMembership(db, user.id) : null;
    if (!user || !membership) {
      request.log.warn({ email: maskAddress(body.email) }, 'failed login');
      throw invalidCredentials();
    }

    const userAgent = request.headers['user-agent']?.slice(0, 400) ?? null;
    const known = await db.select({ userAgent: sessions.userAgent }).from(sessions).where(eq(sessions.userId, user.id));

    const { token } = await context.sessions.begin(request, reply, user.id);
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));

    if (known.length && !known.some((session) => session.userAgent === userAgent)) {
      const workspace = await context.loadWorkspace(membership.workspaceId);
      void context.notify(
        user.email,
        templates.newLogin({ workspace: workspace.name, when: formatDate.format(new Date()), device: describeDevice(userAgent) }),
      );
    }

    return {
      user: { id: user.id, name: user.name, email: user.email, role: membership.workspaceRole },
      csrfToken: csrfTokenFor(token),
    };
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

  app.post('/auth/password/forgot', entry, async (request, reply) => {
    const body = z.object({ email: emailSchema }).parse(request.body);
    const ip = request.ip;
    if (!limiter.hit(rules.forgotPerEmail, body.email).allowed) return reply.status(202).send({ ok: true });
    void (async () => {
      const rows = await db.select().from(users).where(eq(users.email, body.email)).limit(1);
      const user = rows[0];
      if (!user || !(await loadMembership(db, user.id))) return;
      const { token } = await createPasswordReset(db, user.id, config.passwordResetTtlMinutes, ip);
      await context.notify(
        user.email,
        templates.passwordReset({ url: `${config.publicUrl}/#reset=${token}`, expiresInMinutes: config.passwordResetTtlMinutes }),
      );
    })().catch((error: Error) => request.log.error({ reason: error.message }, 'password reset request failed'));
    return reply.status(202).send({ ok: true });
  });

  app.post('/auth/password/reset', entry, async (request) => {
    const body = z.object({ token: z.string().min(20).max(200), password: passwordSchema }).parse(request.body);
    const reset = await findPasswordReset(db, body.token);
    const membership = await loadMembership(db, reset.userId);
    const workspace = membership ? await context.loadWorkspace(membership.workspaceId) : null;
    assertStrongPassword(body.password, { email: reset.email, name: reset.name, workspace: workspace?.name ?? null });

    const { userId } = await consumePasswordReset(db, body.token, body.password);
    await revokeUserSessions(db, userId);
    if (workspace) void context.notify(reset.email, templates.passwordChanged({ workspace: workspace.name }));
    return { ok: true };
  });

  app.post('/auth/password', async (request) => {
    const user = await context.currentUser(request);
    const body = z.object({ currentPassword: passwordSchema, newPassword: passwordSchema }).parse(request.body);
    const [row] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, user.id));
    if (!(await verifyPassword(body.currentPassword, row?.passwordHash ?? null))) {
      throw new ApiError(400, 'invalid_current_password', 'Tu contraseña actual no es correcta.');
    }
    const workspace = await context.loadWorkspace(user.workspaceId);
    assertStrongPassword(body.newPassword, { email: user.email, name: user.name, workspace: workspace.name });

    await setPassword(db, user.id, body.newPassword);
    await revokeUserSessions(db, user.id, request.sessionId);
    void context.notify(user.email, templates.passwordChanged({ workspace: workspace.name }));
    return { ok: true };
  });
}
