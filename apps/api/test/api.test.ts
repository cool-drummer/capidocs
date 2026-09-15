import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateSpec } from '@capidocs/spec';
import { createApp, type CapidocsApp } from '../src/app.js';
import { can } from '../src/lib/access.js';
import { isValidPosition, positionBetween } from '../src/lib/position.js';

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://capidocs:capidocs@127.0.0.1:55432/capidocs_test';
const ROOT = join(import.meta.dirname, '..', '..', '..');

let app: CapidocsApp;
let outDir: string;
const cookies: Record<string, string> = {};

async function call(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown, who = 'owner') {
  const response = await app.inject({
    method,
    url,
    payload: payload as never,
    headers: cookies[who] ? { cookie: cookies[who]! } : {},
  });
  return { status: response.statusCode, body: response.json() as never, raw: response };
}

async function login(email: string, password: string, who: string) {
  const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
  const header = response.headers['set-cookie'];
  const cookie = Array.isArray(header) ? header[0] : header;
  if (cookie) cookies[who] = cookie.split(';')[0]!;
  return response;
}

beforeAll(async () => {
  const admin = await import('postgres').then((module) => module.default(DATABASE_URL.replace(/\/[^/]+$/, '/postgres')));
  const name = DATABASE_URL.split('/').pop()!;
  await admin.unsafe(`DROP DATABASE IF EXISTS ${name}`);
  await admin.unsafe(`CREATE DATABASE ${name}`);
  await admin.end();

  outDir = await mkdtemp(join(tmpdir(), 'capidocs-portal-'));
  app = await createApp({ databaseUrl: DATABASE_URL, runtimeDir: join(ROOT, 'apps/site') });
}, 60000);

afterAll(async () => {
  await app?.close();
  if (outDir) await rm(outDir, { recursive: true, force: true });
});

describe('access rules', () => {
  const owner = { kind: 'user', userId: 'u1', workspaceId: 'w1', workspaceRole: 'owner' } as const;
  const member = { kind: 'user', userId: 'u2', workspaceId: 'w1', workspaceRole: 'member' } as const;
  const space = { id: 's1', audience: 'internal', portalId: null } as const;

  it('lets an owner do everything in the workspace', () => {
    expect(can(owner, 'space.create', { workspaceId: 'w1' })).toBe(true);
    expect(can(owner, 'workspace.delete', { workspaceId: 'w1' })).toBe(true);
  });

  it('stops an admin from deleting the workspace', () => {
    const admin = { ...owner, workspaceRole: 'admin' } as const;
    expect(can(admin, 'workspace.delete', { workspaceId: 'w1' })).toBe(false);
    expect(can(admin, 'member.invite', { workspaceId: 'w1' })).toBe(true);
  });

  it('separates writing from publishing', () => {
    expect(can(member, 'page.update', { space, spaceRole: 'writer' })).toBe(true);
    expect(can(member, 'page.publish', { space, spaceRole: 'writer' })).toBe(false);
    expect(can(member, 'page.publish', { space, spaceRole: 'admin' })).toBe(true);
  });

  it('gives a reader read only', () => {
    expect(can(member, 'page.read', { space, spaceRole: 'reader' })).toBe(true);
    expect(can(member, 'page.update', { space, spaceRole: 'reader' })).toBe(false);
  });

  it('denies a member with no role in the space', () => {
    expect(can(member, 'page.read', { space, spaceRole: null })).toBe(false);
  });

  it('never crosses workspaces', () => {
    expect(can(owner, 'space.create', { workspaceId: 'other' })).toBe(false);
  });

  it('lets anonymous read only public spaces', () => {
    expect(can({ kind: 'anonymous' }, 'page.read', { space: { id: 's', audience: 'public', portalId: 'p' } })).toBe(true);
    expect(can({ kind: 'anonymous' }, 'page.read', { space })).toBe(false);
  });

  it('keeps a customer inside their own portal', () => {
    const customer = { kind: 'customer', customerId: 'c1', portalId: 'p1' } as const;
    expect(can(customer, 'page.read', { space: { id: 's', audience: 'customers', portalId: 'p1' } })).toBe(true);
    expect(can(customer, 'page.read', { space: { id: 's', audience: 'customers', portalId: 'p2' } })).toBe(false);
    expect(can(customer, 'page.update', { space: { id: 's', audience: 'customers', portalId: 'p1' } })).toBe(false);
  });
});

