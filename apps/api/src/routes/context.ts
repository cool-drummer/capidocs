import { eq } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.js';
import type { Database } from '../db/client.js';
import type { RateLimiter } from '../lib/rate-limit.js';
import { workspaces } from '../db/schema.js';
import { notFound, unauthorized } from '../lib/errors.js';
import type { Mailer, MailMessage } from '../lib/mail.js';
import type { AttachmentStore } from '../lib/storage.js';
import { loadMembership, type SessionUser } from '../modules/context.js';
import {
  resolveSession,
  revokeSession,
  sessionCookieName,
  sessionCookieOptions,
  startSession,
  type ActiveSession,
  type SessionPolicy,
} from '../modules/sessions.js';

export type Workspace = typeof workspaces.$inferSelect;

export interface SessionControl {
  policy: SessionPolicy;
  cookieName: string;
  tokenOf: (request: FastifyRequest) => string | null;
  begin: (request: FastifyRequest, reply: FastifyReply, userId: string) => Promise<{ token: string; session: ActiveSession }>;
  end: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

export interface RouteContext {
  config: Config;
  limiter: RateLimiter;
  db: Database;
  runtimeDir: string;
  studioUrl: string;
  sessions: SessionControl;
  mailer: Mailer;
  store: AttachmentStore;
  currentUser: (request: FastifyRequest) => Promise<SessionUser>;
  loadWorkspace: (workspaceId: string) => Promise<Workspace>;
  notify: (to: string, template: Omit<MailMessage, 'to'>) => Promise<void>;
}

export const emailSchema = z.string().trim().toLowerCase().max(320).email();

export function createRouteContext(input: {
  config: Config;
  limiter: RateLimiter;
  db: Database;
  runtimeDir: string;
  studioUrl: string;
  sessionPolicy: SessionPolicy;
  mailer: Mailer;
  store: AttachmentStore;
  onMailError: (error: unknown) => void;
}): RouteContext {
  const { db, mailer, sessionPolicy } = input;
  const cookieName = sessionCookieName(sessionPolicy.secure);

  const tokenOf = (request: FastifyRequest): string | null => request.cookies[cookieName] || null;

  const sessionControl: SessionControl = {
    policy: sessionPolicy,
    cookieName,
    tokenOf,
    async begin(request, reply, userId) {
      const presented = tokenOf(request);
      if (presented) await revokeSession(db, presented);
      const started = await startSession(db, userId, { userAgent: request.headers['user-agent'] ?? null, ip: request.ip }, sessionPolicy);
      reply.setCookie(cookieName, started.token, sessionCookieOptions(sessionPolicy));
      return started;
    },
    async end(request, reply) {
      const presented = tokenOf(request);
      if (presented) await revokeSession(db, presented);
      const { path, httpOnly, secure, sameSite } = sessionCookieOptions(sessionPolicy);
      reply.clearCookie(cookieName, { path, httpOnly, secure, sameSite });
    },
  };

  async function currentUser(request: FastifyRequest): Promise<SessionUser> {
    const token = tokenOf(request);
    if (!token) throw unauthorized();
    const session = await resolveSession(db, token, sessionPolicy);
    if (!session) throw unauthorized();
    const user = await loadMembership(db, session.userId);
    if (!user) throw unauthorized();
    request.user = user;
    request.sessionId = session.id;
    return user;
  }

  async function loadWorkspace(workspaceId: string): Promise<Workspace> {
    const rows = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
    const workspace = rows[0];
    if (!workspace) throw notFound();
    return workspace;
  }

  async function notify(to: string, template: Omit<MailMessage, 'to'>) {
    try {
      await mailer.send({ to, ...template });
    } catch (error) {
      input.onMailError(error);
    }
  }

  return {
    config: input.config,
    limiter: input.limiter,
    db,
    runtimeDir: input.runtimeDir,
    studioUrl: input.studioUrl,
    sessions: sessionControl,
    mailer,
    store: input.store,
    currentUser,
    loadWorkspace,
    notify,
  };
}
