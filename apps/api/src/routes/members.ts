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
  INVITATION_DAYS,
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

export function memberRoutes(app: FastifyInstance, context: RouteContext) {
  const { db, notify } = context;

  app.get('/members', async (request) => {
    const user = await context.currentUser(request);
    return { members: await listMembers(db, user.workspaceId), invitations: await listInvitations(db, user.workspaceId) };
  });

  app.post('/members/invitations', async (request, reply) => {
    const user = await context.currentUser(request);
    assertCan(actorFor(user), 'member.invite', { workspaceId: user.workspaceId });
    const body = z.object({ email: emailSchema, role: z.enum(['admin', 'member']) }).parse(request.body);
    const { invitation, token } = await createInvitation(db, user.workspaceId, user.id, body.email, body.role);
    const workspace = await context.loadWorkspace(user.workspaceId);
    await notify(
      body.email,
      templates.invitation({
        workspace: workspace.name,
        inviter: user.name,
        role: body.role,
        url: `${context.studioUrl}/?invitation=${token}`,
        expiresInDays: INVITATION_DAYS,
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

  app.get('/invitations/:token', async (request) => {
    const params = z.object({ token: z.string().min(10) }).parse(request.params);
    const invitation = await inspectInvitation(db, params.token);
    const workspace = await context.loadWorkspace(invitation.workspaceId);
    return { email: invitation.email, role: invitation.role, workspace: workspace.name };
  });

  app.post('/invitations/:token/accept', { config: { publicEntry: true } }, async (request, reply) => {
    const params = z.object({ token: z.string().min(10) }).parse(request.params);
    const body = z.object({ name: personNameSchema, password: passwordSchema }).parse(request.body);
    const pending = await inspectInvitation(db, params.token);
    const workspace = await context.loadWorkspace(pending.workspaceId);
    assertStrongPassword(body.password, { email: pending.email, name: body.name, workspace: workspace.name });
    const { userId, invitation } = await acceptInvitation(db, params.token, body.name, body.password);

    const inviter = (await db.select().from(users).where(eq(users.id, invitation.invitedById)).limit(1))[0];
    if (inviter) await notify(inviter.email, templates.invitationAccepted({ workspace: workspace.name, who: body.name, email: invitation.email }));
    await notify(invitation.email, templates.welcome({ workspace: workspace.name, url: context.studioUrl }));

    const { token: sessionToken } = await context.sessions.begin(request, reply, userId);
    return reply.status(201).send({ workspace: workspace.name, csrfToken: csrfTokenFor(sessionToken) });
  });

  app.put('/members/:userId', async (request) => {
    const user = await context.currentUser(request);
    assertCan(actorFor(user), 'member.update', { workspaceId: user.workspaceId });
    const params = z.object({ userId: z.string().uuid() }).parse(request.params);
    const body = z.object({ role: z.enum(['admin', 'member']) }).parse(request.body);
    await updateMemberRole(db, user.workspaceId, params.userId, body.role, user.id);
    return { ok: true };
  });

  app.delete('/members/:userId', async (request) => {
    const user = await context.currentUser(request);
    assertCan(actorFor(user), 'member.remove', { workspaceId: user.workspaceId });
    const params = z.object({ userId: z.string().uuid() }).parse(request.params);
    await removeMember(db, user.workspaceId, params.userId, user.id);
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
    await setSpaceMember(db, params.spaceId, params.userId, body.role, user.id);
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
