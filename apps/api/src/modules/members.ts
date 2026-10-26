import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { invitations, members, spaceMembers, users } from '../db/schema.js';
import { createToken, hashPassword, hashToken } from '../lib/auth.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import type { WorkspaceRole } from '../lib/access.js';

export const INVITATION_DAYS = 7;

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
    .where(and(eq(invitations.workspaceId, workspaceId), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)))
    .orderBy(asc(invitations.email));
}

export async function createInvitation(
  db: Database,
  workspaceId: string,
  invitedById: string,
  email: string,
  role: WorkspaceRole,
) {
  const existingMember = await db
    .select({ id: members.id })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(and(eq(members.workspaceId, workspaceId), sql`lower(${users.email}) = ${email.toLowerCase()}`))
    .limit(1);
  if (existingMember.length) throw conflict('Esa persona ya es parte del espacio de trabajo.');

  await db
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

  const { token, tokenHash } = createToken();
  const [invitation] = await db
    .insert(invitations)
    .values({
      workspaceId,
      email,
      role,
      tokenHash,
      invitedById,
      expiresAt: new Date(Date.now() + INVITATION_DAYS * 86400000),
    })
    .returning();
  return { invitation: invitation!, token };
}

export async function revokeInvitation(db: Database, workspaceId: string, invitationId: string) {
  const rows = await db
    .select({ id: invitations.id })
    .from(invitations)
    .where(and(eq(invitations.id, invitationId), eq(invitations.workspaceId, workspaceId)))
    .limit(1);
  if (!rows.length) throw notFound();
  await db.update(invitations).set({ revokedAt: new Date() }).where(eq(invitations.id, invitationId));
}

export async function inspectInvitation(db: Database, token: string) {
  const rows = await db
    .select()
    .from(invitations)
    .where(eq(invitations.tokenHash, hashToken(token)))
    .limit(1);
  const invitation = rows[0];
  if (!invitation || invitation.revokedAt || invitation.acceptedAt || invitation.expiresAt < new Date()) {
    throw badRequest('Esta invitación ya no es válida. Pide una nueva.');
  }
  return invitation;
}

export async function acceptInvitation(db: Database, token: string, name: string, password: string) {
  const invitation = await inspectInvitation(db, token);

  const existing = await db.select().from(users).where(sql`lower(${users.email}) = ${invitation.email.toLowerCase()}`).limit(1);
  let userId = existing[0]?.id;

  if (!userId) {
    const [user] = await db
      .insert(users)
      .values({ email: invitation.email.toLowerCase(), name, passwordHash: await hashPassword(password) })
      .returning();
    userId = user!.id;
  }

  const alreadyMember = await db
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.workspaceId, invitation.workspaceId), eq(members.userId, userId)))
    .limit(1);
  if (!alreadyMember.length) {
    await db.insert(members).values({
      workspaceId: invitation.workspaceId,
      userId,
      role: invitation.role,
      invitedById: invitation.invitedById,
    });
  }

  await db.update(invitations).set({ acceptedAt: new Date() }).where(eq(invitations.id, invitation.id));
  return { userId, invitation };
}

export async function updateMemberRole(
  db: Database,
  workspaceId: string,
  targetUserId: string,
  role: WorkspaceRole,
  actorId: string,
) {
  if (targetUserId === actorId) throw badRequest('No puedes cambiar tu propio rol.');
  const rows = await db
    .select({ id: members.id, role: members.role })
    .from(members)
    .where(and(eq(members.workspaceId, workspaceId), eq(members.userId, targetUserId)))
    .limit(1);
  const member = rows[0];
  if (!member) throw notFound();
  if (member.role === 'owner') throw badRequest('No puedes cambiar el rol de la persona dueña del espacio.');
  await db.update(members).set({ role }).where(eq(members.id, member.id));
}

export async function removeMember(db: Database, workspaceId: string, targetUserId: string, actorId: string) {
  if (targetUserId === actorId) throw badRequest('No puedes quitarte a ti misma del espacio.');
  const rows = await db
    .select({ id: members.id, role: members.role })
    .from(members)
    .where(and(eq(members.workspaceId, workspaceId), eq(members.userId, targetUserId)))
    .limit(1);
  const member = rows[0];
  if (!member) throw notFound();
  if (member.role === 'owner') throw badRequest('No puedes quitar a la persona dueña del espacio.');
  await db.delete(spaceMembers).where(eq(spaceMembers.userId, targetUserId));
  await db.delete(members).where(eq(members.id, member.id));
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
  spaceId: string,
  userId: string,
  role: 'admin' | 'writer' | 'reader',
  addedById: string,
) {
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
