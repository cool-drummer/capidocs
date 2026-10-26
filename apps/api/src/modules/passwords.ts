import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { passwordResets, users } from '../db/schema.js';
import { createToken, hashPassword, hashToken } from '../lib/auth.js';
import { ApiError } from '../lib/errors.js';

export const resetInvalid = () => new ApiError(400, 'reset_invalid', 'Este enlace ya no es válido. Pide uno nuevo desde la pantalla de acceso.');

export async function createPasswordReset(
  db: Database,
  userId: string,
  ttlMinutes: number,
  ip: string | null,
): Promise<{ token: string }> {
  const now = new Date();
  await db
    .update(passwordResets)
    .set({ usedAt: now })
    .where(and(eq(passwordResets.userId, userId), isNull(passwordResets.usedAt)));
  const { token, tokenHash } = createToken();
  await db.insert(passwordResets).values({
    userId,
    tokenHash,
    expiresAt: new Date(now.getTime() + ttlMinutes * 60_000),
    requestedIp: ip?.slice(0, 64) ?? null,
  });
  return { token };
}

export async function findPasswordReset(db: Database, token: string) {
  const rows = await db
    .select({ id: passwordResets.id, userId: passwordResets.userId, email: users.email, name: users.name })
    .from(passwordResets)
    .innerJoin(users, eq(users.id, passwordResets.userId))
    .where(and(eq(passwordResets.tokenHash, hashToken(token)), isNull(passwordResets.usedAt), gt(passwordResets.expiresAt, new Date())))
    .limit(1);
  const reset = rows[0];
  if (!reset) throw resetInvalid();
  return reset;
}

export async function consumePasswordReset(db: Database, token: string, password: string): Promise<{ userId: string }> {
  const passwordHash = await hashPassword(password);
  return db.transaction(async (tx) => {
    const consumed = await tx
      .update(passwordResets)
      .set({ usedAt: new Date() })
      .where(and(eq(passwordResets.tokenHash, hashToken(token)), isNull(passwordResets.usedAt), gt(passwordResets.expiresAt, sql`now()`)))
      .returning({ userId: passwordResets.userId });
    const row = consumed[0];
    if (!row) throw resetInvalid();
    await tx.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, row.userId));
    await tx
      .update(passwordResets)
      .set({ usedAt: new Date() })
      .where(and(eq(passwordResets.userId, row.userId), isNull(passwordResets.usedAt)));
    return { userId: row.userId };
  });
}

export async function setPassword(db: Database, userId: string, password: string): Promise<void> {
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(password), updatedAt: new Date() })
    .where(eq(users.id, userId));
}
