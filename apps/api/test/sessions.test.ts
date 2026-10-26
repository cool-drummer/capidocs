import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type CapidocsApp } from '../src/app.js';
import { sessions } from '../src/db/schema.js';
import { hashToken } from '../src/lib/auth.js';
import { Client, memoryMailer, productionConfig, resetDatabase, testDatabaseUrl } from './helpers.js';

const DATABASE_URL = testDatabaseUrl('capidocs_sessions_test');
const PASSWORD = 'una-clave-bastante-larga';
let app: CapidocsApp;

function cookieHeader(response: Awaited<ReturnType<Client['request']>>): string {
  const header = response.headers['set-cookie'];
  return String(Array.isArray(header) ? header[0] : header);
}

function tokenOf(client: Client): string {
  return decodeURIComponent(client.cookie.split('=').slice(1).join('='));
}

beforeAll(async () => {
  await resetDatabase(DATABASE_URL);
  app = await createApp(productionConfig(DATABASE_URL, { SESSION_IDLE_MINUTES: '30', SESSION_ABSOLUTE_HOURS: '12' }), { mailer: memoryMailer() });
  await new Client(app).call('POST', '/auth/setup', {
    workspaceName: 'Acme',
    workspaceSlug: 'acme',
    name: 'Dueña',
    email: 'owner@example.com',
    password: PASSWORD,
  });
}, 60000);

afterAll(async () => {
  await app?.close();
});

describe('session cookie', () => {
  it('is host-only, secure, http-only, strict and bounded by the absolute lifetime', async () => {
    const response = await new Client(app).login('owner@example.com', PASSWORD);
    const cookie = cookieHeader(response);
    expect(cookie).toMatch(/^__Host-capidocs_session=/);
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain(`Max-Age=${12 * 3600}`);
    expect(cookie).not.toMatch(/Domain=/i);
  });

  it('stores only a hash of the token', async () => {
    const client = new Client(app);
    await client.login('owner@example.com', PASSWORD);
    const raw = tokenOf(client);
    const stored = await app.db.select().from(sessions).where(eq(sessions.tokenHash, hashToken(raw)));
    expect(stored).toHaveLength(1);
    const plain = await app.db.select().from(sessions).where(eq(sessions.tokenHash, raw));
    expect(plain).toHaveLength(0);
  });
});

describe('session lifecycle', () => {
  it('rotates the token on login and retires the previous one', async () => {
    const client = new Client(app);
    await client.login('owner@example.com', PASSWORD);
    const previous = client.cookie;
    await client.login('owner@example.com', PASSWORD);
    expect(client.cookie).not.toBe(previous);

    const stale = new Client(app);
    stale.cookie = previous;
    expect((await stale.call('GET', '/me')).status).toBe(401);
    expect((await client.call('GET', '/me')).status).toBe(200);
  });

  it('invalidates the session on the server at logout', async () => {
    const client = new Client(app);
    await client.login('owner@example.com', PASSWORD);
    const copy = new Client(app);
    copy.cookie = client.cookie;

    const logout = await client.request('POST', '/auth/logout');
    expect(cookieHeader(logout)).toMatch(/^__Host-capidocs_session=;/);
    expect((await copy.call('GET', '/me')).status).toBe(401);
  });

  it('expires after the idle window', async () => {
    const client = new Client(app);
    await client.login('owner@example.com', PASSWORD);
    await app.db
      .update(sessions)
      .set({ lastSeenAt: new Date(Date.now() - 31 * 60_000) })
      .where(eq(sessions.tokenHash, hashToken(tokenOf(client))));
    expect((await client.call('GET', '/me')).status).toBe(401);

    const [row] = await app.db.select().from(sessions).where(eq(sessions.tokenHash, hashToken(tokenOf(client))));
    expect(row!.revokedAt).not.toBeNull();
  });

  it('expires at the absolute deadline even when active', async () => {
    const client = new Client(app);
    await client.login('owner@example.com', PASSWORD);
    await app.db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000), lastSeenAt: new Date() })
      .where(eq(sessions.tokenHash, hashToken(tokenOf(client))));
    expect((await client.call('GET', '/me')).status).toBe(401);
  });

  it('keeps an active session alive and records activity', async () => {
    const client = new Client(app);
    await client.login('owner@example.com', PASSWORD);
    const past = new Date(Date.now() - 10 * 60_000);
    await app.db.update(sessions).set({ lastSeenAt: past }).where(eq(sessions.tokenHash, hashToken(tokenOf(client))));
    expect((await client.call('GET', '/me')).status).toBe(200);
    const [row] = await app.db.select().from(sessions).where(eq(sessions.tokenHash, hashToken(tokenOf(client))));
    expect(row!.lastSeenAt.getTime()).toBeGreaterThan(past.getTime());
  });
});
