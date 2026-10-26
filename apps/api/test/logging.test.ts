import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type CapidocsApp } from '../src/app.js';
import { sanitizeLogText } from '../src/lib/logging.js';
import type { AttachmentStore } from '../src/lib/storage.js';
import { Client, memoryMailer, productionConfig, resetDatabase, TEST_SETUP_TOKEN, testDatabaseUrl } from './helpers.js';

const DATABASE_URL = testDatabaseUrl('capidocs_logging_test');
const PASSWORD = 'una-clave-bastante-larga';
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex');
const SECRET_IN_QUERY = 'hunter2-should-never-be-logged';

const lines: string[] = [];
const mailer = memoryMailer();
const blobs = new Map<string, Buffer>();
const flakyStore: AttachmentStore = {
  async put(key, bytes) {
    blobs.set(key, bytes);
  },
  async get() {
    throw new Error(`Failed query: select * from attachments where key = $1\nparams: ${SECRET_IN_QUERY}`);
  },
  async remove(key) {
    blobs.delete(key);
  },
};

let app: CapidocsApp;
let owner: Client;

const logs = () => lines.join('\n');

beforeAll(async () => {
  await resetDatabase(DATABASE_URL);
  app = await createApp(productionConfig(DATABASE_URL), { mailer, store: flakyStore, logStream: { write: (line) => void lines.push(line) } });
  owner = new Client(app);
  await owner.call('POST', '/auth/setup', {
    workspaceName: 'Acme',
    workspaceSlug: 'acme',
    name: 'Dueña',
    email: 'owner@example.com',
    password: PASSWORD,
    setupToken: TEST_SETUP_TOKEN,
  });
  await owner.login('owner@example.com', PASSWORD);
}, 60000);

afterAll(async () => {
  await app?.close();
});

describe('log hygiene', () => {
  it('never writes passwords, session tokens, csrf tokens or the setup token', async () => {
    await new Client(app).call('POST', '/auth/login', { email: 'owner@example.com', password: 'una-clave-equivocada-123' });
    const output = logs();
    expect(output).not.toContain(PASSWORD);
    expect(output).not.toContain('una-clave-equivocada-123');
    expect(output).not.toContain(TEST_SETUP_TOKEN);
    expect(output).not.toContain(owner.csrf);
    expect(output).not.toContain(owner.cookie.split('=')[1]!);
  });

  it('masks the address of a failed login', async () => {
    await new Client(app).call('POST', '/auth/login', { email: 'mariana@example.com', password: 'cualquier-cosa-larga' });
    expect(logs()).toContain('m***@example.com');
    expect(logs()).not.toContain('mariana@example.com');
  });

  it('keeps recovery tokens out of the log', async () => {
    await new Client(app).call('POST', '/auth/password/forgot', { email: 'owner@example.com' });
    await new Promise((resolve) => setTimeout(resolve, 200));
    const link = mailer.sent.find((message) => message.subject === 'Restablece tu contraseña')!.action!.url;
    expect(logs()).not.toContain(link.split('#reset=')[1]!);
  });

  it('logs validation failures by field, never by value', async () => {
    await new Client(app).call('POST', '/invitations/accept', { token: 'corto', name: 'Ana', password: 'valor-que-no-debe-salir' });
    expect(logs()).toContain('validation failed');
    expect(logs()).not.toContain('valor-que-no-debe-salir');
  });

  it('logs request paths without their query string', async () => {
    await app.inject({ method: 'GET', url: `/api/preview/files/${'a'.repeat(32)}.png?expires=1&signature=${SECRET_IN_QUERY}` });
    expect(logs()).toContain('/api/preview/files/');
    expect(logs()).not.toContain(SECRET_IN_QUERY);
  });

  it('strips query parameters from unexpected errors and answers generically', async () => {
    const space = await owner.call('POST', '/spaces', { name: 'Archivos', slug: 'archivos', audience: 'internal' });
    const uploaded = await owner.request('POST', `/attachments?spaceId=${space.body.space.id}&name=a.png`, {
      headers: { 'content-type': 'application/octet-stream' },
      payload: PNG,
    });
    const key = uploaded.json().attachment.url.split('/').pop();
    const response = await owner.call('GET', `/files/${key}`);
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'internal', message: 'Algo salió mal, inténtalo de nuevo en un momento.' });
    expect(logs()).toContain('unexpected error');
    expect(logs()).toContain('params: [redacted]');
    expect(logs()).not.toContain(SECRET_IN_QUERY);
  });
});

describe('log sanitizer', () => {
  it('redacts query parameters, credentials in URLs and long tokens', () => {
    expect(sanitizeLogText('Failed query: insert into users\nparams: a@b.c,scrypt$abc')).toBe('Failed query: insert into users\nparams: [redacted]');
    expect(sanitizeLogText('clone https://user:secret@github.com/o/r.git failed')).toBe('clone https://[redacted]@github.com/o/r.git failed');
    expect(sanitizeLogText(`token ${'x'.repeat(43)} leaked`)).toBe('token [redacted] leaked');
  });
});
