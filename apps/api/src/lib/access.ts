import { forbidden } from './errors.js';

export type WorkspaceRole = 'owner' | 'admin' | 'member';
export type SpaceRole = 'admin' | 'writer' | 'reader';
export type Audience = 'public' | 'customers' | 'internal';

export type Actor =
  | { kind: 'user'; userId: string; workspaceId: string; workspaceRole: WorkspaceRole }
  | { kind: 'customer'; customerId: string; portalId: string }
  | { kind: 'anonymous' };

export type Action =
  | 'workspace.update'
  | 'workspace.delete'
  | 'member.invite'
  | 'member.update'
  | 'member.remove'
  | 'group.manage'
  | 'portal.create'
  | 'portal.update'
  | 'space.create'
  | 'space.update'
  | 'space.delete'
  | 'space.members'
  | 'page.read'
  | 'page.create'
  | 'page.update'
  | 'page.move'
  | 'page.delete'
  | 'page.publish'
  | 'version.restore'
  | 'audit.read';

export interface Subject {
  workspaceId?: string;
  space?: { id: string; audience: Audience; portalId: string | null };
  spaceRole?: SpaceRole | null;
  portalId?: string | null;
}

const WORKSPACE_ONLY: Record<string, WorkspaceRole[]> = {
  'workspace.update': ['owner', 'admin'],
  'workspace.delete': ['owner'],
  'member.invite': ['owner', 'admin'],
  'member.update': ['owner', 'admin'],
  'member.remove': ['owner', 'admin'],
  'group.manage': ['owner', 'admin'],
  'portal.create': ['owner', 'admin'],
  'portal.update': ['owner', 'admin'],
  'space.create': ['owner', 'admin'],
  'audit.read': ['owner'],
};

const SPACE_ACTIONS: Record<string, SpaceRole[]> = {
  'space.update': ['admin'],
  'space.delete': ['admin'],
  'space.members': ['admin'],
  'page.publish': ['admin'],
  'version.restore': ['admin', 'writer'],
  'page.create': ['admin', 'writer'],
  'page.update': ['admin', 'writer'],
  'page.move': ['admin', 'writer'],
  'page.delete': ['admin'],
  'page.read': ['admin', 'writer', 'reader'],
};

export function highestSpaceRole(roles: (SpaceRole | null | undefined)[]): SpaceRole | null {
  const order: SpaceRole[] = ['admin', 'writer', 'reader'];
  for (const role of order) {
    if (roles.includes(role)) return role;
  }
  return null;
}

export function can(actor: Actor, action: Action, subject: Subject = {}): boolean {
  if (actor.kind === 'anonymous') {
    return action === 'page.read' && subject.space?.audience === 'public';
  }

  if (actor.kind === 'customer') {
    if (action !== 'page.read') return false;
    const audience = subject.space?.audience;
    if (audience !== 'customers' && audience !== 'public') return false;
    return subject.space?.portalId === actor.portalId;
  }

  if (subject.workspaceId && subject.workspaceId !== actor.workspaceId) return false;

  const workspaceRoles = WORKSPACE_ONLY[action];
  if (workspaceRoles) return workspaceRoles.includes(actor.workspaceRole);

  const spaceRoles = SPACE_ACTIONS[action];
  if (!spaceRoles) return false;
  if (!subject.space) return false;

  if (actor.workspaceRole === 'owner' || actor.workspaceRole === 'admin') return true;

  const role = subject.spaceRole ?? null;
  if (!role) return false;
  return spaceRoles.includes(role);
}

export function assertCan(actor: Actor, action: Action, subject: Subject = {}): void {
  if (!can(actor, action, subject)) throw forbidden();
}
