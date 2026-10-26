import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type CapidocsApp } from '../src/app.js';
import { detectMime, storageKeyFor } from '../src/modules/attachments.js';
import type { MailMessage } from '../src/lib/mail.js';
import { Client, resetDatabase, testConfig, testDatabaseUrl } from './helpers.js';

const DATABASE_URL = process.env.TEST_ATTACHMENTS_DATABASE_URL ?? testDatabaseUrl('capidocs_attachments_test');

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
    password: 'una-clave-bastante-larga',
  });
  await login('dan@example.com', 'una-clave-bastante-larga', 'owner');
}, 60000);

afterAll(async () => {
  await app?.close();
  if (filesDir) await rm(filesDir, { recursive: true, force: true });
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
    const space = await call('POST', '/spaces', { name: 'Interno', slug: 'interno', audience: 'internal' });
    spaceId = space.body.space.id;

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
