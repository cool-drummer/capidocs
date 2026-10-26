import { eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Database } from '../db/client.js';
import { sessions, workspaces } from '../db/schema.js';
import { hashToken, SESSION_COOKIE } from '../lib/auth.js';
import { notFound, unauthorized } from '../lib/errors.js';
import type { Mailer, MailMessage } from '../lib/mail.js';
import type { AttachmentStore } from '../modules/attachments.js';
import { loadMembership, type SessionUser } from '../modules/context.js';

export type Workspace = typeof workspaces.$inferSelect;

export interface RouteContext {
  db: Database;
  runtimeDir: string;
  studioUrl: string;
  secureCookies: boolean;
  mailer: Mailer;
  store: AttachmentStore;
  currentUser: (request: FastifyRequest) => Promise<SessionUser>;
  loadWorkspace: (workspaceId: string) => Promise<Workspace>;
  notify: (to: string, template: Omit<MailMessage, 'to'>) => Promise<void>;
}

export const emailSchema = z.string().trim().toLowerCase().email();

export function createRouteContext(input: {
  db: Database;
  runtimeDir: string;
  studioUrl: string;
  secureCookies: boolean;
  mailer: Mailer;
  store: AttachmentStore;
  onMailError: (error: unknown) => void;
}): RouteContext {
  const { db, mailer } = input;

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
    db,
    runtimeDir: input.runtimeDir,
    studioUrl: input.studioUrl,
    secureCookies: input.secureCookies,
    mailer,
    store: input.store,
    currentUser,
    loadWorkspace,
    notify,
  };
}
