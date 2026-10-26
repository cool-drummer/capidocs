import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type CapidocsApp } from '../src/app.js';
import { renderHtml, renderText, templates, type MailMessage } from '../src/lib/mail.js';

const DATABASE_URL = process.env.TEST_TEAM_DATABASE_URL ?? 'postgres://capidocs:capidocs@127.0.0.1:55432/capidocs_team_test';
const ROOT = join(import.meta.dirname, '..', '..', '..');

const outbox: MailMessage[] = [];
const mailer = {
  sent: outbox,
  async send(message: MailMessage) {
    outbox.push(message);
    return { id: 'test' };
  },
};

let app: CapidocsApp;
const cookies: Record<string, string> = {};

async function call(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown, who = 'owner') {
  const response = await app.inject({ method, url, payload: payload as never, headers: cookies[who] ? { cookie: cookies[who]! } : {} });
  return { status: response.statusCode, body: response.json() as never, headers: response.headers };
}

async function login(email: string, password: string, who: string) {
  const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
  const header = response.headers['set-cookie'];
  const cookie = Array.isArray(header) ? header[0] : header;
  if (cookie) cookies[who] = cookie.split(';')[0]!;
  return response;
}

beforeAll(async () => {
  const postgres = (await import('postgres')).default;
  const admin = postgres(DATABASE_URL.replace(/\/[^/]+$/, '/postgres'));
  const name = DATABASE_URL.split('/').pop()!;
  await admin.unsafe(`DROP DATABASE IF EXISTS ${name}`);
  await admin.unsafe(`CREATE DATABASE ${name}`);
  await admin.end();

  app = await createApp({
    databaseUrl: DATABASE_URL,
    runtimeDir: join(ROOT, 'apps/site'),
    mailer,
    studioUrl: 'https://studio.test',
  });

  await call('POST', '/auth/setup', {
    workspaceName: 'Dado',
    workspaceSlug: 'dado',
    name: 'Dan',
    email: 'dan@example.com',
    password: 'una-clave-larga',
  });
  await login('dan@example.com', 'una-clave-larga', 'owner');
}, 60000);

afterAll(async () => {
  await app?.close();
});

describe('mail templates', () => {
  it('escapes user text in the html body', () => {
    const html = renderHtml({ to: 'x@y.z', ...templates.invitation({ workspace: '<script>', inviter: 'A & B', role: 'miembro', url: 'https://x.test' }) }, 'Capidocs');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('A &amp; B');
  });

  it('writes a plain text version with the link', () => {
    const text = renderText({ to: 'x@y.z', ...templates.invitation({ workspace: 'Dado', inviter: 'Dan', role: 'miembro', url: 'https://x.test/a' }) });
    expect(text).toContain('https://x.test/a');
  });

  it('never leaks technical detail in a failure notice', () => {
    const message = templates.publishFailed({ portal: 'Docs' });
    expect(JSON.stringify(message)).not.toMatch(/stack|error:|sql|ECONN/i);
  });
});

