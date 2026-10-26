import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type CapidocsApp } from '../src/app.js';
import { Client, memoryMailer, resetDatabase, testConfig, testDatabaseUrl } from './helpers.js';

const DATABASE_URL = testDatabaseUrl('capidocs_validation_test');
const PASSWORD = 'una-clave-bastante-larga';
const FRIENDLY = 'Revisa los datos e inténtalo de nuevo.';

let app: CapidocsApp;
let owner: Client;
let spaceId = '';
let pageId = '';
let portalId = '';

beforeAll(async () => {
  await resetDatabase(DATABASE_URL);
  app = await createApp(testConfig(DATABASE_URL, { BODY_LIMIT_BYTES: String(32 * 1024), CONTENT_BODY_LIMIT_BYTES: String(256 * 1024) }), {
    mailer: memoryMailer(),
  });
  owner = new Client(app);
  await owner.call('POST', '/auth/setup', { workspaceName: 'Acme', workspaceSlug: 'acme', name: 'Dueña', email: 'owner@example.com', password: PASSWORD });
  await owner.login('owner@example.com', PASSWORD);
  spaceId = (await owner.call('POST', '/spaces', { name: 'Interno', slug: 'interno', audience: 'internal' })).body.space.id;
  pageId = (await owner.call('POST', `/spaces/${spaceId}/pages`, { title: 'Guía' })).body.page.id;
  portalId = (await owner.call('POST', '/portals', { name: 'Acme', slug: 'acme' })).body.portal.id;
}, 60000);

afterAll(async () => {
  await app?.close();
});

describe('body limits', () => {
  it('rejects an oversized body with a friendly message', async () => {
    const response = await owner.call('POST', '/spaces', { name: 'x'.repeat(40 * 1024), slug: 'grande', audience: 'internal' });
    expect(response.status).toBe(413);
    expect(response.body).toEqual({ error: 'payload_too_large', message: 'El contenido que enviaste es demasiado grande.' });
  });

  it('allows larger page content up to its own limit', async () => {
    const content = 'texto '.repeat(20_000);
    const saved = await owner.call('PUT', `/pages/${pageId}/content`, { locale: 'es', title: 'Guía', document: { version: 1, sections: [{ title: 'Largo', content }] } });
    expect(saved.status).toBe(200);
    const tooBig = await owner.call('PUT', `/pages/${pageId}/content`, {
      locale: 'es',
      title: 'Guía',
      document: { version: 1, sections: [{ title: 'Largo', content: content.repeat(3) }] },
    });
    expect(tooBig.status).toBe(413);
  });

  it('answers malformed JSON without the parser text', async () => {
    const response = await owner.request('POST', '/spaces', { payload: '{"name": ', headers: { 'content-type': 'application/json' } });
    expect(response.statusCode).toBe(400);
    expect(response.json().message).toBe(FRIENDLY);
    expect(response.body).not.toMatch(/Unexpected|JSON|position/);
  });
});

describe('input validation', () => {
  it('turns a duplicate slug into a conflict instead of a server error', async () => {
    const response = await owner.call('POST', '/spaces', { name: 'Otro', slug: 'interno', audience: 'internal' });
    expect(response.status).toBe(409);
    expect(response.body.message).toBe('Ese valor ya está en uso. Elige otro.');
  });

  it('refuses script and data urls for the portal address', async () => {
    for (const siteUrl of ['javascript:alert(1)', 'data:text/html,hola', 'ftp://example.com']) {
      expect((await owner.call('PUT', `/portals/${portalId}`, { siteUrl })).status).toBe(400);
    }
    expect((await owner.call('PUT', `/portals/${portalId}`, { siteUrl: 'https://docs.example.com' })).status).toBe(200);
  });

  it('accepts only a known brand shape', async () => {
    expect((await owner.call('PUT', `/portals/${portalId}`, { brand: { accent: { light: '#2f8f90', dark: '#4bb3a1' } } })).status).toBe(200);
    for (const brand of [
      { accent: { light: 'red', dark: '#000' } },
      { stylesheet: 'javascript:alert(1)' },
      { stylesheet: '../../etc/passwd' },
      { logos: { navbar_light: 'http://insecure.example.com/logo.svg' } },
      { unknown: true },
    ]) {
      expect((await owner.call('PUT', `/portals/${portalId}`, { brand })).status).toBe(400);
    }
  });

  it('accepts only https endpoints for the access gate', async () => {
    expect((await owner.call('PUT', `/portals/${portalId}`, { accessConfig: { endpoint: 'http://gate.example.com' } })).status).toBe(400);
    expect((await owner.call('PUT', `/portals/${portalId}`, { accessConfig: { endpoint: 'https://gate.example.com/check' } })).status).toBe(200);
  });

  it('refuses a locale the workspace does not use', async () => {
    const response = await owner.call('PUT', `/pages/${pageId}/content`, { locale: 'fr', title: 'Guide', document: { version: 1, sections: [] } });
    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Ese idioma no está configurado en el espacio de trabajo.');
    expect((await owner.call('GET', `/pages/${pageId}?locale=de`)).status).toBe(400);
  });

  it('bounds names, titles and icons', async () => {
    expect((await owner.call('POST', '/spaces', { name: 'x'.repeat(121), slug: 'largo', audience: 'internal' })).status).toBe(400);
    expect((await owner.call('POST', `/spaces/${spaceId}/pages`, { title: 't'.repeat(301) })).status).toBe(400);
    expect((await owner.call('POST', `/spaces/${spaceId}/pages`, { title: 'Bien', icon: '<img src=x onerror=alert(1)>' })).status).toBe(400);
  });

  it('refuses a space bound to a portal that does not exist', async () => {
    const response = await owner.call('POST', '/spaces', {
      name: 'Huérfano',
      slug: 'huerfano',
      audience: 'public',
      portalId: '00000000-0000-7000-8000-000000000000',
    });
    expect(response.status).toBe(400);
  });
});