describe('fractional positions', () => {
  it('keeps order when appending', () => {
    const list: string[] = [];
    for (let i = 0; i < 40; i++) list.push(positionBetween(list[list.length - 1] ?? null, null));
    expect([...list].sort()).toEqual(list);
    expect(new Set(list).size).toBe(list.length);
  });

  it('keeps order when inserting repeatedly between two siblings', () => {
    const lower = positionBetween(null, null);
    let upper = positionBetween(lower, null);
    const inserted: string[] = [];
    for (let i = 0; i < 30; i++) {
      const middle = positionBetween(lower, upper);
      expect(middle > lower).toBe(true);
      expect(middle < upper).toBe(true);
      inserted.push(middle);
      upper = middle;
    }
    expect(new Set(inserted).size).toBe(inserted.length);
  });

  it('rejects malformed positions', () => {
    expect(isValidPosition('')).toBe(false);
    expect(isValidPosition('a0')).toBe(false);
    expect(isValidPosition('a1')).toBe(true);
  });
});

describe('workspace setup and auth', () => {
  it('creates the workspace and its first owner', async () => {
    const response = await call('POST', '/auth/setup', {
      workspaceName: 'Dado',
      workspaceSlug: 'dado',
      name: 'Dan',
      email: 'owner@example.com',
      password: 'una-clave-larga',
      locales: ['es', 'en'],
    });
    expect(response.status).toBe(201);
  });

  it('refuses a second setup', async () => {
    const response = await call('POST', '/auth/setup', {
      workspaceName: 'Otro',
      workspaceSlug: 'otro',
      name: 'Otra',
      email: 'otra@example.com',
      password: 'una-clave-larga',
    });
    expect(response.status).toBe(409);
  });

  it('rejects a wrong password with a friendly message', async () => {
    const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'owner@example.com', password: 'mala' } });
    expect(response.statusCode).toBe(401);
    expect(response.json().message).toBe('Correo o contraseña incorrectos.');
    expect(JSON.stringify(response.json())).not.toMatch(/scrypt|hash|sql|column/i);
  });

  it('logs in and returns the session', async () => {
    const response = await login('owner@example.com', 'una-clave-larga', 'owner');
    expect(response.statusCode).toBe(200);
    expect(response.json().user.role).toBe('owner');
    const me = await call('GET', '/me');
    expect(me.body.workspace.defaultLocale).toBe('es');
  });

  it('refuses anything without a session', async () => {
    const response = await app.inject({ method: 'GET', url: '/spaces' });
    expect(response.statusCode).toBe(401);
  });
});

