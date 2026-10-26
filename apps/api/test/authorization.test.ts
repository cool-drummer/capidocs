import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type CapidocsApp } from '../src/app.js';
import { Client, memoryMailer, resetDatabase, testConfig, testDatabaseUrl } from './helpers.js';

const DATABASE_URL = testDatabaseUrl('capidocs_authorization_test');
const PASSWORD = 'una-clave-bastante-larga';
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex');
const mailer = memoryMailer();

let app: CapidocsApp;
let scratch: string;
let owner: Client;
let intruder: Client;
let reader: Client;
const ids: Record<string, string> = {};

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

async function join_(email: string): Promise<{ client: Client; userId: string }> {
  await owner.call('POST', '/members/invitations', { email, role: 'member' });
  const token = /#invitation=([\w-]+)/.exec(mailer.sent.filter((message) => message.to === email).pop()!.action!.url)![1]!;
  const client = new Client(app);
  client.adopt(await client.request('POST', '/invitations/accept', { payload: { token, name: email.split('@')[0]!, password: PASSWORD } }));
  return { client, userId: (await client.call('GET', '/me')).body.user.id };
}

beforeAll(async () => {
  await resetDatabase(DATABASE_URL);
  scratch = await mkdtemp(join(tmpdir(), 'capidocs-authz-'));
  app = await createApp(testConfig(DATABASE_URL, { FILES_DIR: scratch }), { mailer });
  owner = new Client(app);
  await owner.call('POST', '/auth/setup', { workspaceName: 'Acme', workspaceSlug: 'acme', name: 'Dueña', email: 'owner@example.com', password: PASSWORD });
  await owner.login('owner@example.com', PASSWORD);

  ids.portal = (await owner.call('POST', '/portals', { name: 'Acme', slug: 'acme', deployTarget: { kind: 'none' } })).body.portal.id;
  ids.space = (await owner.call('POST', '/spaces', { name: 'Guías', slug: 'guias', audience: 'public', portalId: ids.portal })).body.space.id;
  ids.page = (await owner.call('POST', `/spaces/${ids.space}/pages`, { title: 'Guía' })).body.page.id;
  await owner.call('POST', `/pages/${ids.page}/publish`, { locale: 'es' });
  const uploaded = await owner.request('POST', `/attachments?spaceId=${ids.space}&name=a.png`, {
    headers: { 'content-type': 'application/octet-stream' },
    payload: PNG,
  });
  ids.key = uploaded.json().attachment.url.split('/').pop();
  ids.invitation = (await owner.call('POST', '/members/invitations', { email: 'pendiente@example.com', role: 'member' })).body.invitation.id;

  const i = await join_('intruso@example.com');
  const r = await join_('lectora@example.com');
  intruder = i.client;
  reader = r.client;
  ids.intruder = i.userId;
  ids.reader = r.userId;
  ids.owner = (await owner.call('GET', '/me')).body.user.id;
  await owner.call('PUT', `/spaces/${ids.space}/members/${ids.reader}`, { role: 'reader' });
}, 60000);

afterAll(async () => {
  await app?.close();
  if (scratch) await rm(scratch, { recursive: true, force: true });
});

