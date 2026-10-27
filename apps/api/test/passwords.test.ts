import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type CapidocsApp } from '../src/app.js';
import { passwordResets, users } from '../src/db/schema.js';
import { passwordProblem } from '../src/lib/password-policy.js';
import { Client, memoryMailer, productionConfig, resetDatabase, testConfig, TEST_SETUP_TOKEN, testDatabaseUrl } from './helpers.js';

const DATABASE_URL = testDatabaseUrl('capidocs_passwords_test');
const SETUP_DATABASE_URL = testDatabaseUrl('capidocs_setup_test');
const PASSWORD = 'una-clave-bastante-larga';
const mailer = memoryMailer();
let app: CapidocsApp;

async function eventually<T>(read: () => T | undefined, timeoutMs = 2000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('condition not met in time');
}

const mailTo = (address: string, subject: string) => () => mailer.sent.find((message) => message.to === address && message.subject === subject);
const resetTokenFrom = (url: string) => /#reset=([\w-]+)/.exec(url)![1]!;

beforeAll(async () => {
  await resetDatabase(DATABASE_URL);
  app = await createApp(testConfig(DATABASE_URL), { mailer });
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

describe('password policy', () => {
  it('asks for at least twelve characters', () => {
    expect(passwordProblem('corta-123')).toBe('La contraseña debe tener al menos 12 caracteres.');
  });

  it('rejects very long input before hashing', () => {
    expect(passwordProblem('x'.repeat(257))).toBe('La contraseña es demasiado larga.');
  });

  it('rejects common, repeated and sequential passwords', () => {
    for (const weak of ['password1234', 'aaaaaaaaaaaaaa', '123456789012', 'abcdefghijklmn', 'qwertyuiopas', 'ababababababab']) {
      expect(passwordProblem(weak)).toMatch(/fácil de adivinar/);
    }
  });

  it('rejects personal information', () => {
    expect(passwordProblem('mariana-en-la-playa', { email: 'mariana@example.com' })).toMatch(/no debe incluir/);
    expect(passwordProblem('globex-documentacion', { workspace: 'Globex' })).toMatch(/no debe incluir/);
  });

  it('accepts a long passphrase', () => {
    expect(passwordProblem('tres tigres comen trigo', { email: 'ana@example.com', workspace: 'Acme' })).toBeNull();
  });
});

describe('initial setup', () => {
  let setupApp: CapidocsApp;
  const body = { workspaceName: 'Globex', workspaceSlug: 'globex', name: 'Dueña', email: 'owner@globex.example', password: PASSWORD };

  beforeAll(async () => {
    await resetDatabase(SETUP_DATABASE_URL);
  });

  afterAll(async () => {
    await setupApp?.close();
  });

  it('stays closed in production without a setup token', async () => {
    setupApp = await createApp(productionConfig(SETUP_DATABASE_URL, { SETUP_TOKEN: '' }), { mailer: memoryMailer() });
    const response = await new Client(setupApp).call('POST', '/auth/setup', body);
    expect(response.status).toBe(403);
    expect(response.body.error).toBe('setup_closed');
    expect(response.body.message).toBe('El código de configuración no es válido o este servidor ya no admite la configuración inicial.');
    await setupApp.close();
  });

  it('requires the configured token', async () => {
    setupApp = await createApp(productionConfig(SETUP_DATABASE_URL), { mailer: memoryMailer() });
    const wrong = await new Client(setupApp).call('POST', '/auth/setup', { ...body, setupToken: 'not-the-right-token-at-all' });
    expect(wrong.status).toBe(403);
    const missing = await new Client(setupApp).call('POST', '/auth/setup', body);
    expect(missing.status).toBe(403);
  });

  it('applies the password policy to the first owner', async () => {
    const response = await new Client(setupApp).call('POST', '/auth/setup', { ...body, password: 'globex-docs-2026', setupToken: TEST_SETUP_TOKEN });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('weak_password');
  });

  it('creates the workspace once with the right token', async () => {
    const first = await new Client(setupApp).call('POST', '/auth/setup', { ...body, setupToken: TEST_SETUP_TOKEN });
    expect(first.status).toBe(201);
    const second = await new Client(setupApp).call('POST', '/auth/setup', { ...body, setupToken: TEST_SETUP_TOKEN });
    expect(second.status).toBe(409);
  });
});

describe('login', () => {
  it('answers the same for an unknown account and a wrong password', async () => {
    const unknown = await new Client(app).call('POST', '/auth/login', { email: 'nobody@example.com', password: PASSWORD });
    const wrong = await new Client(app).call('POST', '/auth/login', { email: 'owner@example.com', password: 'no-es-la-clave-correcta' });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
    expect(unknown.body.message).toBe('Correo o contraseña incorrectos.');
  });

  it('warns about a sign-in from a device it has not seen', async () => {
    const chrome = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
    const firefox = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0';
    const login = (agent: string) =>
      new Client(app).request('POST', '/auth/login', { payload: { email: 'owner@example.com', password: PASSWORD }, headers: { 'user-agent': agent } });

    await login(chrome);
    await login(chrome);
    expect(mailer.sent.filter((message) => message.subject === 'Nuevo inicio de sesión en tu cuenta')).toHaveLength(0);

    await login(firefox);
    const notice = await eventually(mailTo('owner@example.com', 'Nuevo inicio de sesión en tu cuenta'));
    expect(notice.body.join(' ')).toContain('Firefox en Windows');
  });
});

describe('password recovery', () => {
  it('answers the same whether or not the account exists', async () => {
    mailer.sent.length = 0;
    const unknown = await new Client(app).call('POST', '/auth/password/forgot', { email: 'nobody@example.com' });
    const known = await new Client(app).call('POST', '/auth/password/forgot', { email: 'owner@example.com' });
    expect(unknown.status).toBe(202);
    expect(known.status).toBe(202);
    expect(unknown.body).toEqual(known.body);

    await eventually(mailTo('owner@example.com', 'Restablece tu contraseña'));
    expect(mailer.sent.some((message) => message.to === 'nobody@example.com')).toBe(false);
  });

  it('keeps the token out of the query string and stores only its hash', async () => {
    const message = await eventually(mailTo('owner@example.com', 'Restablece tu contraseña'));
    expect(message.action!.url).toMatch(/^https:\/\/studio\.test\/#reset=/);
    const token = resetTokenFrom(message.action!.url);
    const rows = await app.db.select().from(passwordResets);
    expect(rows.some((row) => row.tokenHash === token)).toBe(false);
  });

  it('refuses a weak password without spending the link', async () => {
    const token = resetTokenFrom((await eventually(mailTo('owner@example.com', 'Restablece tu contraseña'))).action!.url);
    const weak = await new Client(app).call('POST', '/auth/password/reset', { token, password: 'password1234' });
    expect(weak.status).toBe(400);
    expect(weak.body.error).toBe('weak_password');
  });

  it('sets the new password once, closes every session and notifies', async () => {
    const session = new Client(app);
    await session.login('owner@example.com', PASSWORD);

    const token = resetTokenFrom((await eventually(mailTo('owner@example.com', 'Restablece tu contraseña'))).action!.url);
    const done = await new Client(app).call('POST', '/auth/password/reset', { token, password: 'otra frase nueva y larga' });
    expect(done.status).toBe(200);

    expect((await session.call('GET', '/me')).status).toBe(401);
    expect((await new Client(app).login('owner@example.com', PASSWORD)).statusCode).toBe(401);
    expect((await new Client(app).login('owner@example.com', 'otra frase nueva y larga')).statusCode).toBe(200);
    await eventually(mailTo('owner@example.com', 'Tu contraseña cambió'));

    const again = await new Client(app).call('POST', '/auth/password/reset', { token, password: 'una tercera frase larga' });
    expect(again.status).toBe(400);
    expect(again.body.error).toBe('reset_invalid');
  });

  it('rejects an expired link', async () => {
    mailer.sent.length = 0;
    await new Client(app).call('POST', '/auth/password/forgot', { email: 'owner@example.com' });
    const token = resetTokenFrom((await eventually(mailTo('owner@example.com', 'Restablece tu contraseña'))).action!.url);
    await app.db.update(passwordResets).set({ expiresAt: new Date(Date.now() - 1000) });
    const response = await new Client(app).call('POST', '/auth/password/reset', { token, password: 'una tercera frase larga' });
    expect(response.status).toBe(400);
  });

  it('invalidates an older link when a new one is requested', async () => {
    mailer.sent.length = 0;
    await new Client(app).call('POST', '/auth/password/forgot', { email: 'owner@example.com' });
    const first = resetTokenFrom((await eventually(mailTo('owner@example.com', 'Restablece tu contraseña'))).action!.url);
    mailer.sent.length = 0;
    await new Client(app).call('POST', '/auth/password/forgot', { email: 'owner@example.com' });
    await eventually(mailTo('owner@example.com', 'Restablece tu contraseña'));
    const response = await new Client(app).call('POST', '/auth/password/reset', { token: first, password: 'una tercera frase larga' });
    expect(response.status).toBe(400);
  });
});

describe('password change', () => {
  it('needs the current password', async () => {
    const owner = new Client(app);
    await owner.login('owner@example.com', 'otra frase nueva y larga');
    const response = await owner.call('POST', '/auth/password', { currentPassword: 'equivocada-del-todo', newPassword: 'una cuarta frase larga' });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('invalid_current_password');
  });

  it('keeps the current session, closes the others and notifies', async () => {
    mailer.sent.length = 0;
    const current = new Client(app);
    await current.login('owner@example.com', 'otra frase nueva y larga');
    const other = new Client(app);
    await other.login('owner@example.com', 'otra frase nueva y larga');

    const response = await current.call('POST', '/auth/password', { currentPassword: 'otra frase nueva y larga', newPassword: 'una cuarta frase larga' });
    expect(response.status).toBe(200);
    expect((await current.call('GET', '/me')).status).toBe(200);
    expect((await other.call('GET', '/me')).status).toBe(401);
    await eventually(mailTo('owner@example.com', 'Tu contraseña cambió'));

    const [row] = await app.db.select().from(users).where(eq(users.email, 'owner@example.com'));
    expect(row!.passwordHash).toMatch(/^scrypt\$/);
  });
});
