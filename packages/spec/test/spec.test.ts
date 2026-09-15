import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateSpec, assertSpec } from '../src/index.js';

const root = join(import.meta.dirname, '..', '..', '..');
const demoSpecs = [
  'apps/site/config/api-spec.json',
  'apps/site/config/api-spec.en.json',
  'apps/site/config/api-spec-v1.json',
].map((file) => join(root, file));

const extraSpecs = (process.env.CAPIDOCS_EXTRA_SPECS ?? '')
  .split(':')
  .map((entry) => entry.trim())
  .filter(Boolean);

function load(file: string): unknown {
  return JSON.parse(readFileSync(file, 'utf8'));
}

describe('bundled specs', () => {
  it.each(demoSpecs)('%s validates', (file) => {
    const result = validateSpec(load(file));
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

describe.skipIf(!extraSpecs.length)('external specs', () => {
  it.each(extraSpecs)('%s validates', (file) => {
    expect(() => assertSpec(load(file), file)).not.toThrow();
  });
});

describe('strictness', () => {
  const base = () => load(demoSpecs[0]!) as Record<string, unknown>;

  it('rejects unknown block keys inside a section', () => {
    const spec = base();
    const pages = spec.pages as Record<string, { content: { sections: Record<string, unknown>[] } }>;
    pages['getting-started']!.content.sections[0]!.mystery = 'x';
    const result = validateSpec(spec);
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.path)).toContain('pages.getting-started.content.sections.0');
  });

  it('rejects navigation entries that point to missing pages', () => {
    const spec = base();
    (spec.navigation as { id: string }[]).push({ id: 'ghost', title: 'Ghost' } as never);
    const result = validateSpec(spec);
    expect(result.ok).toBe(false);
    expect(result.issues[0]).toMatchObject({ path: expect.stringMatching(/^navigation\.\d+\.id$/) });
  });

  it('requires the home page', () => {
    const spec = base();
    delete (spec.pages as Record<string, unknown>).home;
    const result = validateSpec(spec);
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.path === 'pages.home')).toBe(true);
  });

  it('accepts theme and access configuration', () => {
    const spec = base();
    (spec.site_config as Record<string, unknown>).theme = {
      accent: { light: '#ff6a13', dark: '#ff7d2e' },
      fonts: { sans: 'Inter, sans-serif', imports: ['https://fonts.googleapis.com/css2?family=Inter&display=swap'] },
    };
    (spec.site_config as Record<string, unknown>).access = {
      mode: 'gate',
      endpoint: 'https://example.com/api/docs-access',
      contact: 'hola@example.com',
    };
    expect(validateSpec(spec).ok).toBe(true);
  });

  it('rejects an invalid accent color', () => {
    const spec = base();
    (spec.site_config as Record<string, unknown>).theme = { accent: { light: 'orange', dark: '#fff' } };
    const result = validateSpec(spec);
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.path).toBe('site_config.theme.accent.light');
  });
});
