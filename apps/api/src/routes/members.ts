import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { users } from '../db/schema.js';
import { assertCan } from '../lib/access.js';
import { csrfTokenFor } from '../lib/csrf.js';
import { templates } from '../lib/mail-templates.js';
import { assertStrongPassword } from '../lib/password-policy.js';
import { actorFor, loadSpaceSubject } from '../modules/context.js';
import {
  acceptInvitation,
  assertCanAssign,
  createInvitation,
  inspectInvitation,
  listInvitations,
  listMembers,
  listSpaceMembers,
  removeMember,
  removeSpaceMember,
  revokeInvitation,
  setSpaceMember,
  updateMemberRole,
} from '../modules/members.js';
import { passwordSchema, personNameSchema } from './auth.js';
import { emailSchema, type RouteContext } from './context.js';

const tokenSchema = z.string().min(20).max(200);
const workspaceRoleSchema = z.enum(['admin', 'member']);

export function memberRoutes(app: FastifyInstance, context: RouteContext) {
  const { db, notify, config, limiter } = context;
  const entry = { config: { publicEntry: true }, onRequest: limiter.hook(config.rateLimits.auth) };

  app.get('/members', async (request) => {
    const user = await context.currentUser(request);
    const canManage = user.workspaceRole === 'owner' || user.workspaceRole === 'admin';
    return {
      members: await listMembers(db, user.workspaceId),
      invitations: canManage ? await listInvitations(db, user.workspaceId) : [],
    };
  });

  app.post('/members/invitations', async (request, reply) => {
    const user = await context.currentUser(request);
    assertCan(actorFor(user), 'member.invite', { workspaceId: user.workspaceId });
    limiter.enforce(config.rateLimits.invitations, user.id, reply);
    const body = z.object({ email: emailSchema, role: workspaceRoleSchema }).parse(request.body);
    assertCanAssign(user.workspaceRole, body.role);

    const { invitation, token } = await createInvitation(db, user.workspaceId, user.id, body.email, body.role, config.invitationTtlHours);
    const workspace = await context.loadWorkspace(user.workspaceId);
    await notify(
      body.email,
      templates.invitation({
        workspace: workspace.name,
        inviter: user.name,
        role: body.role,
        url: `${config.publicUrl}/#invitation=${token}`,
        expiresInDays: Math.max(1, Math.round(config.invitationTtlHours / 24)),
      }),
    );
    return reply.status(201).send({ invitation: { id: invitation.id, email: invitation.email, role: invitation.role, expiresAt: invitation.expiresAt } });
  });

  app.delete('/members/invitations/:invitationId', async (request) => {
    const user = await context.currentUser(request);
    assertCan(actorFor(user), 'member.invite', { workspaceId: user.workspaceId });
    const params = z.object({ invitationId: z.string().uuid() }).parse(request.params);
    await revokeInvitation(db, user.workspaceId, params.invitationId);
    return { ok: true };
  });

  app.post('/invitations/inspect', entry, async (request) => {
    const body = z.object({ token: tokenSchema }).parse(request.body);
    const invitation = await inspectInvitation(db, body.token);
    const workspace = await context.loadWorkspace(invitation.workspaceId);
    return { email: invitation.email, role: invitation.role, workspace: workspace.name };
  });

  app.post('/invitations/accept', entry, async (request, reply) => {
    const body = z.object({ token: tokenSchema, name: personNameSchema, password: passwordSchema }).parse(request.body);
    const pending = await inspectInvitation(db, body.token);
    const workspace = await context.loadWorkspace(pending.workspaceId);
    assertStrongPassword(body.password, { email: pending.email, name: body.name, workspace: workspace.name });
    const { userId, invitation } = await acceptInvitation(db, body.token, body.name, body.password);

    const inviter = (await db.select().from(users).where(eq(users.id, invitation.invitedById)).limit(1))[0];
    if (inviter) void notify(inviter.email, templates.invitationAccepted({ workspace: workspace.name, who: body.name, email: invitation.email }));
    void notify(invitation.email, templates.welcome({ workspace: workspace.name, url: config.publicUrl }));

    const { token: sessionToken } = await context.sessions.begin(request, reply, userId);
    return reply.status(201).send({ workspace: workspace.name, csrfToken: csrfTokenFor(sessionToken) });
  });

  app.put('/members/:userId', async (request) => {
    const user = await context.currentUser(request);
    assertCan(actorFor(user), 'member.update', { workspaceId: user.workspaceId });
    const params = z.object({ userId: z.string().uuid() }).parse(request.params);
    const body = z.object({ role: workspaceRoleSchema }).parse(request.body);
    const { changed, member } = await updateMemberRole(db, user.workspaceId, params.userId, body.role, { id: user.id, role: user.workspaceRole });
    if (changed) {
      const workspace = await context.loadWorkspace(user.workspaceId);
      void notify(member.email, templates.roleChanged({ workspace: workspace.name, role: body.role, by: user.name }));
    }
    return { ok: true };
  });

  app.delete('/members/:userId', async (request) => {
    const user = await context.currentUser(request);
    assertCan(actorFor(user), 'member.remove', { workspaceId: user.workspaceId });
    const params = z.object({ userId: z.string().uuid() }).parse(request.params);
    const member = await removeMember(db, user.workspaceId, params.userId, { id: user.id, role: user.workspaceRole });
    const workspace = await context.loadWorkspace(user.workspaceId);
    void notify(member.email, templates.memberRemoved({ workspace: workspace.name }));
    return { ok: true };
  });

  app.get('/spaces/:spaceId/members', async (request) => {
    const user = await context.currentUser(request);
    const params = z.object({ spaceId: z.string().uuid() }).parse(request.params);
    const subject = await loadSpaceSubject(db, user.workspaceId, params.spaceId, user.id);
    assertCan(actorFor(user), 'page.read', subject);
    return { members: await listSpaceMembers(db, params.spaceId) };
  });

  app.put('/spaces/:spaceId/members/:userId', async (request) => {
    const user = await context.currentUser(request);
    const params = z.object({ spaceId: z.string().uuid(), userId: z.string().uuid() }).parse(request.params);
    const body = z.object({ role: z.enum(['admin', 'writer', 'reader']) }).parse(request.body);
    const subject = await loadSpaceSubject(db, user.workspaceId, params.spaceId, user.id);
    assertCan(actorFor(user), 'space.members', subject);
    await setSpaceMember(db, user.workspaceId, params.spaceId, params.userId, body.role, user.id);
    return { ok: true };
  });

  app.delete('/spaces/:spaceId/members/:userId', async (request) => {
    const user = await context.currentUser(request);
    const params = z.object({ spaceId: z.string().uuid(), userId: z.string().uuid() }).parse(request.params);
    const subject = await loadSpaceSubject(db, user.workspaceId, params.spaceId, user.id);
    assertCan(actorFor(user), 'space.members', subject);
    await removeSpaceMember(db, params.spaceId, params.userId);
    return { ok: true };
  });
}
