import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateSpec } from '@capidocs/spec';
import { createApp, type CapidocsApp } from '../src/app.js';
import { Client, memoryMailer, resetDatabase, testConfig, testDatabaseUrl } from './helpers.js';

const DATABASE_URL = testDatabaseUrl('capidocs_publish_test');
const PASSWORD = 'una-clave-bastante-larga';
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex');

let app: CapidocsApp;
let scratch: string;
let owner: Client;
let portalId = '';
let publicSpace = '';
let internalSpace = '';
let pageId = '';

async function upload(spaceId: string): Promise<string> {
  const response = await owner.request('POST', `/attachments?spaceId=${spaceId}&name=panel.png`, {
    headers: { 'content-type': 'application/octet-stream' },
    payload: PNG,
  });
  expect(response.statusCode).toBe(201);
  return response.json().attachment.url;
}

async function writePage(sections: unknown[]) {
  const saved = await owner.call('PUT', `/pages/${pageId}/content`, { locale: 'es', title: 'Guía', document: { version: 1, sections } });
  expect(saved.status).toBe(200);
  expect((await owner.call('POST', `/pages/${pageId}/publish`, { locale: 'es' })).status).toBe(200);
}

beforeAll(async () => {
  await resetDatabase(DATABASE_URL);
  scratch = await mkdtemp(join(tmpdir(), 'capidocs-publish-'));
  app = await createApp(testConfig(DATABASE_URL, { FILES_DIR: join(scratch, 'files'), PUBLISH_ROOT: join(scratch, 'sites') }), {
    mailer: memoryMailer(),
  });
  owner = new Client(app);
  await owner.call('POST', '/auth/setup', { workspaceName: 'Acme', workspaceSlug: 'acme', name: 'Dueña', email: 'owner@example.com', password: PASSWORD });
  await owner.login('owner@example.com', PASSWORD);
  portalId = (await owner.call('POST', '/portals', { name: 'Acme', slug: 'acme', deployTarget: { kind: 'directory', path: 'acme' } })).body.portal.id;
  publicSpace = (await owner.call('POST', '/spaces', { name: 'Guías', slug: 'guias', audience: 'public', portalId })).body.space.id;
  internalSpace = (await owner.call('POST', '/spaces', { name: 'Interno', slug: 'interno', audience: 'internal' })).body.space.id;
  pageId = (await owner.call('POST', `/spaces/${publicSpace}/pages`, { title: 'Guía' })).body.page.id;
}, 60000);

afterAll(async () => {
  await app?.close();
  if (scratch) await rm(scratch, { recursive: true, force: true });
});

describe('publishing with attachments', () => {
  it('copies uploaded files into the site and points the spec at them', async () => {
    const url = await upload(publicSpace);
    const key = url.split('/').pop()!;
    await writePage([
      { title: 'Panel', image: { src: url, alt: 'Panel' } },
      { title: 'Texto', prose: `<p>Mira <img src="${url}" alt="panel"></p>` },
    ]);

    const response = await owner.call('POST', `/portals/${portalId}/publish`);
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('done');

    const site = join(scratch, 'sites', 'acme');
    expect(readFileSync(join(site, 'assets', 'uploads', key)).equals(PNG)).toBe(true);
    const raw = readFileSync(join(site, 'config', 'api-spec.json'), 'utf8');
    expect(raw).not.toContain('/api/files/');
    expect(raw).toContain(`assets/uploads/${key}`);
    expect(validateSpec(JSON.parse(raw)).issues).toEqual([]);
    expect(readFileSync(join(site, 'search-index.json'), 'utf8')).not.toContain('/api/files/');
  });

  it('refuses to publish a file that belongs to a space outside the portal', async () => {
    const foreign = await upload(internalSpace);
    await writePage([{ title: 'Panel', image: { src: foreign, alt: 'Panel' } }]);
    const response = await owner.call('POST', `/portals/${portalId}/publish`);
    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Una página usa un archivo que no pertenece a este portal. Súbelo de nuevo desde el editor de la página.');
    expect(existsSync(join(scratch, 'sites', 'acme', 'assets', 'uploads', foreign.split('/').pop()!))).toBe(false);
  });
});