describe('portal, space and pages', () => {
  const ids: Record<string, string> = {};

  it('creates a portal', async () => {
    const response = await call('POST', '/portals', {
      name: 'Axiant',
      slug: 'axiant',
      siteUrl: 'https://axiant.capital/docs',
      locales: ['es'],
      accessMode: 'open',
      brand: { accent: { light: '#ff6a13', dark: '#ff7d2e' } },
    });
    expect(response.status).toBe(201);
    ids.portal = response.body.portal.id;
  });

  it('refuses a public space with no portal', async () => {
    const response = await call('POST', '/spaces', { name: 'Suelto', slug: 'suelto', audience: 'public' });
    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Un espacio público o de clientes necesita un portal.');
  });

  it('creates a public space bound to the portal', async () => {
    const response = await call('POST', '/spaces', {
      name: 'Guías',
      slug: 'guias',
      audience: 'public',
      portalId: ids.portal,
    });
    expect(response.status).toBe(201);
    ids.space = response.body.space.id;
  });

  it('creates a hero page and two content pages', async () => {
    const home = await call('POST', `/spaces/${ids.space}/pages`, { title: 'Documentación de Axiant', kind: 'hero' });
    expect(home.status).toBe(201);
    ids.home = home.body.page.id;

    const first = await call('POST', `/spaces/${ids.space}/pages`, { title: 'Primeros pasos' });
    const second = await call('POST', `/spaces/${ids.space}/pages`, { title: 'Seguridad' });
    ids.first = first.body.page.id;
    ids.second = second.body.page.id;
    expect(first.body.page.position < second.body.page.position).toBe(true);
  });

  it('saves content with the block vocabulary of the spec', async () => {
    const response = await call('PUT', `/pages/${ids.first}/content`, {
      locale: 'es',
      title: 'Primeros pasos',
      document: {
        version: 1,
        sections: [
          {
            title: 'Crea tu cuenta',
            content: 'Te damos acceso al portal en menos de un día.',
            callout: { type: 'tip', title: 'Consejo', content: 'Usa el correo de tu organización.' },
            steps: [{ number: '1', title: 'Solicita acceso', description: 'Escríbenos.' }],
          },
          {
            title: 'Configura tu contraseña',
            prose: '<p>Elige una contraseña de <strong>al menos 10</strong> caracteres.</p>',
          },
        ],
      },
    });
    expect(response.status).toBe(200);
  });

  it('rejects a block the spec does not know', async () => {
    const response = await call('PUT', `/pages/${ids.second}/content`, {
      locale: 'es',
      title: 'Seguridad',
      document: { version: 1, sections: [{ title: 'X', inventado: true }] },
    });
    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Revisa los datos e inténtalo de nuevo.');
  });

  it('returns the tree in position order', async () => {
    const response = await call('GET', `/spaces/${ids.space}/tree`);
    expect(response.status).toBe(200);
    const titles = response.body.tree.map((node: { title: string }) => node.title);
    expect(titles).toEqual(['Documentación de Axiant', 'Primeros pasos', 'Seguridad']);
  });

  it('moves a page to the front and keeps the order consistent', async () => {
    const response = await call('POST', `/pages/${ids.second}/move`, { parentPageId: null, index: 0 });
    expect(response.status).toBe(200);
    const tree = await call('GET', `/spaces/${ids.space}/tree`);
    expect(tree.body.tree[0].title).toBe('Seguridad');
  });

  it('nests a page under another', async () => {
    const response = await call('POST', `/pages/${ids.second}/move`, { parentPageId: ids.first, index: 0 });
    expect(response.status).toBe(200);
    const tree = await call('GET', `/spaces/${ids.space}/tree`);
    const parent = tree.body.tree.find((node: { id: string }) => node.id === ids.first);
    expect(parent.children.map((child: { title: string }) => child.title)).toEqual(['Seguridad']);
  });

  it('refuses to move a page inside itself', async () => {
    const response = await call('POST', `/pages/${ids.first}/move`, { parentPageId: ids.second, index: 0 });
    expect(response.status).toBe(400);
  });

  it('snapshots a version only when the content changed', async () => {
    const first = await call('POST', `/pages/${ids.first}/versions`, { locale: 'es' });
    expect(first.body.version.version).toBe(1);
    const again = await call('POST', `/pages/${ids.first}/versions`, { locale: 'es' });
    expect(again.body.version).toBeNull();
  });

  it('keeps unpublished pages out of the portal build', async () => {
    const response = await call('POST', `/portals/${ids.portal}/publish`);
    expect(response.status).toBe(400);
    expect(response.body.message).toBe('No hay páginas publicadas en este portal todavía.');
  });

  it('publishes each page and then the portal', async () => {
    for (const key of ['home', 'first', 'second']) {
      if (key !== 'home') {
        await call('PUT', `/pages/${ids[key]!}/content`, {
          locale: 'es',
          title: key === 'first' ? 'Primeros pasos' : 'Seguridad',
          document: { version: 1, sections: [{ title: 'Resumen', content: 'Contenido listo para publicar.' }] },
        });
      }
      const published = await call('POST', `/pages/${ids[key]!}/publish`, { locale: 'es' });
      expect(published.status).toBe(200);
    }

    const response = await call('POST', `/portals/${ids.portal}/publish`);
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('done');
    expect(response.body.routes).toBe(3);
  });

  it('compiles a spec the phase 0 schema accepts', async () => {
    const response = await call('GET', `/portals/${ids.portal}/preview`);
    expect(response.status).toBe(200);
    const spec = response.body.specs[0].spec;
    const result = validateSpec(spec);
    expect(result.issues).toEqual([]);
    expect(Object.keys(spec.pages)).toContain('home');
    expect(spec.site_config.theme.accent.light).toBe('#ff6a13');
  });

  it('reports no change when publishing twice', async () => {
    const response = await call('POST', `/portals/${ids.portal}/publish`);
    expect(response.body.status).toBe('unchanged');
  });

  it('writes a runnable site when the portal has a directory target', async () => {
    const portal = await call('POST', '/portals', {
      name: 'Teseracto',
      slug: 'teseracto',
      siteUrl: 'https://teserac.to/docs',
      locales: ['es'],
      deployTarget: { kind: 'directory', path: outDir },
    });
    const space = await call('POST', '/spaces', {
      name: 'Portal',
      slug: 'portal-tese',
      audience: 'public',
      portalId: portal.body.portal.id,
    });
    const page = await call('POST', `/spaces/${space.body.space.id}/pages`, { title: 'Inicio Teseracto', kind: 'hero' });
    await call('POST', `/pages/${page.body.page.id}/publish`, { locale: 'es' });

    const response = await call('POST', `/portals/${portal.body.portal.id}/publish`);
    expect(response.status).toBe(200);
    expect(existsSync(join(outDir, 'index.html'))).toBe(true);
    expect(existsSync(join(outDir, 'assets', 'js', 'main.js'))).toBe(true);
    const spec = JSON.parse(readFileSync(join(outDir, 'config', 'api-spec.json'), 'utf8'));
    expect(validateSpec(spec).ok).toBe(true);
    expect(readFileSync(join(outDir, 'robots.txt'), 'utf8')).toContain('https://teserac.to/docs/sitemap.xml');
  });
});

