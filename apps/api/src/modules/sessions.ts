import { and, eq, isNotNull, lt, ne, or, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { sessions } from '../db/schema.js';
import { createToken, hashToken } from '../lib/auth.js';

export interface SessionPolicy {
  idleMinutes: number;
  absoluteHours: number;
  secure: boolean;
}

export interface ActiveSession {
  id: string;
  userId: string;
}

const TOUCH_AFTER_MS = 60_000;

export function sessionCookieName(secure: boolean): string {
  return secure ? '__Host-capidocs_session' : 'capidocs_session';
}

export function sessionCookieOptions(policy: SessionPolicy) {
  return {
    path: '/',
    httpOnly: true,
    secure: policy.secure,
    sameSite: 'strict' as const,
    maxAge: policy.absoluteHours * 3600,
  };
}

export async function startSession(
  db: Database,
  userId: string,
  meta: { userAgent: string | null; ip: string | null },
  policy: SessionPolicy,
  now = new Date(),
): Promise<{ token: string; session: ActiveSession }> {
  const { token, tokenHash } = createToken();
  const [row] = await db
    .insert(sessions)
    .values({
      userId,
      tokenHash,
      expiresAt: new Date(now.getTime() + policy.absoluteHours * 3_600_000),
      lastSeenAt: now,
      userAgent: meta.userAgent?.slice(0, 400) ?? null,
      ip: meta.ip?.slice(0, 64) ?? null,
    })
    .returning({ id: sessions.id, userId: sessions.userId });
  return { token, session: row! };
}

export async function resolveSession(db: Database, token: string, policy: SessionPolicy, now = new Date()): Promise<ActiveSession | null> {
  const rows = await db.select().from(sessions).where(eq(sessions.tokenHash, hashToken(token))).limit(1);
  const session = rows[0];
  if (!session || session.revokedAt) return null;

  const idleDeadline = session.lastSeenAt.getTime() + policy.idleMinutes * 60_000;
  if (session.expiresAt <= now || idleDeadline <= now.getTime()) {
    await db.update(sessions).set({ revokedAt: now }).where(eq(sessions.id, session.id));
    return null;
  }

  if (now.getTime() - session.lastSeenAt.getTime() > TOUCH_AFTER_MS) {
    await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, session.id));
  }
  return { id: session.id, userId: session.userId };
}

export async function revokeSession(db: Database, token: string): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.tokenHash, hashToken(token)), sql`${sessions.revokedAt} IS NULL`));
}

export async function revokeUserSessions(db: Database, userId: string, keepSessionId?: string): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(sessions.userId, userId),
        sql`${sessions.revokedAt} IS NULL`,
        ...(keepSessionId ? [ne(sessions.id, keepSessionId)] : []),
      ),
    );
}

export async function purgeSessions(db: Database, now = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - 7 * 86_400_000);
  await db.delete(sessions).where(or(lt(sessions.expiresAt, cutoff), and(isNotNull(sessions.revokedAt), lt(sessions.revokedAt, cutoff))));
}
