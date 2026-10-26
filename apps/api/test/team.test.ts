import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type CapidocsApp } from '../src/app.js';
import { detectMime, storageKeyFor } from '../src/modules/attachments.js';
import type { MailMessage } from '../src/lib/mail.js';
import { Client, resetDatabase, testConfig, testDatabaseUrl } from './helpers.js';

const DATABASE_URL = process.env.TEST_TEAM_DATABASE_URL ?? testDatabaseUrl('capidocs_team_test');

const outbox: MailMessage[] = [];
const mailer = {
  sent: outbox,
  async send(message: MailMessage) {
    outbox.push(message);
    return { id: 'test' };
  },
};

let app: CapidocsApp;
let filesDir: string;
const clients: Record<string, Client> = {};
const client = (who: string) => (clients[who] ??= new Client(app));

async function call(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown, who = 'owner') {
  return client(who).call(method, url, payload);
}

async function login(email: string, password: string, who: string) {
  return client(who).login(email, password);
}

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex');

beforeAll(async () => {
  await resetDatabase(DATABASE_URL);

  filesDir = await mkdtemp(join(tmpdir(), 'capidocs-files-'));
  app = await createApp(testConfig(DATABASE_URL, { FILES_DIR: filesDir }), { mailer });

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
  if (filesDir) await rm(filesDir, { recursive: true, force: true });
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
    const response = await new Client(app).request('GET', `/invitations/${token}`);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ email: 'ana@example.com', role: 'member', workspace: 'Dado' });
  });

  it('rejects an unknown or expired token with a friendly message', async () => {
    const response = await new Client(app).request('GET', '/invitations/no-existe-este-token');
    expect(response.statusCode).toBe(400);
    expect(response.json().message).toBe('Esta invitación ya no es válida. Pide una nueva.');
  });

  it('accepts the invitation, logs the person in and notifies both sides', async () => {
    outbox.length = 0;
    const response = await client('ana').request('POST', `/invitations/${token}/accept`, { payload: { name: 'Ana', password: 'otra-clave-larga' } });
    expect(response.statusCode).toBe(201);
    client('ana').adopt(response);

    const recipients = outbox.map((message) => message.to).sort();
    expect(recipients).toEqual(['ana@example.com', 'dan@example.com']);

    const me = await call('GET', '/me', undefined, 'ana');
    expect(me.body.user.workspaceRole).toBe('member');
  });

  it('cannot be used twice', async () => {
    const response = await new Client(app).request('POST', `/invitations/${token}/accept`, { payload: { name: 'Ana', password: 'otra-clave-larga' } });
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

describe('attachments', () => {
  let spaceId = '';
  let key = '';

  it('detects the type from the bytes, not the name', () => {
    expect(detectMime(PNG)).toBe('image/png');
    expect(detectMime(Buffer.from('not an image'))).toBeNull();
    expect(detectMime(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe('image/svg+xml');
  });

  it('builds an opaque key that never uses the file name', () => {
    const generated = storageKeyFor('image/png');
    expect(generated).toMatch(/^[0-9a-f]{32}\.png$/);
    expect(generated).not.toContain('..');
  });

  it('uploads an image and serves it back', async () => {
    const spaces = await call('GET', '/spaces');
    spaceId = spaces.body.spaces[0].id;

    const response = await client('owner').request('POST', `/attachments?spaceId=${spaceId}&name=${encodeURIComponent('panel.png')}`, {
      headers: { 'content-type': 'application/octet-stream' },
      payload: PNG,
    });
    expect(response.statusCode).toBe(201);
    const attachment = response.json().attachment;
    expect(attachment.mime).toBe('image/png');
    key = attachment.url.split('/').pop();

    const fetched = await client('owner').request('GET', `/files/${key}`);
    expect(fetched.statusCode).toBe(200);
    expect(fetched.headers['content-type']).toBe('image/png');
    expect(Buffer.from(fetched.rawPayload).equals(PNG)).toBe(true);
  });

  it('refuses a file whose bytes are not a supported type', async () => {
    const response = await client('owner').request('POST', `/attachments?spaceId=${spaceId}&name=payload.png`, {
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.from('<?php system($_GET["c"]); ?>'),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().message).toBe('Ese tipo de archivo no se admite.');
  });

  it('refuses a request with no session', async () => {
    const response = await new Client(app).request('GET', `/files/${key}`);
    expect(response.statusCode).toBe(401);
  });

  it('lists and deletes the attachment', async () => {
    const list = await call('GET', `/attachments?spaceId=${spaceId}`);
    expect(list.body.attachments).toHaveLength(1);
    expect((await call('DELETE', `/attachments/${key}`)).status).toBe(200);
    const after = await call('GET', `/attachments?spaceId=${spaceId}`);
    expect(after.body.attachments).toHaveLength(0);
    const gone = await call('GET', `/files/${key}`);
    expect(gone.status).toBe(404);
  });
});