describe('space isolation', () => {
  it('hides a space from a member with no role in it', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/auth/setup',
      payload: { workspaceName: 'Otro', workspaceSlug: 'otro', name: 'Otra', email: 'otra2@example.com', password: 'una-clave-larga' },
    });
    expect(created.statusCode).toBe(409);

    const db = app.db;
    const { users: usersTable, members: membersTable } = await import('../src/db/schema.js');
    const { hashPassword } = await import('../src/lib/auth.js');
    const workspaceRows = await db.query.workspaces.findMany();
    const [reader] = await db
      .insert(usersTable)
      .values({ email: 'reader@example.com', name: 'Lectora', passwordHash: await hashPassword('otra-clave-larga') })
      .returning();
    await db.insert(membersTable).values({ workspaceId: workspaceRows[0]!.id, userId: reader!.id, role: 'member' });

    await login('reader@example.com', 'otra-clave-larga', 'reader');
    const spacesResponse = await call('GET', '/spaces', undefined, 'reader');
    expect(spacesResponse.body.spaces).toEqual([]);
  });

  it('refuses direct access to a page in a space the member cannot see', async () => {
    const owned = await call('GET', '/spaces', undefined, 'owner');
    const spaceId = owned.body.spaces[0].id;
    const tree = await call('GET', `/spaces/${spaceId}/tree`, undefined, 'owner');
    const pageId = tree.body.tree[0].id;

    const denied = await call('GET', `/pages/${pageId}`, undefined, 'reader');
    expect(denied.status).toBe(403);
    const deniedTree = await call('GET', `/spaces/${spaceId}/tree`, undefined, 'reader');
    expect(deniedTree.status).toBe(403);
    const deniedWrite = await call('PUT', `/pages/${pageId}/content`, { locale: 'es', title: 'x', document: { version: 1, sections: [] } }, 'reader');
    expect(deniedWrite.status).toBe(403);
  });

  it('refuses to create a space as a plain member', async () => {
    const response = await call('POST', '/spaces', { name: 'Nuevo', slug: 'nuevo', audience: 'internal' }, 'reader');
    expect(response.status).toBe(403);
  });
});
