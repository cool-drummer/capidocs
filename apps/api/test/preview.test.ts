import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type CapidocsApp } from '../src/app.js';
import { createUrlSigner } from '../src/lib/preview.js';
import { Client, memoryMailer, resetDatabase, testConfig, testDatabaseUrl } from './helpers.js';

const DATABASE_URL = testDatabaseUrl('capidocs_preview_test');
const PASSWORD = 'una-clave-bastante-larga';
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex');
const mailer = memoryMailer();

let app: CapidocsApp;
let scratch: string;
let owner: Client;
let reader: Client;
let portalId = '';
let imageKey = '';

async function publishedPage(spaceId: string, title: string, sections: unknown[]) {
  const page = await owner.call('POST', `/spaces/${spaceId}/pages`, { title });
  await owner.call('PUT', `/pages/${page.body.page.id}/content`, { locale: 'es', title, document: { version: 1, sections } });
  await owner.call('POST', `/pages/${page.body.page.id}/publish`, { locale: 'es' });
}

function titles(spec: { pages: Record<string, { template: string; content: { title?: string; hero?: { title: string } } }> }): string[] {
  return Object.values(spec.pages).map((page) => (page.template === 'hero' ? page.content.hero!.title : page.content.title!));
}

beforeAll(async () => {
  await resetDatabase(DATABASE_URL);
  scratch = await mkdtemp(join(tmpdir(), 'capidocs-preview-'));
  app = await createApp(testConfig(DATABASE_URL, { FILES_DIR: scratch }), { mailer });
  owner = new Client(app);
  await owner.call('POST', '/auth/setup', { workspaceName: 'Acme', workspaceSlug: 'acme', name: 'Dueña', email: 'owner@example.com', password: PASSWORD });
  await owner.login('owner@example.com', PASSWORD);

  portalId = (
    await owner.call('POST', '/portals', { name: 'Acme', slug: 'acme', accessMode: 'gate' })
  ).body.portal.id;
  await owner.call('PUT', `/portals/${portalId}`, { accessConfig: { endpoint: 'https://access.example.com/check' } });
  const open = (await owner.call('POST', '/spaces', { name: 'Guías', slug: 'guias', audience: 'public', portalId })).body.space.id;
  const clients = (await owner.call('POST', '/spaces', { name: 'Clientes', slug: 'clientes', audience: 'customers', portalId })).body.space.id;

  const uploaded = await owner.request('POST', `/attachments?spaceId=${open}&name=panel.png`, {
    headers: { 'content-type': 'application/octet-stream' },
    payload: PNG,
  });
  const url = uploaded.json().attachment.url as string;
  imageKey = url.split('/').pop()!;
  await publishedPage(open, 'Guía pública', [{ title: 'Panel', image: { src: url, alt: 'Panel' } }]);
  await publishedPage(clients, 'Precios para clientes', [{ title: 'Tarifas', content: 'Confidencial.' }]);

  await owner.call('POST', '/members/invitations', { email: 'reader@example.com', role: 'member' });
  const token = /#invitation=([\w-]+)/.exec(mailer.sent.find((message) => message.to === 'reader@example.com')!.action!.url)![1]!;
  reader = new Client(app);
  reader.adopt(await reader.request('POST', '/invitations/accept', { payload: { token, name: 'Lectora', password: PASSWORD } }));
  const readerId = (await reader.call('GET', '/me')).body.user.id;
  await owner.call('PUT', `/spaces/${open}/members/${readerId}`, { role: 'reader' });
}, 60000);

afterAll(async () => {
  await app?.close();
  if (scratch) await rm(scratch, { recursive: true, force: true });
});

