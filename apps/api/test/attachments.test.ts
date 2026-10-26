import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type CapidocsApp } from '../src/app.js';
import { contentDisposition, detectMime, sanitizeFileName, storageKeyFor } from '../src/modules/attachments.js';
import { Client, memoryMailer, resetDatabase, testConfig, testDatabaseUrl } from './helpers.js';

const DATABASE_URL = testDatabaseUrl('capidocs_attachments_test');
const PASSWORD = 'una-clave-bastante-larga';
const MAX_BYTES = 4096;
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex');
const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n', 'latin1');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>');
const HTML = Buffer.from('<!doctype html><script>alert(document.cookie)</script>');

const mailer = memoryMailer();
let app: CapidocsApp;
let filesDir: string;
let owner: Client;
let writer: Client;
let reader: Client;
let outsider: Client;
let spaceId = '';
let otherSpaceId = '';

async function upload(client: Client, bytes: Buffer, name = 'panel.png', space = spaceId) {
  return client.request('POST', `/attachments?spaceId=${space}&name=${encodeURIComponent(name)}`, {
    headers: { 'content-type': 'application/octet-stream' },
    payload: bytes,
  });
}

async function joinAs(email: string): Promise<{ client: Client; userId: string }> {
  const invite = await owner.call('POST', '/members/invitations', { email, role: 'member' });
  expect(invite.status).toBe(201);
  const message = mailer.sent.filter((entry) => entry.to === email).pop()!;
  const token = /#invitation=([\w-]+)/.exec(message.action!.url)![1]!;
  const client = new Client(app);
  client.adopt(await client.request('POST', '/invitations/accept', { payload: { token, name: email.split('@')[0]!, password: PASSWORD } }));
  const me = await client.call('GET', '/me');
  return { client, userId: me.body.user.id };
}

beforeAll(async () => {
  await resetDatabase(DATABASE_URL);
  filesDir = await mkdtemp(join(tmpdir(), 'capidocs-files-'));
  app = await createApp(testConfig(DATABASE_URL, { FILES_DIR: filesDir, ATTACHMENT_MAX_BYTES: String(MAX_BYTES) }), { mailer });
  owner = new Client(app);
  await owner.call('POST', '/auth/setup', { workspaceName: 'Acme', workspaceSlug: 'acme', name: 'Dueña', email: 'owner@example.com', password: PASSWORD });
  await owner.login('owner@example.com', PASSWORD);
  spaceId = (await owner.call('POST', '/spaces', { name: 'Interno', slug: 'interno', audience: 'internal' })).body.space.id;
  otherSpaceId = (await owner.call('POST', '/spaces', { name: 'Finanzas', slug: 'finanzas', audience: 'internal' })).body.space.id;

  const w = await joinAs('writer@example.com');
  const r = await joinAs('reader@example.com');
  const o = await joinAs('outsider@example.com');
  writer = w.client;
  reader = r.client;
  outsider = o.client;
  await owner.call('PUT', `/spaces/${spaceId}/members/${w.userId}`, { role: 'writer' });
  await owner.call('PUT', `/spaces/${spaceId}/members/${r.userId}`, { role: 'reader' });
}, 60000);

afterAll(async () => {
  await app?.close();
  if (filesDir) await rm(filesDir, { recursive: true, force: true });
});

describe('type detection and naming', () => {
  it('trusts the bytes, never the name or the declared type', () => {
    expect(detectMime(PNG)).toBe('image/png');
    expect(detectMime(PDF)).toBe('application/pdf');
    expect(detectMime(SVG)).toBeNull();
    expect(detectMime(HTML)).toBeNull();
    expect(detectMime(Buffer.from('not an image'))).toBeNull();
  });

  it('builds an opaque storage key', () => {
    expect(storageKeyFor('image/png')).toMatch(/^[0-9a-f]{32}\.png$/);
  });

  it('cleans the display name and forces the real extension', () => {
    expect(sanitizeFileName('../../etc/passwd.png', 'image/png')).toBe('passwd.png');
    expect(sanitizeFileName('C:\\fotos\\panel "final".jpeg', 'image/jpeg')).toBe('panel final.jpg');
    expect(sanitizeFileName('informe.html', 'application/pdf')).toBe('informe.pdf');
    expect(sanitizeFileName('\u202egnp.exe', 'image/png')).toBe('gnp.png');
    expect(sanitizeFileName('...', 'image/png')).toBe('archivo.png');
  });

  it('writes a header-safe content disposition', () => {
    const header = contentDisposition('año "x".pdf', false);
    expect(header).toBe(`attachment; filename="ano x.pdf"; filename*=UTF-8''a%C3%B1o%20%22x%22.pdf`);
    expect(header).not.toMatch(/[\r\n]/);
  });
});

