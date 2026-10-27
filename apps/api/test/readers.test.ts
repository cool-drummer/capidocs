import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type CapidocsApp } from '../src/app.js';
import { readerCodes } from '../src/db/schema.js';
import { readerCookieName } from '../src/modules/readers.js';
import { Client, memoryMailer, resetDatabase, testConfig, testDatabaseUrl } from './helpers.js';

const DATABASE_URL = testDatabaseUrl('capidocs_readers_test');
const PASSWORD = 'una-clave-bastante-larga';
const mailer = memoryMailer();
let app: CapidocsApp;
let owner: Client;
let portalId = '';
let betaId = '';
const config = testConfig(DATABASE_URL);

async function eventually<T>(read: () => T | undefined, timeoutMs = 2000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('condition not met in time');
}

async function publishedPage(spaceId: string, title: string, content: string) {
  const page = await owner.call('POST', `/spaces/${spaceId}/pages`, { title });
  await owner.call('PUT', `/pages/${page.body.page.id}/content`, { locale: 'es', title, document: { version: 1, sections: [{ title, content }] } });
  await owner.call('POST', `/pages/${page.body.page.id}/publish`, { locale: 'es' });
}

const reader = (method: 'GET' | 'POST', url: string, options: { payload?: unknown; cookie?: string } = {}) =>
  app.inject({
    method,
    url,
    ...(options.payload === undefined ? {} : { payload: options.payload as never }),
    headers: options.cookie ? { cookie: options.cookie } : {},
  });

async function requestCode(email: string): Promise<string> {
  const before = mailer.sent.length;
  const response = await reader('POST', '/api/read/acme/code', { payload: { email } });
  expect(response.statusCode).toBe(202);
  const message = await eventually(() => mailer.sent.slice(before).find((sent) => sent.to === email));
  return /(\d{6})$/.exec(message.subject)![1]!;
}

async function signIn(email: string): Promise<string> {
  const code = await requestCode(email);
  const response = await reader('POST', '/api/read/acme/verify', { payload: { email, code } });
  expect(response.statusCode).toBe(200);
  const header = response.headers['set-cookie'];
  return String(Array.isArray(header) ? header[0] : header).split(';')[0]!;
}

function titles(spec: { pages: Record<string, { content: { title?: string } }> }): string[] {
  return Object.values(spec.pages).map((page) => page.content.title ?? '');
}

beforeAll(async () => {
  await resetDatabase(DATABASE_URL);
  app = await createApp(config, { mailer });
  owner = new Client(app);
  await owner.call('POST', '/auth/setup', { workspaceName: 'Acme', workspaceSlug: 'acme', name: 'Dueña', email: 'owner@example.com', password: PASSWORD });
  await owner.login('owner@example.com', PASSWORD);
  portalId = (await owner.call('POST', '/portals', { name: 'Acme', slug: 'acme' })).body.portal.id;
  betaId = (await owner.call('POST', '/portals', { name: 'Beta', slug: 'beta' })).body.portal.id;
  const open = (await owner.call('POST', '/spaces', { name: 'Guías', slug: 'guias', audience: 'public', portalId })).body.space.id;
  const clients = (await owner.call('POST', '/spaces', { name: 'Clientes', slug: 'clientes', audience: 'customers', portalId })).body.space.id;
  const internal = (await owner.call('POST', '/spaces', { name: 'Interno', slug: 'interno', audience: 'internal' })).body.space.id;
  const beta = (await owner.call('POST', '/spaces', { name: 'Beta', slug: 'beta', audience: 'customers', portalId: betaId })).body.space.id;
  await publishedPage(open, 'Guía pública', 'Para todos.');
  await publishedPage(clients, 'Precios para clientes', 'Confidencial.');
  await publishedPage(internal, 'Notas internas', 'Solo el equipo.');
  await publishedPage(beta, 'Documentos beta', 'Otro portal.');
}, 60000);

afterAll(async () => {
  await app?.close();
});

describe('authorized readers', () => {
  it('keeps a normalized list of emails and domains per portal', async () => {
    const ana = await owner.call('POST', `/portals/${portalId}/readers`, { pattern: '  Ana@Example.com ' });
    expect(ana.status).toBe(201);
    expect(ana.body.reader.pattern).toBe('ana@example.com');
    expect((await owner.call('POST', `/portals/${portalId}/readers`, { pattern: '@cliente.com' })).status).toBe(201);
    expect((await owner.call('POST', `/portals/${portalId}/readers`, { pattern: 'ana@example.com' })).status).toBe(200);
    const invalid = await owner.call('POST', `/portals/${portalId}/readers`, { pattern: 'no es un correo' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.message).toContain('@empresa.com');
    const list = await owner.call('GET', `/portals/${portalId}/readers`);
    expect(list.body.readers.map((entry: { pattern: string }) => entry.pattern)).toEqual(['@cliente.com', 'ana@example.com']);
    expect(list.body.url).toBe('https://studio.test/read/acme');
  });

  it('lets only workspace admins manage the list', async () => {
    await owner.call('POST', '/members/invitations', { email: 'editor@example.com', role: 'member' });
    const token = /#invitation=([\w-]+)/.exec(
      (await eventually(() => mailer.sent.find((message) => message.to === 'editor@example.com')))!.action!.url,
    )![1]!;
    const editor = new Client(app);
    editor.adopt(await editor.request('POST', '/invitations/accept', { payload: { token, name: 'Editora', password: PASSWORD } }));
    expect((await editor.call('POST', `/portals/${portalId}/readers`, { pattern: 'x@example.com' })).status).toBe(403);
    expect((await editor.call('GET', `/portals/${portalId}/readers`)).status).toBe(403);
  });
});

