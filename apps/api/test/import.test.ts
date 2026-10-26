import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateSpec } from '@capidocs/spec';
import { createApp, type CapidocsApp } from '../src/app.js';
import { importSpec } from '../src/lib/import-spec.js';
import { Client, resetDatabase, testDatabaseUrl } from './helpers.js';

const DATABASE_URL = process.env.TEST_IMPORT_DATABASE_URL ?? testDatabaseUrl('capidocs_import_test');
const ROOT = join(import.meta.dirname, '..', '..', '..');

const available = (process.env.CAPIDOCS_EXTRA_SPECS ?? '')
  .split(':')
  .filter((path) => path && existsSync(path))
  .map((path, index) => ({ label: `Portal externo ${index + 1}`, path }));

let app: CapidocsApp;
let owner: Client;

async function call(method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) {
  return owner.call(method, url, payload);
}

beforeAll(async () => {
  await resetDatabase(DATABASE_URL);
  app = await createApp({ databaseUrl: DATABASE_URL, runtimeDir: join(ROOT, 'apps/site') });
  owner = new Client(app);
  await call('POST', '/auth/setup', {
    workspaceName: 'Acme',
    workspaceSlug: 'acme',
    name: 'Dan',
    email: 'owner@example.com',
    password: 'una-clave-larga',
  });
  await owner.login('owner@example.com', 'una-clave-larga');
}, 60000);

afterAll(async () => {
  await app?.close();
});

describe('spec import', () => {
  it('reads the demo spec into spaces that mirror its sidebar', () => {
    const spec = JSON.parse(readFileSync(join(ROOT, 'apps/site/config/api-spec.json'), 'utf8'));
    const imported = importSpec(spec, { label: 'demo' });
    expect(imported.name).toBe('capidocs');
    expect(imported.spaces.map((space) => space.name)).toEqual(['Guías', 'Plataforma', 'Funciones avanzadas']);
    const pageCount = imported.spaces.reduce((total, space) => total + space.pages.length, 0);
    expect(pageCount).toBe(Object.keys(spec.pages).length);
  });

  it('leaves out a sidebar section that only holds endpoints', () => {
    const spec = JSON.parse(readFileSync(join(ROOT, 'apps/site/config/api-spec.json'), 'utf8'));
    const endpointOnly = spec.sections.find((section: { endpoints?: unknown[]; pages?: unknown[] }) => section.endpoints && !section.pages);
    expect(endpointOnly).toBeTruthy();
    expect(importSpec(spec).spaces.map((space) => space.name)).not.toContain(endpointOnly.title);
  });

  it('marks a page only once even if it appears twice in the spec', () => {
    const spec = {
      site_config: { brand: 'X' },
      navigation: [{ id: 'home', title: 'Inicio', type: 'page' }],
      sections: [{ title: 'Otra', pages: [{ id: 'home', title: 'Inicio' }] }],
      pages: { home: { template: 'hero', content: { hero: { title: 'Inicio' } } } },
    };
    const imported = importSpec(spec);
    expect(imported.spaces).toHaveLength(1);
    expect(imported.spaces[0]!.pages).toHaveLength(1);
  });

  it('inlines code file references so the stored content is self contained', () => {
    const spec = {
      site_config: { brand: 'X' },
      pages: {
        home: { template: 'hero', content: { hero: { title: 'X' } } },
        guia: {
          template: 'content',
          content: {
            title: 'Guía',
            sections: [
              { title: 'Con archivo', code: { file: 'config/examples/a.sh', language: 'bash' } },
              { title: 'Con contenido', code: { file: 'config/examples/b.sh', content: 'echo hola', language: 'bash' } },
            ],
          },
        },
      },
    };
    const imported = importSpec(spec);
    const sections = (imported.spaces[0]!.pages.find((page) => page.route === 'guia')!.document as { sections: Record<string, never>[] }).sections;
    expect(JSON.stringify(sections)).not.toContain('config/examples');
    expect(sections[1]!.code.content).toBe('echo hola');
    expect(imported.warnings.some((warning) => warning.includes('a.sh'))).toBe(true);
  });

  it('warns about endpoints instead of dropping them silently', () => {
    const spec = JSON.parse(readFileSync(join(ROOT, 'apps/site/config/api-spec.json'), 'utf8'));
    const imported = importSpec(spec);
    expect(imported.warnings.some((warning) => warning.includes('endpoint'))).toBe(true);
  });

  it('carries brand, access and locales across', () => {
    const spec = {
      site_config: {
        brand: 'Globex',
        site_url: 'https://globex.example/docs',
        lang: 'es',
        use_logos: true,
        logos: { navbar_light: 'logos/a.svg' },
        theme: { accent: { light: '#ff6a13', dark: '#ff7d2e' } },
        access: { mode: 'gate', endpoint: 'https://access.globex.example/api/docs-access', contact: 'hola@globex.example' },
      },
      pages: { home: { template: 'hero', content: { hero: { title: 'Globex' } } } },
    };
    const imported = importSpec(spec);
    expect(imported.brand).toMatchObject({ accent: { light: '#ff6a13' }, useLogos: true });
    expect(imported.accessMode).toBe('gate');
    expect(imported.accessConfig.contact).toBe('hola@globex.example');
    expect(imported.siteUrl).toBe('https://globex.example/docs');
  });
});

describe.skipIf(!available.length)('external portals round trip', () => {
  it.each(available)('imports $label and recompiles an equivalent spec', async ({ label, path }) => {
    const original = JSON.parse(readFileSync(path, 'utf8'));

    const imported = await call('POST', '/portals/import', { spec: original, name: label });
    expect(imported.status).toBe(201);
    const pagesImported = (imported.body.spaces as { pages: number }[]).reduce((total, space) => total + space.pages, 0);
    expect(pagesImported).toBe(Object.keys(original.pages).length);

    const preview = await call('GET', `/portals/${imported.body.portalId}/preview`);
    expect(preview.status).toBe(200);
    const rebuilt = preview.body.specs[0].spec;
    expect(validateSpec(rebuilt).issues).toEqual([]);

    const originalTitles = Object.values(original.pages)
      .map((page: never) =>
        (page as { template: string }).template === 'hero'
          ? (page as { content: { hero: { title: string } } }).content.hero.title
          : (page as { content: { title: string } }).content.title,
      )
      .sort();
    const rebuiltTitles = Object.values(rebuilt.pages)
      .map((page: never) =>
        (page as { template: string }).template === 'hero'
          ? (page as { content: { hero: { title: string } } }).content.hero.title
          : (page as { content: { title: string } }).content.title,
      )
      .sort();
    expect(rebuiltTitles).toEqual(originalTitles);

    const originalSections = Object.values(original.pages)
      .filter((page: never) => (page as { template: string }).template === 'content')
      .flatMap((page: never) => (page as { content: { sections?: unknown[] } }).content.sections ?? []);
    const rebuiltSections = Object.values(rebuilt.pages)
      .filter((page: never) => (page as { template: string }).template === 'content')
      .flatMap((page: never) => (page as { content: { sections?: unknown[] } }).content.sections ?? []);
    expect(rebuiltSections).toHaveLength(originalSections.length);
    expect(JSON.stringify(rebuiltSections.map((section) => JSON.stringify(section)).sort())).toBe(
      JSON.stringify(originalSections.map((section) => JSON.stringify(section)).sort()),
    );

    expect(rebuilt.site_config.site_url).toBe(original.site_config.site_url);
    expect(rebuilt.site_config.brand).toBe(label);
  });
});
