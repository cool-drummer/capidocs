import { and, asc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { groupMembers, groups, invitations, members, spaceMembers, spaces, users } from '../db/schema.js';
import type { WorkspaceRole } from '../lib/access.js';
import { createToken, hashPassword, hashToken } from '../lib/auth.js';
import { ApiError, badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { revokeUserSessions } from './sessions.js';

export const invitationInvalid = () => new ApiError(400, 'invitation_invalid', 'Esta invitación ya no es válida. Pide una nueva.');

export interface MemberRow {
  userId: string;
  name: string;
  email: string;
  role: WorkspaceRole;
  lastLoginAt: Date | null;
}

export async function listMembers(db: Database, workspaceId: string): Promise<MemberRow[]> {
  const rows = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      role: members.role,
      lastLoginAt: users.lastLoginAt,
    })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(eq(members.workspaceId, workspaceId))
    .orderBy(asc(users.name));
  return rows.map((row) => ({ ...row, role: row.role as WorkspaceRole }));
}

export async function findMember(db: Database, workspaceId: string, userId: string) {
  const rows = await db
    .select({ id: members.id, role: members.role, email: users.email, name: users.name })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(and(eq(members.workspaceId, workspaceId), eq(members.userId, userId)))
    .limit(1);
  const member = rows[0];
  if (!member) throw notFound();
  return { ...member, role: member.role as WorkspaceRole };
}

export async function listInvitations(db: Database, workspaceId: string) {
  return db
    .select({
      id: invitations.id,
      email: invitations.email,
      role: invitations.role,
      expiresAt: invitations.expiresAt,
      createdAt: invitations.createdAt,
    })
    .from(invitations)
    .where(
      and(
        eq(invitations.workspaceId, workspaceId),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
        gt(invitations.expiresAt, new Date()),
      ),
    )
    .orderBy(asc(invitations.email));
}

export function assertCanAssign(actorRole: WorkspaceRole, ...roles: WorkspaceRole[]): void {
  if (roles.includes('owner')) throw forbidden();
  if (roles.includes('admin') && actorRole !== 'owner') throw forbidden();
}

export async function createInvitation(
  db: Database,
  workspaceId: string,
  invitedById: string,
  email: string,
  role: WorkspaceRole,
  ttlHours: number,
) {
  const existingMember = await db
    .select({ id: members.id })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(and(eq(members.workspaceId, workspaceId), sql`lower(${users.email}) = ${email.toLowerCase()}`))
    .limit(1);
  if (existingMember.length) throw conflict('Esa persona ya es parte del espacio de trabajo.');

  const { token, tokenHash } = createToken();
  const invitation = await db.transaction(async (tx) => {
    await tx
      .update(invitations)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(invitations.workspaceId, workspaceId),
          sql`lower(${invitations.email}) = ${email.toLowerCase()}`,
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
        ),
      );
    const [row] = await tx
      .insert(invitations)
      .values({
        workspaceId,
        email: email.toLowerCase(),
        role,
        tokenHash,
        invitedById,
        expiresAt: new Date(Date.now() + ttlHours * 3_600_000),
      })
      .returning();
    return row!;
  });
  return { invitation, token };
}

export async function revokeInvitation(db: Database, workspaceId: string, invitationId: string) {
  const revoked = await db
    .update(invitations)
    .set({ revokedAt: new Date() })
    .where(and(eq(invitations.id, invitationId), eq(invitations.workspaceId, workspaceId), isNull(invitations.acceptedAt)))
    .returning({ id: invitations.id });
  if (!revoked.length) throw notFound();
}

export async function inspectInvitation(db: Database, token: string) {
  const rows = await db
    .select()
    .from(invitations)
    .where(
      and(
        eq(invitations.tokenHash, hashToken(token)),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
        gt(invitations.expiresAt, new Date()),
      ),
    )
    .limit(1);
  const invitation = rows[0];
  if (!invitation) throw invitationInvalid();
  return invitation;
}