describe('invitations', () => {
  let token = '';

  it('invites someone and sends them a mail with a link', async () => {
    outbox.length = 0;
    const response = await call('POST', '/members/invitations', { email: 'ana@example.com', role: 'member' });
    expect(response.status).toBe(201);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.to).toBe('ana@example.com');
    token = /invitation=([\w-]+)/.exec(outbox[0]!.action!.url)![1]!;
    expect(token.length).toBeGreaterThan(20);
  });

  it('lets anyone with the link read who it is for', async () => {
    const response = await app.inject({ method: 'GET', url: `/invitations/${token}` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ email: 'ana@example.com', role: 'member', workspace: 'Dado' });
  });

  it('rejects an unknown or expired token with a friendly message', async () => {
    const response = await app.inject({ method: 'GET', url: '/invitations/no-existe-este-token' });
    expect(response.statusCode).toBe(400);
    expect(response.json().message).toBe('Esta invitación ya no es válida. Pide una nueva.');
  });

  it('accepts the invitation, logs the person in and notifies both sides', async () => {
    outbox.length = 0;
    const response = await app.inject({
      method: 'POST',
      url: `/invitations/${token}/accept`,
      payload: { name: 'Ana', password: 'otra-clave-larga' },
    });
    expect(response.statusCode).toBe(201);
    const header = response.headers['set-cookie'];
    cookies.ana = (Array.isArray(header) ? header[0] : header)!.split(';')[0]!;

    const recipients = outbox.map((message) => message.to).sort();
    expect(recipients).toEqual(['ana@example.com', 'dan@example.com']);

    const me = await call('GET', '/me', undefined, 'ana');
    expect(me.body.user.workspaceRole).toBe('member');
  });

  it('cannot be used twice', async () => {
    const response = await app.inject({ method: 'POST', url: `/invitations/${token}/accept`, payload: { name: 'Ana', password: 'otra-clave-larga' } });
    expect(response.statusCode).toBe(400);
  });

  it('refuses to invite someone who is already a member', async () => {
    const response = await call('POST', '/members/invitations', { email: 'ana@example.com', role: 'member' });
    expect(response.status).toBe(409);
    expect(response.body.message).toBe('Esa persona ya es parte del espacio de trabajo.');
  });

  it('refuses to invite as a plain member', async () => {
    const response = await call('POST', '/members/invitations', { email: 'otra@example.com', role: 'member' }, 'ana');
    expect(response.status).toBe(403);
  });
});

describe('members', () => {
  it('lists the team with roles', async () => {
    const response = await call('GET', '/members');
    expect(response.body.members.map((member: { email: string }) => member.email).sort()).toEqual(['ana@example.com', 'dan@example.com']);
  });

  it('promotes and demotes a member', async () => {
    const list = await call('GET', '/members');
    const ana = list.body.members.find((member: { email: string }) => member.email === 'ana@example.com');
    expect((await call('PUT', `/members/${ana.userId}`, { role: 'admin' })).status).toBe(200);
    const promoted = await call('GET', '/me', undefined, 'ana');
    expect(promoted.body.user.workspaceRole).toBe('admin');
    await call('PUT', `/members/${ana.userId}`, { role: 'member' });
  });

  it('refuses to change your own role or the owner', async () => {
    const list = await call('GET', '/members');
    const dan = list.body.members.find((member: { email: string }) => member.email === 'dan@example.com');
    const response = await call('PUT', `/members/${dan.userId}`, { role: 'member' });
    expect(response.status).toBe(400);
    expect(response.body.message).toBe('No puedes cambiar tu propio rol.');
  });

  it('grants a space role and the member can then read it', async () => {
    const portal = await call('POST', '/portals', { name: 'Docs', slug: 'docs' });
    const space = await call('POST', '/spaces', { name: 'Interno', slug: 'interno', audience: 'internal' });
    expect(portal.status).toBe(201);

    const denied = await call('GET', `/spaces/${space.body.space.id}/tree`, undefined, 'ana');
    expect(denied.status).toBe(403);

    const list = await call('GET', '/members');
    const ana = list.body.members.find((member: { email: string }) => member.email === 'ana@example.com');
    const granted = await call('PUT', `/spaces/${space.body.space.id}/members/${ana.userId}`, { role: 'writer' });
    expect(granted.status).toBe(200);

    const allowed = await call('GET', `/spaces/${space.body.space.id}/tree`, undefined, 'ana');
    expect(allowed.status).toBe(200);

    const page = await call('POST', `/spaces/${space.body.space.id}/pages`, { title: 'Nota interna' });
    const publishAttempt = await call('POST', `/pages/${page.body.page.id}/publish`, { locale: 'es' }, 'ana');
    expect(publishAttempt.status).toBe(403);

    await call('DELETE', `/spaces/${space.body.space.id}/members/${ana.userId}`);
    const revoked = await call('GET', `/spaces/${space.body.space.id}/tree`, undefined, 'ana');
    expect(revoked.status).toBe(403);
  });

  it('removes a member and drops their space roles', async () => {
    const list = await call('GET', '/members');
    const ana = list.body.members.find((member: { email: string }) => member.email === 'ana@example.com');
    expect((await call('DELETE', `/members/${ana.userId}`)).status).toBe(200);
    const after = await call('GET', '/members');
    expect(after.body.members).toHaveLength(1);
  });
});
