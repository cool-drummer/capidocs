import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type CapidocsApp } from '../src/app.js';
import { Client, memoryMailer, productionConfig, resetDatabase, TEST_SETUP_TOKEN, testDatabaseUrl } from './helpers.js';

const DATABASE_URL = testDatabaseUrl('capidocs_csrf_test');
const PASSWORD = 'una-clave-bastante-larga';
const SPACE = { name: 'Interno', slug: 'interno', audience: 'internal' };
let app: CapidocsApp;
let owner: Client;

beforeAll(async () => {
  await resetDatabase(DATABASE_URL);
  app = await createApp(productionConfig(DATABASE_URL), { mailer: memoryMailer() });
  await new Client(app).call('POST', '/auth/setup', {
    workspaceName: 'Acme',
    workspaceSlug: 'acme',
    name: 'Dueña',
    email: 'owner@example.com',
    password: PASSWORD,
    setupToken: TEST_SETUP_TOKEN,
  });
  owner = new Client(app);
  await owner.login('owner@example.com', PASSWORD);
}, 60000);

afterAll(async () => {
  await app?.close();
});

function withoutToken(client: Client): Client {
  const copy = new Client(app);
  copy.cookie = client.cookie;
  return copy;
}

describe('csrf protection', () => {
  it('hands out a token bound to the session', async () => {
    const me = await owner.call('GET', '/me');
    expect(me.body.csrfToken).toBe(owner.csrf);
    expect(owner.csrf.length).toBeGreaterThan(30);
  });

  it('rejects a cookie-authenticated mutation without the token', async () => {
    const response = await withoutToken(owner).call('POST', '/spaces', SPACE);
    expect(response.status).toBe(403);
    expect(response.body.error).toBe('csrf_rejected');
    expect(response.body.message).toBe('Tu sesión no es válida para esta acción. Recarga la página e inténtalo de nuevo.');
  });

  it('rejects a token from another session', async () => {
    const other = new Client(app);
    await other.login('owner@example.com', PASSWORD);
    const forged = withoutToken(owner);
    forged.csrf = other.csrf;
    expect((await forged.call('POST', '/spaces', SPACE)).status).toBe(403);
  });

  it('accepts the mutation with the right token', async () => {
    expect((await owner.call('POST', '/spaces', SPACE)).status).toBe(201);
  });

  it('rejects a foreign origin even with the token', async () => {
    const response = await owner.request('POST', '/spaces', {
      payload: { ...SPACE, slug: 'otro' },
      headers: { origin: 'https://evil.example' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('rejects a cross-site fetch reported by the browser', async () => {
    const response = await owner.request('POST', '/spaces', {
      payload: { ...SPACE, slug: 'otro' },
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('accepts the studio origin', async () => {
    const response = await owner.request('POST', '/spaces', {
      payload: { ...SPACE, slug: 'propio' },
      headers: { origin: 'https://studio.test', 'sec-fetch-site': 'same-origin' },
    });
    expect(response.statusCode).toBe(201);
  });

  it('blocks login forced from another site', async () => {
    const response = await new Client(app).request('POST', '/auth/login', {
      payload: { email: 'owner@example.com', password: PASSWORD },
      headers: { origin: 'https://evil.example' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('lets a stale session log in again without a token', async () => {
    const session = new Client(app);
    await session.login('owner@example.com', PASSWORD);
    const stale = withoutToken(session);
    const response = await stale.login('owner@example.com', PASSWORD);
    expect(response.statusCode).toBe(200);
  });

  it('never asks for a token on reads', async () => {
    expect((await withoutToken(owner).call('GET', '/spaces')).status).toBe(200);
  });
});
