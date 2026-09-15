import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertSpec, validateSpec, type Spec } from '@capidocs/spec';
import { buildSearchIndex, orderedRoutes, pageMarkdown } from '@capidocs/site/spec-utils';
import { buildLlms, buildOutputs, buildRobots, buildSitemap } from '../src/outputs.js';
import { fromOpenApi } from '../src/openapi.js';
import { resolveCodeFiles } from '../src/resolve.js';
import { buildSite } from '../src/build.js';

const root = join(import.meta.dirname, '..', '..', '..');
const siteDir = join(root, 'apps', 'site');

async function loadSpec(file = 'config/api-spec.json'): Promise<Spec> {
  const spec = assertSpec(JSON.parse(await readFile(join(siteDir, file), 'utf8')));
  await resolveCodeFiles(spec, { baseDir: siteDir });
  return spec;
}

describe('outputs', () => {
  it('indexes every page, section and endpoint', async () => {
    const spec = await loadSpec();
    const index = buildSearchIndex(spec);
    const routes = new Set(index.map((entry) => entry.route));
    for (const id of Object.keys(spec.pages)) expect(routes.has(id)).toBe(true);
    for (const id of Object.keys(spec.endpoints ?? {})) expect(routes.has(id)).toBe(true);
    expect(index.filter((entry) => entry.type === 'endpoint')).toHaveLength(Object.keys(spec.endpoints ?? {}).length);
  });

  it('indexes table headers so the prebuilt index matches the runtime one', async () => {
    const spec = await loadSpec();
    const entry = buildSearchIndex(spec).find((item) => item.title === 'Límite de peticiones');
    expect(entry?.text).toContain('Peticiones por hora');
  });

  it('lists every ordered route in llms.txt', async () => {
    const spec = await loadSpec();
    const llms = buildLlms(spec);
    for (const route of orderedRoutes(spec)) expect(llms).toContain(`(#${route.id})`);
  });

  it('writes a sitemap and robots that agree on site_url', async () => {
    const spec = await loadSpec();
    const base = spec.site_config.site_url!.replace(/\/$/, '');
    expect(base).toMatch(/^https:\/\//);
    expect(buildSitemap(spec)).toContain(`<loc>${base}/#home</loc>`);
    expect(buildRobots(spec)).toContain(`Sitemap: ${base}/sitemap.xml`);
  });

  it('escapes xml in the sitemap', () => {
    const spec = {
      site_config: { site_url: 'https://example.com' },
      navigation: [{ id: 'a&b', title: 'A', type: 'page' }],
      pages: { home: { template: 'hero', content: { hero: { title: 'Home' } } }, 'a&b': { template: 'content', content: { title: 'A' } } },
    } as unknown as Spec;
    expect(buildSitemap(spec)).toContain('#a&amp;b');
  });

  it('renders markdown for a page and an endpoint', async () => {
    const spec = await loadSpec();
    const page = pageMarkdown(spec, 'getting-started');
    expect(page.startsWith('# ')).toBe(true);
    expect(page).toContain('## ');
    const endpoint = pageMarkdown(spec, 'data-endpoint');
    expect(endpoint).toContain('`POST /data`');
  });

  it('produces the same five outputs for every bundled locale', async () => {
    for (const file of ['config/api-spec.json', 'config/api-spec.en.json']) {
      const outputs = buildOutputs(await loadSpec(file));
      expect(outputs.searchIndex.length).toBeGreaterThan(30);
      expect(outputs.llms).toMatch(/^# /);
      expect(outputs.llmsFull).toContain('---');
      expect(outputs.sitemap).toContain('<urlset');
      expect(outputs.robots).toContain('User-agent: *');
    }
  });
});

describe('code file resolution', () => {
  it('inlines referenced example files and infers the language', async () => {
    const spec = await loadSpec();
    const example = (spec.endpoints?.['data-endpoint']?.code_examples ?? [])[0];
    expect(typeof example?.code).toBe('string');
    expect(String(example?.code)).toContain('curl');
    expect(example?.language).toBeTruthy();
  });

  it('reports missing files instead of throwing', async () => {
    const spec = { a: { file: 'does-not-exist.sh', content: '' } };
    const { missing } = await resolveCodeFiles(spec, { baseDir: siteDir });
    expect(missing).toEqual(['does-not-exist.sh']);
  });
});

describe('openapi import', () => {
  const openapi = {
    openapi: '3.0.0',
    info: { title: 'Billing API', version: '2.0.0', description: 'Cobros' },
    servers: [{ url: 'https://api.example.com/v2' }],
    paths: {
      '/invoices/{id}': {
        get: {
          operationId: 'getInvoice',
          summary: 'Obtener factura',
          tags: ['Facturas'],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'expand', in: 'query', schema: { type: 'string' }, description: 'Campos a expandir' },
          ],
          responses: {
            200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/Invoice' } } } },
          },
        },
        post: {
          summary: 'Crear factura',
          tags: ['Facturas'],
          requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Invoice' } } } },
          responses: { 201: { description: 'Creada' } },
        },
      },
    },
    components: {
      schemas: {
        Invoice: {
          type: 'object',
          required: ['total'],
          properties: { id: { type: 'string', example: 'inv_1' }, total: { type: 'number' }, paid: { type: 'boolean' } },
        },
      },
    },
  };

  it('converts operations into a valid capidocs spec', () => {
    const spec = fromOpenApi(openapi);
    const result = validateSpec(spec);
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('keeps one endpoint per operation and groups them by tag', () => {
    const spec = fromOpenApi(openapi);
    expect(Object.keys(spec.endpoints ?? {})).toHaveLength(2);
    expect(spec.sections?.[0]?.title).toBe('Facturas');
    expect(spec.sections?.[0]?.endpoints).toHaveLength(2);
  });

  it('resolves $ref schemas into body fields and response examples', () => {
    const spec = fromOpenApi(openapi);
    const post = Object.values(spec.endpoints ?? {}).find((endpoint) => endpoint.method === 'POST');
    expect(Object.keys(post?.request?.body?.schema?.properties ?? {})).toEqual(['id', 'total', 'paid']);
    expect(post?.request?.body?.schema?.required).toEqual(['total']);
    const get = Object.values(spec.endpoints ?? {}).find((endpoint) => endpoint.method === 'GET');
    expect(get?.responses?.['200']?.examples?.success?.value).toMatchObject({ id: 'inv_1' });
  });

  it('always includes an Authorization header and a cURL example', () => {
    const spec = fromOpenApi(openapi);
    const endpoint = Object.values(spec.endpoints ?? {})[0]!;
    expect(endpoint.request?.headers?.[0]?.name).toBe('Authorization');
    expect(String(endpoint.code_examples?.[0]?.code)).toContain('curl -X');
  });
});

describe('build', () => {
  it('writes the five artifacts next to the spec', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'capidocs-build-'));
    try {
      await mkdir(join(dir, 'config'), { recursive: true });
      const spec = JSON.parse(await readFile(join(siteDir, 'config/api-spec.json'), 'utf8'));
      spec.site_config.site_url = 'https://docs.example.com';
      await writeFile(join(dir, 'config', 'api-spec.json'), JSON.stringify(spec));
      const result = await buildSite(dir);
      expect(result.written.map((file) => file.path.split('/').pop())).toEqual([
        'search-index.json',
        'llms.txt',
        'llms-full.txt',
        'sitemap.xml',
        'robots.txt',
      ]);
      expect(await readFile(join(dir, 'robots.txt'), 'utf8')).toContain('https://docs.example.com/sitemap.xml');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