describe('uploads', () => {
  let key = '';

  it('stores an image from a writer outside any public folder', async () => {
    const response = await upload(writer, PNG, '../../panel.png');
    expect(response.statusCode).toBe(201);
    const attachment = response.json().attachment;
    expect(attachment.mime).toBe('image/png');
    expect(attachment.fileName).toBe('panel.png');
    key = attachment.url.split('/').pop();
    expect(attachment.url).toBe(`/api/files/${key}`);
    expect(await readdir(filesDir)).toEqual([key]);
  });

  it('serves it inert, with the sniffed type and no sniffing allowed', async () => {
    const fetched = await reader.request('GET', `/files/${key}`);
    expect(fetched.statusCode).toBe(200);
    expect(fetched.headers['content-type']).toBe('image/png');
    expect(fetched.headers['x-content-type-options']).toBe('nosniff');
    expect(fetched.headers['content-security-policy']).toBe("default-src 'none'; sandbox");
    expect(fetched.headers['content-disposition']).toMatch(/^inline; filename="panel.png"/);
    expect(Buffer.from(fetched.rawPayload).equals(PNG)).toBe(true);
  });

  it('forces a download for a pdf', async () => {
    const response = await upload(writer, PDF, 'manual.pdf');
    expect(response.statusCode).toBe(201);
    const pdfKey = response.json().attachment.url.split('/').pop();
    const fetched = await reader.request('GET', `/files/${pdfKey}`);
    expect(fetched.headers['content-disposition']).toMatch(/^attachment;/);
  });

  it('refuses svg and html even with an image name', async () => {
    for (const bytes of [SVG, HTML]) {
      const response = await upload(writer, bytes, 'logo.png');
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe('unsupported_file');
    }
  });

  it('refuses a file over the limit with a friendly message', async () => {
    const response = await upload(writer, Buffer.concat([PNG, Buffer.alloc(MAX_BYTES)]));
    expect(response.statusCode).toBe(413);
    expect(response.json().error).toBe('file_too_large');
    expect(response.json().message).toMatch(/^El archivo supera el límite de \d+ MB\.$/);
  });

  it('refuses a page from another space', async () => {
    const page = await owner.call('POST', `/spaces/${otherSpaceId}/pages`, { title: 'Ajena' });
    const response = await writer.request('POST', `/attachments?spaceId=${spaceId}&pageId=${page.body.page.id}&name=x.png`, {
      headers: { 'content-type': 'application/octet-stream' },
      payload: PNG,
    });
    expect(response.statusCode).toBe(400);
  });

  it('refuses a request with no session', async () => {
    expect((await upload(new Client(app), PNG)).statusCode).toBe(401);
    expect((await new Client(app).request('GET', `/files/${key}`)).statusCode).toBe(401);
  });

  it('keeps readers and outsiders from writing', async () => {
    expect((await upload(reader, PNG)).statusCode).toBe(403);
    expect((await upload(outsider, PNG)).statusCode).toBe(403);
  });

  it('keeps members without a role in the space from reading, listing or deleting', async () => {
    expect((await outsider.request('GET', `/files/${key}`)).statusCode).toBe(403);
    expect((await outsider.call('GET', `/attachments?spaceId=${spaceId}`)).status).toBe(403);
    expect((await outsider.call('DELETE', `/attachments/${key}`)).status).toBe(403);
    expect((await reader.call('DELETE', `/attachments/${key}`)).status).toBe(403);
  });

  it('rejects malformed keys without touching storage', async () => {
    expect((await owner.request('GET', '/files/..%2F..%2Fetc%2Fpasswd')).statusCode).toBe(400);
  });

  it('lists only the requested space and deletes the file', async () => {
    const list = await reader.call('GET', `/attachments?spaceId=${spaceId}`);
    expect(list.status).toBe(200);
    expect(list.body.attachments).toHaveLength(2);
    expect(JSON.stringify(list.body)).not.toContain('storageKey');
    expect((await owner.call('GET', '/attachments')).status).toBe(400);

    expect((await writer.call('DELETE', `/attachments/${key}`)).status).toBe(200);
    expect((await owner.call('GET', `/files/${key}`)).status).toBe(404);
    expect(await readdir(filesDir)).not.toContain(key);
  });
});