describe('sign in with an emailed code', () => {
  it('mails a code only to authorized addresses and answers the same either way', async () => {
    const code = await requestCode('ana@example.com');
    expect(code).toMatch(/^\d{6}$/);
    expect(await requestCode('luis@cliente.com')).toMatch(/^\d{6}$/);
    const before = mailer.sent.length;
    const stranger = await reader('POST', '/api/read/acme/code', { payload: { email: 'intruso@otro.com' } });
    expect(stranger.statusCode).toBe(202);
    const unknownPortal = await reader('POST', '/api/read/no-existe/code', { payload: { email: 'ana@example.com' } });
    expect(unknownPortal.statusCode).toBe(404);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(mailer.sent.slice(before).some((message) => message.to === 'intruso@otro.com')).toBe(false);
  });

  it('stores only a keyed hash of the code', async () => {
    const code = await requestCode('ana@example.com');
    const rows = await app.db.select().from(readerCodes).where(eq(readerCodes.email, 'ana@example.com'));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.codeHash).not.toContain(code);
    }
  });

  it('locks a code after too many wrong attempts', async () => {
    const code = await requestCode('maria@cliente.com');
    const wrong = code === '000000' ? '111111' : '000000';
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await reader('POST', '/api/read/acme/verify', { payload: { email: 'maria@cliente.com', code: wrong } });
      expect(response.statusCode).toBe(400);
      expect(response.json().message).toBe('El código no es válido o ya venció. Pide uno nuevo.');
    }
    expect((await reader('POST', '/api/read/acme/verify', { payload: { email: 'maria@cliente.com', code } })).statusCode).toBe(400);
  });

  it('accepts a code once and sets a session cookie for this portal', async () => {
    const code = await requestCode('ana@example.com');
    const first = await reader('POST', '/api/read/acme/verify', { payload: { email: 'ana@example.com', code } });
    expect(first.statusCode).toBe(200);
    const cookie = String(first.headers['set-cookie']);
    expect(cookie.startsWith(`${readerCookieName(portalId, config.secureCookies)}=`)).toBe(true);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//);
    expect(readerCookieName(portalId, true)).toBe(`__Host-capidocs_reader_${portalId.replace(/-/g, '')}`);
    expect((await reader('POST', '/api/read/acme/verify', { payload: { email: 'ana@example.com', code } })).statusCode).toBe(400);
  });
});

describe('reading', () => {
  it('asks for an email without a session', async () => {
    const response = await reader('GET', '/api/read/acme/spec');
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: 'reader_required', portal: 'Acme' });
    expect(response.body).not.toContain('Confidencial');
  });

  it('serves the portal spaces to a signed-in reader and nothing internal', async () => {
    const cookie = await signIn('luis@cliente.com');
    const response = await reader('GET', '/api/read/acme/spec', { cookie });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(titles(body.spec)).toEqual(expect.arrayContaining(['Guía pública', 'Precios para clientes']));
    expect(JSON.stringify(body)).not.toContain('Notas internas');
    expect(JSON.stringify(body)).not.toContain('Documentos beta');
    expect(body.spec.site_config.access).toEqual({ mode: 'open' });
    expect(body.reader.email).toBe('luis@cliente.com');
  });

  it('never lets a session for one portal read another', async () => {
    const cookie = await signIn('ana@example.com');
    const token = cookie.split('=')[1]!;
    const forged = `${readerCookieName(betaId, config.secureCookies)}=${token}`;
    expect((await reader('GET', '/api/read/beta/spec', { cookie: forged })).statusCode).toBe(401);
    expect((await reader('GET', '/api/read/beta/spec', { cookie })).statusCode).toBe(401);
  });

  it('closes sessions as soon as the address is removed', async () => {
    const cookie = await signIn('ana@example.com');
    expect((await reader('GET', '/api/read/acme/spec', { cookie })).statusCode).toBe(200);
    const list = await owner.call('GET', `/portals/${portalId}/readers`);
    const ana = list.body.readers.find((entry: { pattern: string }) => entry.pattern === 'ana@example.com');
    expect((await owner.call('DELETE', `/portals/${portalId}/readers/${ana.id}`)).status).toBe(200);
    expect((await reader('GET', '/api/read/acme/spec', { cookie })).statusCode).toBe(401);
  });

  it('closes the session on sign out', async () => {
    const cookie = await signIn('luis@cliente.com');
    expect((await reader('POST', '/api/read/acme/logout', { cookie })).statusCode).toBe(200);
    expect((await reader('GET', '/api/read/acme/spec', { cookie })).statusCode).toBe(401);
  });
});

describe('reader pages', () => {
  it('serve a nonce-only page that is never indexed or framed', async () => {
    for (const url of ['/read/acme', '/read/acme/explorer']) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(200);
      const csp = String(response.headers['content-security-policy']);
      expect(csp).toContain("frame-ancestors 'none'");
      const scriptSrc = csp.split('; ').find((directive) => directive.startsWith('script-src'))!;
      expect(scriptSrc).not.toContain('unsafe-inline');
      const nonce = /'nonce-([^']+)'/.exec(scriptSrc)![1]!;
      for (const tag of response.body.match(/<script\b[^>]*>/g)!) expect(tag).toContain(`nonce="${nonce}"`);
      expect(response.body).toMatch(/\/site\/v[0-9a-f]{12}\/assets\//);
      expect(response.headers['x-robots-tag']).toBe('noindex, nofollow');
      expect(response.headers['cache-control']).toBe('no-store');
    }
  });

  it('answers not found for a malformed address', async () => {
    expect((await app.inject({ method: 'GET', url: '/read/..%2f..%2fetc' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/read/Mayusculas' })).statusCode).toBe(404);
  });
});
