import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { groupMembers, members, spaceMembers, spaces, users } from '../db/schema.js';
import { highestSpaceRole, type Actor, type SpaceRole, type Subject } from '../lib/access.js';
import { notFound } from '../lib/errors.js';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  workspaceId: string;
  workspaceRole: 'owner' | 'admin' | 'member';
}

export function actorFor(user: SessionUser): Actor {
  return { kind: 'user', userId: user.id, workspaceId: user.workspaceId, workspaceRole: user.workspaceRole };
}

export async function loadMembership(db: Database, userId: string): Promise<SessionUser | null> {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      workspaceId: members.workspaceId,
      workspaceRole: members.role,
    })
    .from(users)
    .innerJoin(members, eq(members.userId, users.id))
    .where(eq(users.id, userId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return { ...row, workspaceRole: row.workspaceRole as SessionUser['workspaceRole'] };
}

export async function spaceRoleFor(db: Database, spaceId: string, userId: string): Promise<SpaceRole | null> {
  const direct = await db
    .select({ role: spaceMembers.role })
    .from(spaceMembers)
    .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, userId)));

  const viaGroups = await db
    .select({ role: spaceMembers.role })
    .from(spaceMembers)
    .innerJoin(groupMembers, eq(groupMembers.groupId, spaceMembers.groupId))
    .where(and(eq(spaceMembers.spaceId, spaceId), eq(groupMembers.userId, userId)));

  return highestSpaceRole([...direct, ...viaGroups].map((row) => row.role as SpaceRole));
}

export interface SpaceSubject extends Subject {
  space: { id: string; audience: 'public' | 'customers' | 'internal'; portalId: string | null };
  spaceRole: SpaceRole | null;
  spaceName: string;
  spaceSlug: string;
}

export async function loadSpaceSubject(
  db: Database,
  workspaceId: string,
  spaceId: string,
  userId: string,
): Promise<SpaceSubject> {
  const rows = await db
    .select()
    .from(spaces)
    .where(and(eq(spaces.id, spaceId), eq(spaces.workspaceId, workspaceId), isNull(spaces.deletedAt)))
    .limit(1);
  const space = rows[0];
  if (!space) throw notFound();
  return {
    workspaceId,
    space: { id: space.id, audience: space.audience as SpaceSubject['space']['audience'], portalId: space.portalId },
    spaceRole: await spaceRoleFor(db, space.id, userId),
    spaceName: space.name,
    spaceSlug: space.slug,
  };
}

export async function visibleSpaceIds(db: Database, user: SessionUser): Promise<string[] | 'all'> {
  if (user.workspaceRole === 'owner' || user.workspaceRole === 'admin') return 'all';
  const rows = await db
    .selectDistinct({ spaceId: spaceMembers.spaceId })
    .from(spaceMembers)
    .leftJoin(groupMembers, eq(groupMembers.groupId, spaceMembers.groupId))
    .where(or(eq(spaceMembers.userId, user.id), eq(groupMembers.userId, user.id)));
  return rows.map((row) => row.spaceId);
}

export function spaceFilter(ids: string[] | 'all') {
  return ids === 'all' ? sql`true` : ids.length ? inArray(spaces.id, ids) : sql`false`;
}