const protectedEndpoints = (): [Method, string, unknown?][] => [
  ['POST', '/spaces', { name: 'Nuevo', slug: 'nuevo', audience: 'internal' }],
  ['GET', `/spaces/${ids.space}/tree`],
  ['POST', `/spaces/${ids.space}/pages`, { title: 'Nueva' }],
  ['GET', `/pages/${ids.page}`],
  ['PUT', `/pages/${ids.page}/content`, { locale: 'es', title: 'X', document: { version: 1, sections: [] } }],
  ['POST', `/pages/${ids.page}/versions`, { locale: 'es' }],
  ['POST', `/pages/${ids.page}/publish`, { locale: 'es' }],
  ['POST', `/pages/${ids.page}/move`, { parentPageId: null, index: 0 }],
  ['DELETE', `/pages/${ids.page}`],
  ['GET', `/spaces/${ids.space}/members`],
  ['PUT', `/spaces/${ids.space}/members/${ids.intruder}`, { role: 'admin' }],
  ['DELETE', `/spaces/${ids.space}/members/${ids.reader}`],
  ['POST', '/members/invitations', { email: 'otra@example.com', role: 'member' }],
  ['DELETE', `/members/invitations/${ids.invitation}`],
  ['PUT', `/members/${ids.reader}`, { role: 'admin' }],
  ['DELETE', `/members/${ids.reader}`],
  ['GET', `/attachments?spaceId=${ids.space}`],
  ['GET', `/files/${ids.key}`],
  ['DELETE', `/attachments/${ids.key}`],
  ['POST', '/portals', { name: 'Otro', slug: 'otro' }],
  ['PUT', `/portals/${ids.portal}`, { name: 'Robado' }],
  ['POST', '/portals/import', { spec: { site_config: {}, pages: {} } }],
  ['POST', `/portals/${ids.portal}/publish`],
];

describe('a workspace member without any space role', () => {
  it('is refused on every protected endpoint', async () => {
    for (const [method, path, payload] of protectedEndpoints()) {
      const response = await intruder.call(method, path, payload);
      expect(response.status, `${method} ${path}`).toBe(403);
    }
  });

  it('cannot upload into the space', async () => {
    const response = await intruder.request('POST', `/attachments?spaceId=${ids.space}&name=a.png`, {
      headers: { 'content-type': 'application/octet-stream' },
      payload: PNG,
    });
    expect(response.statusCode).toBe(403);
  });

  it('sees no spaces, no pending invitations and no deploy settings', async () => {
    expect((await intruder.call('GET', '/spaces')).body.spaces).toEqual([]);
    expect((await intruder.call('GET', '/members')).body.invitations).toEqual([]);
    const portals = (await intruder.call('GET', '/portals')).body.portals;
    expect(portals[0]).not.toHaveProperty('deployTarget');
    expect(portals[0]).not.toHaveProperty('accessConfig');
    expect((await owner.call('GET', '/portals')).body.portals[0]).toHaveProperty('deployTarget');
  });

  it('gets nothing from the portal preview', async () => {
    const response = await intruder.call('GET', `/portals/${ids.portal}/preview`);
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).not.toContain('Guía');
  });
});

describe('a reader', () => {
  it('reads but never writes', async () => {
    expect((await reader.call('GET', `/spaces/${ids.space}/tree`)).status).toBe(200);
    expect((await reader.call('GET', `/pages/${ids.page}`)).body.canEdit).toBe(false);
    for (const [method, path, payload] of [
      ['PUT', `/pages/${ids.page}/content`, { locale: 'es', title: 'X', document: { version: 1, sections: [] } }],
      ['POST', `/spaces/${ids.space}/pages`, { title: 'Nueva' }],
      ['POST', `/pages/${ids.page}/publish`, { locale: 'es' }],
      ['DELETE', `/pages/${ids.page}`],
      ['DELETE', `/attachments/${ids.key}`],
      ['PUT', `/spaces/${ids.space}/members/${ids.intruder}`, { role: 'reader' }],
    ] as [Method, string, unknown?][]) {
      expect((await reader.call(method, path, payload)).status, `${method} ${path}`).toBe(403);
    }
  });
});

describe('an anonymous visitor', () => {
  it('needs a session for every endpoint', async () => {
    const anonymous = new Client(app);
    for (const [method, path, payload] of [...protectedEndpoints(), ['GET', '/me'], ['GET', '/spaces'], ['GET', '/members'], ['GET', '/portals']] as [
      Method,
      string,
      unknown?,
    ][]) {
      expect((await anonymous.call(method, path, payload)).status, `${method} ${path}`).toBe(401);
    }
  });
});
