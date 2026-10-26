import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type CapidocsApp } from '../src/app.js';
import { invitations } from '../src/db/schema.js';
import { Client, memoryMailer, resetDatabase, testConfig, testDatabaseUrl } from './helpers.js';

const DATABASE_URL = testDatabaseUrl('capidocs_members_test');
const PASSWORD = 'una-clave-bastante-larga';
const mailer = memoryMailer();
let app: CapidocsApp;
let owner: Client;

async function eventually<T>(read: () => T | undefined, timeoutMs = 2000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('condition not met in time');
}

const lastMailTo = (address: string, subject?: string) => () =>
  [...mailer.sent].reverse().find((message) => message.to === address && (!subject || message.subject === subject));

async function invite(by: Client, email: string, role: 'admin' | 'member' = 'member'): Promise<string> {
  const response = await by.call('POST', '/members/invitations', { email, role });
  expect(response.status).toBe(201);
  const message = await eventually(lastMailTo(email));
  return /#invitation=([\w-]+)/.exec(message.action!.url)![1]!;
}

async function join(email: string, name: string, role: 'admin' | 'member' = 'member'): Promise<Client> {
  const token = await invite(owner, email, role);
  const client = new Client(app);
  const response = await client.request('POST', '/invitations/accept', { payload: { token, name, password: PASSWORD } });
  expect(response.statusCode).toBe(201);
  client.adopt(response);
  return client;
}

async function userIdOf(email: string): Promise<string> {
  const list = await owner.call('GET', '/members');
  return (list.body.members as { email: string; userId: string }[]).find((member) => member.email === email)!.userId;
}

beforeAll(async () => {
  await resetDatabase(DATABASE_URL);
  app = await createApp(testConfig(DATABASE_URL), { mailer });
  owner = new Client(app);
  await owner.call('POST', '/auth/setup', { workspaceName: 'Acme', workspaceSlug: 'acme', name: 'Dueña', email: 'owner@example.com', password: PASSWORD });
  await owner.login('owner@example.com', PASSWORD);
}, 60000);

afterAll(async () => {
  await app?.close();
});

describe('invitations', () => {
  let token = '';

  it('mails a link that carries the token in the fragment and stores only its hash', async () => {
    token = await invite(owner, 'ana@example.com');
    const message = await eventually(lastMailTo('ana@example.com'));
    expect(message.action!.url).toMatch(/^https:\/\/studio\.test\/#invitation=/);
    const stored = await app.db.select().from(invitations).where(eq(invitations.email, 'ana@example.com'));
    expect(stored[0]!.tokenHash).not.toBe(token);
    expect(token.length).toBeGreaterThan(30);
  });

  it('tells the holder of the link who it is for', async () => {
    const response = await new Client(app).call('POST', '/invitations/inspect', { token });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ email: 'ana@example.com', role: 'member', workspace: 'Acme' });
  });

  it('rejects an unknown token with a friendly message', async () => {
    const response = await new Client(app).call('POST', '/invitations/inspect', { token: 'x'.repeat(43) });
    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Esta invitación ya no es válida. Pide una nueva.');
  });

  it('refuses a weak password without spending the invitation', async () => {
    const weak = await new Client(app).call('POST', '/invitations/accept', { token, name: 'Ana', password: 'password1234' });
    expect(weak.status).toBe(400);
    expect(weak.body.error).toBe('weak_password');
    expect((await new Client(app).call('POST', '/invitations/inspect', { token })).status).toBe(200);
  });

  it('accepts once, signs the person in and notifies both sides', async () => {
    const ana = new Client(app);
    const response = await ana.request('POST', '/invitations/accept', { payload: { token, name: 'Ana', password: PASSWORD } });
    expect(response.statusCode).toBe(201);
    ana.adopt(response);
    expect(ana.csrf).not.toBe('');
    expect((await ana.call('GET', '/me')).body.user.workspaceRole).toBe('member');

    await eventually(lastMailTo('owner@example.com', 'Ana aceptó tu invitación'));
    await eventually(lastMailTo('ana@example.com', 'Bienvenido a Acme'));

    const again = await new Client(app).call('POST', '/invitations/accept', { token, name: 'Ana', password: PASSWORD });
    expect(again.status).toBe(400);
  });

  it('lets only one of two simultaneous acceptances through', async () => {
    const carla = await invite(owner, 'carla@example.com');
    const attempts = await Promise.all(
      [0, 1, 2].map(() => new Client(app).call('POST', '/invitations/accept', { token: carla, name: 'Carla', password: PASSWORD })),
    );
    expect(attempts.filter((attempt) => attempt.status === 201)).toHaveLength(1);
  });

  it('rejects an expired invitation', async () => {
    const late = await invite(owner, 'tarde@example.com');
    await app.db.update(invitations).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(invitations.email, 'tarde@example.com'));
    expect((await new Client(app).call('POST', '/invitations/accept', { token: late, name: 'Tarde', password: PASSWORD })).status).toBe(400);
  });

  it('refuses to invite someone who is already a member', async () => {
    const response = await owner.call('POST', '/members/invitations', { email: 'ana@example.com', role: 'member' });
    expect(response.status).toBe(409);
  });

  it('keeps invitations away from plain members', async () => {
    const ana = new Client(app);
    await ana.login('ana@example.com', PASSWORD);
    expect((await ana.call('POST', '/members/invitations', { email: 'otra@example.com', role: 'member' })).status).toBe(403);
    await invite(owner, 'pendiente@example.com');
    expect((await ana.call('GET', '/members')).body.invitations).toEqual([]);
    expect((await owner.call('GET', '/members')).body.invitations.length).toBeGreaterThan(0);
  });
});