export async function acceptInvitation(db: Database, token: string, name: string, password: string) {
  const passwordHash = await hashPassword(password);
  const result = await db.transaction(async (tx) => {
    const claimed = await tx
      .update(invitations)
      .set({ acceptedAt: new Date() })
      .where(
        and(
          eq(invitations.tokenHash, hashToken(token)),
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
          gt(invitations.expiresAt, sql`now()`),
        ),
      )
      .returning();
    const invitation = claimed[0];
    if (!invitation) throw invitationInvalid();

    const existing = await tx
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${invitation.email.toLowerCase()}`)
      .limit(1);
    let userId = existing[0]?.id;
    if (userId) {
      await tx.update(users).set({ name, passwordHash, updatedAt: new Date() }).where(eq(users.id, userId));
    } else {
      const [user] = await tx.insert(users).values({ email: invitation.email.toLowerCase(), name, passwordHash }).returning();
      userId = user!.id;
    }

    const alreadyMember = await tx
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.workspaceId, invitation.workspaceId), eq(members.userId, userId)))
      .limit(1);
    if (alreadyMember.length) throw invitationInvalid();
    await tx.insert(members).values({
      workspaceId: invitation.workspaceId,
      userId,
      role: invitation.role,
      invitedById: invitation.invitedById,
    });
    return { userId, invitation, returning: !!existing[0] };
  });

  if (result.returning) await revokeUserSessions(db, result.userId);
  return result;
}

export async function updateMemberRole(
  db: Database,
  workspaceId: string,
  targetUserId: string,
  role: WorkspaceRole,
  actor: { id: string; role: WorkspaceRole },
) {
  if (targetUserId === actor.id) throw badRequest('No puedes cambiar tu propio rol.');
  const member = await findMember(db, workspaceId, targetUserId);
  if (member.role === 'owner') throw badRequest('No puedes cambiar el rol de quien es dueño del espacio de trabajo.');
  assertCanAssign(actor.role, member.role, role);
  if (member.role === role) return { changed: false, member };
  await db.update(members).set({ role }).where(eq(members.id, member.id));
  return { changed: true, member };
}

export async function removeMember(
  db: Database,
  workspaceId: string,
  targetUserId: string,
  actor: { id: string; role: WorkspaceRole },
) {
  if (targetUserId === actor.id) throw badRequest('No puedes quitar tu propia cuenta del espacio de trabajo.');
  const member = await findMember(db, workspaceId, targetUserId);
  if (member.role === 'owner') throw badRequest('No puedes quitar a quien es dueño del espacio de trabajo.');
  assertCanAssign(actor.role, member.role);

  await db.transaction(async (tx) => {
    const workspaceSpaces = tx.select({ id: spaces.id }).from(spaces).where(eq(spaces.workspaceId, workspaceId));
    await tx.delete(spaceMembers).where(and(eq(spaceMembers.userId, targetUserId), inArray(spaceMembers.spaceId, workspaceSpaces)));
    const workspaceGroups = tx.select({ id: groups.id }).from(groups).where(eq(groups.workspaceId, workspaceId));
    await tx.delete(groupMembers).where(and(eq(groupMembers.userId, targetUserId), inArray(groupMembers.groupId, workspaceGroups)));
    await tx.delete(members).where(eq(members.id, member.id));
  });
  await revokeUserSessions(db, targetUserId);
  return member;
}

export async function listSpaceMembers(db: Database, spaceId: string) {
  return db
    .select({
      id: spaceMembers.id,
      userId: spaceMembers.userId,
      groupId: spaceMembers.groupId,
      role: spaceMembers.role,
      name: users.name,
      email: users.email,
    })
    .from(spaceMembers)
    .leftJoin(users, eq(users.id, spaceMembers.userId))
    .where(eq(spaceMembers.spaceId, spaceId))
    .orderBy(asc(spaceMembers.role));
}

export async function setSpaceMember(
  db: Database,
  workspaceId: string,
  spaceId: string,
  userId: string,
  role: 'admin' | 'writer' | 'reader',
  addedById: string,
) {
  await findMember(db, workspaceId, userId);
  const existing = await db
    .select({ id: spaceMembers.id })
    .from(spaceMembers)
    .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, userId)))
    .limit(1);
  if (existing.length) {
    await db.update(spaceMembers).set({ role }).where(eq(spaceMembers.id, existing[0]!.id));
    return;
  }
  await db.insert(spaceMembers).values({ spaceId, userId, role, addedById });
}

export async function removeSpaceMember(db: Database, spaceId: string, userId: string) {
  await db.delete(spaceMembers).where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, userId)));
}