describe('portal preview', () => {
  it('compiles only the spaces the viewer can read', async () => {
    const full = await owner.call('GET', `/portals/${portalId}/preview`);
    expect(titles(full.body.specs[0].spec)).toEqual(expect.arrayContaining(['Guía pública', 'Precios para clientes']));

    const partial = await reader.call('GET', `/portals/${portalId}/preview`);
    expect(partial.status).toBe(200);
    expect(titles(partial.body.specs[0].spec)).not.toContain('Precios para clientes');
    expect(JSON.stringify(partial.body)).not.toContain('Confidencial');
  });

  it('turns the access gate off inside the preview', async () => {
    const preview = await owner.call('GET', `/portals/${portalId}/preview`);
    expect(preview.body.specs[0].spec.site_config.access).toEqual({ mode: 'open' });
  });

  it('serves images through short-lived signed links that need no session', async () => {
    const preview = await reader.call('GET', `/portals/${portalId}/preview`);
    const link = /\/api\/preview\/files\/[^"]+/.exec(JSON.stringify(preview.body))![0];
    expect(link).toContain(imageKey);

    const anonymous = await app.inject({ method: 'GET', url: link });
    expect(anonymous.statusCode).toBe(200);
    expect(anonymous.headers['content-type']).toBe('image/png');
    expect(anonymous.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(anonymous.headers['content-security-policy']).toBe("default-src 'none'; sandbox");

    const tampered = await app.inject({ method: 'GET', url: link.replace(/signature=[^&]+/, 'signature=forged') });
    expect(tampered.statusCode).toBe(404);
    const otherKey = await app.inject({ method: 'GET', url: link.replace(imageKey, `${'b'.repeat(32)}.png`) });
    expect(otherKey.statusCode).toBe(404);
  });
});

describe('url signer', () => {
  const signer = createUrlSigner(randomBytes(32), 600);
  const key = `${'c'.repeat(32)}.png`;

  it('accepts its own signature until it expires', () => {
    const now = Date.UTC(2026, 9, 26, 12);
    const url = new URL(signer.sign(key, now), 'https://x.test');
    const expires = Number(url.searchParams.get('expires'));
    const signature = url.searchParams.get('signature')!;
    expect(signer.verify(key, expires, signature, now)).toBe(true);
    expect(signer.verify(key, expires, signature, now + 601_000)).toBe(false);
    expect(signer.verify(key, expires + 3600, signature, now)).toBe(false);
  });

  it('rejects a signature from another process', () => {
    const other = createUrlSigner(randomBytes(32), 600);
    const url = new URL(other.sign(key), 'https://x.test');
    expect(signer.verify(key, Number(url.searchParams.get('expires')), url.searchParams.get('signature')!)).toBe(false);
  });
});

describe('preview frame', () => {
  it('is sandboxed, framed only by the studio and runs only nonce scripts', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/preview/frame' });
    expect(response.statusCode).toBe(200);
    const csp = String(response.headers['content-security-policy']);
    expect(csp).toContain('sandbox allow-scripts');
    expect(csp).toContain('frame-ancestors https://studio.test');
    expect(csp).toContain("connect-src 'none'");
    const scriptSrc = csp.split('; ').find((directive) => directive.startsWith('script-src'))!;
    expect(scriptSrc).not.toContain('unsafe-inline');
    const nonce = /'nonce-([^']+)'/.exec(scriptSrc)![1]!;
    const scripts = response.body.match(/<script\b[^>]*>/g)!;
    expect(scripts.length).toBeGreaterThan(0);
    for (const tag of scripts) expect(tag).toContain(`nonce="${nonce}"`);
    expect(response.headers['referrer-policy']).toBe('no-referrer');
  });

  it('only talks to its parent on the agreed channel', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/preview/frame' });
    expect(response.body).toContain('event.source !== window.parent');
    expect(response.body).toContain('data.channel !== channel');
  });
});

describe('runtime assets', () => {
  it('serves the site runtime for the sandboxed frame', async () => {
    const response = await app.inject({ method: 'GET', url: '/site/assets/js/app.js' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(response.headers['access-control-allow-origin']).toBe('*');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('never serves anything outside the runtime folders', async () => {
    for (const url of [
      '/site/package.json',
      '/site/test/render.test.js',
      '/site/config/api-spec.json',
      '/site/../package.json',
      '/site/assets/%2e%2e/%2e%2e/package.json',
      '/site/assets/..%2f..%2fpackage.json',
      '/site/assets/js/.hidden.js',
    ]) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode, url).toBe(404);
    }
  });
});
