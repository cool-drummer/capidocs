import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { and, asc, desc, eq, gt, isNull, like, or } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { portalReaders, portals, readerCodes, readerSessions } from '../db/schema.js';
import { createToken, hashToken } from '../lib/auth.js';
import { ApiError, badRequest } from '../lib/errors.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN = /^@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const TOUCH_AFTER_MS = 60_000;

export const readerCodeInvalid = () => new ApiError(400, 'reader_code_invalid', 'El código no es válido o ya venció. Pide uno nuevo.');

export interface ReaderPolicy {
  codeTtlMinutes: number;
  maxCodeAttempts: number;
  idleHours: number;
  absoluteDays: number;
}

export interface ReaderSession {
  id: string;
  portalId: string;
  email: string;
}

export function normalizePattern(input: string): string {
  const pattern = input.trim().toLowerCase();
  if (pattern.length > 320 || !(EMAIL.test(pattern) || DOMAIN.test(pattern))) {
    throw badRequest('Escribe un correo completo (ana@empresa.com) o un dominio que empiece con @ (@empresa.com).');
  }
  return pattern;
}

function domainOf(email: string): string {
  return `@${email.slice(email.lastIndexOf('@') + 1)}`;
}

function codeHash(secret: Buffer, portalId: string, email: string, code: string): string {
  return createHmac('sha256', secret).update(`${portalId}\0${email}\0${code}`).digest('hex');
}

function sameHash(expected: string, presented: string): boolean {
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(presented, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function findPortalBySlug(db: Database, slug: string) {
  const rows = await db.select().from(portals).where(eq(portals.slug, slug)).orderBy(asc(portals.createdAt)).limit(1);
  return rows[0] ?? null;
}

export async function listReaders(db: Database, portalId: string) {
  return db
    .select({ id: portalReaders.id, pattern: portalReaders.pattern, createdAt: portalReaders.createdAt })
    .from(portalReaders)
    .where(eq(portalReaders.portalId, portalId))
    .orderBy(asc(portalReaders.pattern));
}

export async function addReader(db: Database, portalId: string, pattern: string, addedById: string) {
  const [row] = await db
    .insert(portalReaders)
    .values({ portalId, pattern, addedById })
    .onConflictDoNothing()
    .returning({ id: portalReaders.id, pattern: portalReaders.pattern, createdAt: portalReaders.createdAt });
  return row ?? null;
}

export async function removeReader(db: Database, portalId: string, readerId: string): Promise<boolean> {
  const removed = await db
    .delete(portalReaders)
    .where(and(eq(portalReaders.id, readerId), eq(portalReaders.portalId, portalId)))
    .returning({ pattern: portalReaders.pattern });
  const pattern = removed[0]?.pattern;
  if (!pattern) return false;
  const matches = pattern.startsWith('@') ? like(readerSessions.email, `%${pattern}`) : eq(readerSessions.email, pattern);
  await db
    .update(readerSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(readerSessions.portalId, portalId), isNull(readerSessions.revokedAt), matches));
  return true;
}

export async function isAllowedReader(db: Database, portalId: string, email: string): Promise<boolean> {
  const rows = await db
    .select({ id: portalReaders.id })
    .from(portalReaders)
    .where(and(eq(portalReaders.portalId, portalId), or(eq(portalReaders.pattern, email), eq(portalReaders.pattern, domainOf(email)))))
    .limit(1);
  return rows.length > 0;
}

export async function issueReaderCode(db: Database, secret: Buffer, portalId: string, email: string, policy: ReaderPolicy): Promise<string> {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(readerCodes)
      .set({ usedAt: now })
      .where(and(eq(readerCodes.portalId, portalId), eq(readerCodes.email, email), isNull(readerCodes.usedAt)));
    await tx.insert(readerCodes).values({
      portalId,
      email,
      codeHash: codeHash(secret, portalId, email, code),
      expiresAt: new Date(now.getTime() + policy.codeTtlMinutes * 60_000),
    });
  });
  return code;
}

export async function consumeReaderCode(
  db: Database,
  secret: Buffer,
  portalId: string,
  email: string,
  code: string,
  policy: ReaderPolicy,
): Promise<void> {
  const accepted = await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(readerCodes)
      .where(and(eq(readerCodes.portalId, portalId), eq(readerCodes.email, email), isNull(readerCodes.usedAt), gt(readerCodes.expiresAt, new Date())))
      .orderBy(desc(readerCodes.createdAt))
      .limit(1)
      .for('update');
    const current = rows[0];
    if (!current || current.attempts >= policy.maxCodeAttempts) return false;
    if (!sameHash(current.codeHash, codeHash(secret, portalId, email, code))) {
      await tx.update(readerCodes).set({ attempts: current.attempts + 1 }).where(eq(readerCodes.id, current.id));
      return false;
    }
    await tx.update(readerCodes).set({ usedAt: new Date() }).where(eq(readerCodes.id, current.id));
    return true;
  });
  if (!accepted || !(await isAllowedReader(db, portalId, email))) throw readerCodeInvalid();
}

export async function startReaderSession(db: Database, portalId: string, email: string, policy: ReaderPolicy, now = new Date()) {
  const { token, tokenHash } = createToken();
  await db.insert(readerSessions).values({
    portalId,
    email,
    tokenHash,
    expiresAt: new Date(now.getTime() + policy.absoluteDays * 86_400_000),
    lastSeenAt: now,
  });
  return { token };
}

export async function resolveReaderSession(
  db: Database,
  token: string,
  portalId: string,
  policy: ReaderPolicy,
  now = new Date(),
): Promise<ReaderSession | null> {
  const rows = await db
    .select()
    .from(readerSessions)
    .where(and(eq(readerSessions.tokenHash, hashToken(token)), eq(readerSessions.portalId, portalId)))
    .limit(1);
  const session = rows[0];
  if (!session || session.revokedAt) return null;
  const idleDeadline = session.lastSeenAt.getTime() + policy.idleHours * 3_600_000;
  if (session.expiresAt <= now || idleDeadline <= now.getTime() || !(await isAllowedReader(db, portalId, session.email))) {
    await db.update(readerSessions).set({ revokedAt: now }).where(eq(readerSessions.id, session.id));
    return null;
  }
  if (now.getTime() - session.lastSeenAt.getTime() > TOUCH_AFTER_MS) {
    await db.update(readerSessions).set({ lastSeenAt: now }).where(eq(readerSessions.id, session.id));
  }
  return { id: session.id, portalId: session.portalId, email: session.email };
}

export async function revokeReaderSession(db: Database, token: string): Promise<void> {
  await db
    .update(readerSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(readerSessions.tokenHash, hashToken(token)), isNull(readerSessions.revokedAt)));
}

export function readerCookieName(portalId: string, secure: boolean): string {
  const name = `capidocs_reader_${portalId.replace(/-/g, '')}`;
  return secure ? `__Host-${name}` : name;
}
