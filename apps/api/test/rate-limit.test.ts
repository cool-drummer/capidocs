import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type CapidocsApp } from '../src/app.js';
import { RateLimiter } from '../src/lib/rate-limit.js';
import { Client, memoryMailer, resetDatabase, testConfig, testDatabaseUrl } from './helpers.js';

const DATABASE_URL = testDatabaseUrl('capidocs_rate_test');
const PASSWORD = 'una-clave-bastante-larga';
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex');
const FRIENDLY = 'Hiciste demasiados intentos. Espera unos minutos y vuelve a intentarlo.';

let filesDir: string;
let app: CapidocsApp | undefined;

async function start(env: Record<string, string>, mailer = memoryMailer()) {
  app = await createApp(testConfig(DATABASE_URL, { FILES_DIR: filesDir, ...env }), { mailer });
  return app;
}

beforeAll(async () => {
  await resetDatabase(DATABASE_URL);
  filesDir = await mkdtemp(join(tmpdir(), 'capidocs-rate-'));
  const setup = await start({});
  await new Client(setup).call('POST', '/auth/setup', { workspaceName: 'Acme', workspaceSlug: 'acme', name: 'Dueña', email: 'owner@example.com', password: PASSWORD });
  await setup.close();
  app = undefined;
}, 60000);

afterEach(async () => {
  await app?.close();
  app = undefined;
});

afterAll(async () => {
  if (filesDir) await rm(filesDir, { recursive: true, force: true });
});

describe('rate limiter', () => {
  it('counts within a window and starts over after it', () => {
    const limiter = new RateLimiter();
    const rule = { name: 'x', max: 2, windowMs: 1000 };
    expect(limiter.hit(rule, 'k', 0).allowed).toBe(true);
    expect(limiter.hit(rule, 'k', 10).allowed).toBe(true);
    const third = limiter.hit(rule, 'k', 20);
    expect(third.allowed).toBe(false);
    expect(third.retryAfterSeconds).toBe(1);
    expect(limiter.hit(rule, 'other', 20).allowed).toBe(true);
    expect(limiter.hit(rule, 'k', 1001).allowed).toBe(true);
    limiter.close();
  });
});

describe('authentication limits', () => {
  it('slows down repeated attempts from one address with a friendly message', async () => {
    const server = await start({ RATE_LIMIT_AUTH_MAX: '3' });
    const attempt = (remoteAddress: string) =>
      new Client(server).request('POST', '/auth/login', { payload: { email: 'owner@example.com', password: 'no-es-la-clave' }, remoteAddress });
    for (let index = 0; index < 3; index += 1) expect((await attempt('203.0.113.10')).statusCode).toBe(401);
    const blocked = await attempt('203.0.113.10');
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toEqual({ error: 'rate_limited', message: FRIENDLY });
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect((await attempt('203.0.113.11')).statusCode).toBe(401);
  });

  it('protects one account from attempts spread over many addresses', async () => {
    const server = await start({ RATE_LIMIT_LOGIN_PER_EMAIL: '2' });
    const attempt = (remoteAddress: string) =>
      new Client(server).request('POST', '/auth/login', { payload: { email: 'owner@example.com', password: 'no-es-la-clave' }, remoteAddress });
    expect((await attempt('198.51.100.1')).statusCode).toBe(401);
    expect((await attempt('198.51.100.2')).statusCode).toBe(401);
    expect((await attempt('198.51.100.3')).statusCode).toBe(429);
  });

  it('caps recovery mails per address without revealing it', async () => {
    const mailer = memoryMailer();
    const server = await start({ RATE_LIMIT_RESET_PER_EMAIL_HOUR: '1' }, mailer);
    const first = await new Client(server).call('POST', '/auth/password/forgot', { email: 'owner@example.com' });
    const second = await new Client(server).call('POST', '/auth/password/forgot', { email: 'owner@example.com' });
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(mailer.sent.filter((message) => message.subject === 'Restablece tu contraseña')).toHaveLength(1);
  });

  it('limits invitation token guessing like any other entry point', async () => {
    const server = await start({ RATE_LIMIT_AUTH_MAX: '2' });
    const guess = () => new Client(server).call('POST', '/invitations/inspect', { token: 'x'.repeat(43) });
    expect((await guess()).status).toBe(400);
    expect((await guess()).status).toBe(400);
    expect((await guess()).status).toBe(429);
  });
});

describe('authenticated limits', () => {
  it('caps invitations per person', async () => {
    const server = await start({ RATE_LIMIT_INVITATIONS_PER_HOUR: '2' });
    const owner = new Client(server);
    await owner.login('owner@example.com', PASSWORD);
    expect((await owner.call('POST', '/members/invitations', { email: 'a@example.com', role: 'member' })).status).toBe(201);
    expect((await owner.call('POST', '/members/invitations', { email: 'b@example.com', role: 'member' })).status).toBe(201);
    expect((await owner.call('POST', '/members/invitations', { email: 'c@example.com', role: 'member' })).status).toBe(429);
  });

  it('caps uploads per person before reading the file', async () => {
    const server = await start({ RATE_LIMIT_UPLOADS_PER_10_MINUTES: '1' });
    const owner = new Client(server);
    await owner.login('owner@example.com', PASSWORD);
    const space = await owner.call('POST', '/spaces', { name: 'Archivos', slug: `archivos-${Date.now()}`, audience: 'internal' });
    const upload = () =>
      owner.request('POST', `/attachments?spaceId=${space.body.space.id}&name=a.png`, {
        headers: { 'content-type': 'application/octet-stream' },
        payload: PNG,
      });
    expect((await upload()).statusCode).toBe(201);
    expect((await upload()).statusCode).toBe(429);
  });

  it('caps the whole API per address', async () => {
    const server = await start({ RATE_LIMIT_API_PER_MINUTE: '10' });
    const statuses: number[] = [];
    for (let index = 0; index < 11; index += 1) statuses.push((await new Client(server).call('GET', '/me')).status);
    expect(statuses.slice(0, 10).every((status) => status === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});