describe('workspace roles', () => {
  let admin: Client;
  let member: Client;

  beforeAll(async () => {
    admin = await join('admin@example.com', 'Admin', 'admin');
    member = await join('miembro@example.com', 'Miembro');
  });

  it('lets the owner promote and notifies the person', async () => {
    const beto = await join('beto@example.com', 'Beto');
    const response = await owner.call('PUT', `/members/${await userIdOf('beto@example.com')}`, { role: 'admin' });
    expect(response.status).toBe(200);
    expect((await beto.call('GET', '/me')).body.user.workspaceRole).toBe('admin');
    const notice = await eventually(lastMailTo('beto@example.com', 'Tu rol en Acme cambió'));
    expect(notice.body.join(' ')).toContain('administración');
  });

  it('stops an admin from creating or touching other admins', async () => {
    expect((await admin.call('POST', '/members/invitations', { email: 'nuevo-admin@example.com', role: 'admin' })).status).toBe(403);
    expect((await admin.call('PUT', `/members/${await userIdOf('miembro@example.com')}`, { role: 'admin' })).status).toBe(403);
    expect((await admin.call('PUT', `/members/${await userIdOf('beto@example.com')}`, { role: 'member' })).status).toBe(403);
    expect((await admin.call('DELETE', `/members/${await userIdOf('beto@example.com')}`)).status).toBe(403);
  });

  it('never lets anyone change their own role or the owner', async () => {
    expect((await admin.call('PUT', `/members/${await userIdOf('admin@example.com')}`, { role: 'member' })).status).toBe(400);
    expect((await admin.call('DELETE', `/members/${await userIdOf('owner@example.com')}`)).status).toBe(400);
  });

  it('refuses workspace management to a plain member', async () => {
    expect((await member.call('PUT', `/members/${await userIdOf('ana@example.com')}`, { role: 'admin' })).status).toBe(403);
    expect((await member.call('DELETE', `/members/${await userIdOf('ana@example.com')}`)).status).toBe(403);
  });

  it('lets an admin remove a plain member, ending their sessions at once', async () => {
    const response = await admin.call('DELETE', `/members/${await userIdOf('miembro@example.com')}`);
    expect(response.status).toBe(200);
    expect((await member.call('GET', '/me')).status).toBe(401);
    await eventually(lastMailTo('miembro@example.com', 'Ya no tienes acceso a Acme'));
  });

  it('lets a removed person come back only through a new invitation', async () => {
    expect((await new Client(app).login('miembro@example.com', PASSWORD)).statusCode).toBe(401);
    const token = await invite(owner, 'miembro@example.com');
    const back = new Client(app);
    const response = await back.request('POST', '/invitations/accept', { payload: { token, name: 'Miembro', password: 'otra frase de regreso' } });
    expect(response.statusCode).toBe(201);
    expect((await new Client(app).login('miembro@example.com', PASSWORD)).statusCode).toBe(401);
    expect((await new Client(app).login('miembro@example.com', 'otra frase de regreso')).statusCode).toBe(200);
  });
});

describe('space access', () => {
  let spaceId = '';
  let otherSpaceId = '';
  let ana: Client;

  beforeAll(async () => {
    spaceId = (await owner.call('POST', '/spaces', { name: 'Interno', slug: 'interno', audience: 'internal' })).body.space.id;
    otherSpaceId = (await owner.call('POST', '/spaces', { name: 'Finanzas', slug: 'finanzas', audience: 'internal' })).body.space.id;
    ana = new Client(app);
    await ana.login('ana@example.com', PASSWORD);
  });

  it('denies a member with no role, then lets a writer in without publishing rights', async () => {
    expect((await ana.call('GET', `/spaces/${spaceId}/tree`)).status).toBe(403);
    expect((await owner.call('PUT', `/spaces/${spaceId}/members/${await userIdOf('ana@example.com')}`, { role: 'writer' })).status).toBe(200);
    expect((await ana.call('GET', `/spaces/${spaceId}/tree`)).status).toBe(200);

    const page = await owner.call('POST', `/spaces/${spaceId}/pages`, { title: 'Nota interna' });
    expect((await ana.call('POST', `/pages/${page.body.page.id}/publish`, { locale: 'es' })).status).toBe(403);
    expect((await ana.call('PUT', `/spaces/${spaceId}/members/${await userIdOf('ana@example.com')}`, { role: 'admin' })).status).toBe(403);
  });

  it('refuses to grant a role to someone outside the workspace', async () => {
    expect((await owner.call('PUT', `/spaces/${spaceId}/members/${randomUUID()}`, { role: 'reader' })).status).toBe(404);
  });

  it('lets a space admin manage only their own space', async () => {
    await owner.call('PUT', `/spaces/${spaceId}/members/${await userIdOf('ana@example.com')}`, { role: 'admin' });
    const carla = await userIdOf('carla@example.com');
    expect((await ana.call('PUT', `/spaces/${spaceId}/members/${carla}`, { role: 'reader' })).status).toBe(200);
    expect((await ana.call('PUT', `/spaces/${otherSpaceId}/members/${carla}`, { role: 'reader' })).status).toBe(403);
    expect((await ana.call('GET', `/spaces/${otherSpaceId}/members`)).status).toBe(403);
  });

  it('takes access away again', async () => {
    await owner.call('DELETE', `/spaces/${spaceId}/members/${await userIdOf('ana@example.com')}`);
    expect((await ana.call('GET', `/spaces/${spaceId}/tree`)).status).toBe(403);
  });
});
