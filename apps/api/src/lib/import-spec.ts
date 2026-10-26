import { assertSpec, type Spec } from '@capidocs/spec';
import type { HeroDocument, PageDocument } from './document.js';

export interface ImportedPage {
  route: string;
  title: string;
  kind: 'page' | 'hero';
  icon: string | null;
  document: PageDocument | HeroDocument;
}

export interface ImportedSpace {
  name: string;
  slug: string;
  pages: ImportedPage[];
}

export interface ImportedPortal {
  name: string;
  slug: string;
  siteUrl: string | null;
  locales: string[];
  accessMode: 'open' | 'gate' | 'accounts';
  accessConfig: Record<string, unknown>;
  brand: Record<string, unknown>;
  spaces: ImportedSpace[];
  warnings: string[];
}

const FILE_KEYS = ['file', 'code_file'] as const;

function inlineCodeFiles(node: unknown, missing: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) inlineCodeFiles(item, missing);
    return;
  }
  if (node === null || typeof node !== 'object') return;
  const record = node as Record<string, unknown>;

  for (const key of ['code', 'content'] as const) {
    const value = record[key];
    if (Array.isArray(value) && value.every((item) => typeof item === 'string')) record[key] = value.join('\n');
  }

  for (const key of FILE_KEYS) {
    const path = record[key];
    if (typeof path !== 'string') continue;
    delete record[key];
    const hasInline = typeof record.code === 'string' ? record.code : typeof record.content === 'string' ? record.content : '';
    if (!hasInline) {
      missing.add(path);
      if ('code' in record) record.code = '';
      else record.content = '';
    }
  }

  for (const value of Object.values(record)) inlineCodeFiles(value, missing);
}

function slugify(value: string, fallback: string): string {
  const slug = value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
  return slug || fallback;
}

function heroDocument(page: Extract<Spec['pages'][string], { template: 'hero' }>): HeroDocument {
  const content = page.content;
  const document: HeroDocument = { version: 1, hero: { title: content.hero.title } };
  if (content.hero.subtitle) document.hero.subtitle = content.hero.subtitle;
  if (content.hero.description) document.hero.description = content.hero.description;
  if (content.hero.stats?.length) document.hero.stats = content.hero.stats;
  if (content.features) {
    document.features = {
      ...(content.features.title ? { title: content.features.title } : {}),
      ...(content.features.subtitle ? { subtitle: content.features.subtitle } : {}),
      items: content.features.items,
    };
  }
  return document;
}

export function importSpec(raw: unknown, options: { label?: string } = {}): ImportedPortal {
  const spec = assertSpec(raw, options.label ?? 'spec');
  const warnings: string[] = [];
  const missingFiles = new Set<string>();
  inlineCodeFiles(spec.pages, missingFiles);
  const site = spec.site_config;

  const titleFor = (id: string): string => {
    const page = spec.pages[id];
    if (page) {
      if (page.template === 'hero') return page.content.hero.title;
      return page.content.title;
    }
    const endpoint = spec.endpoints?.[id];
    return endpoint?.title ?? id;
  };

  const claimed = new Set<string>();
  const spaces: ImportedSpace[] = [];

  const collect = (name: string, ids: { id: string; icon?: string }[]): void => {
    const pages: ImportedPage[] = [];
    for (const entry of ids) {
      if (claimed.has(entry.id)) continue;
      const page = spec.pages[entry.id];
      if (!page) {
        if (spec.endpoints?.[entry.id]) {
          warnings.push(`El endpoint "${entry.id}" no se importó: el studio aún no edita endpoints.`);
        } else {
          warnings.push(`La entrada "${entry.id}" no tiene página en el spec.`);
        }
        continue;
      }
      claimed.add(entry.id);
      pages.push({
        route: entry.id,
        title: titleFor(entry.id),
        kind: page.template === 'hero' ? 'hero' : 'page',
        icon: entry.icon ?? null,
        document:
          page.template === 'hero'
            ? heroDocument(page)
            : { version: 1, sections: page.content.sections ?? [] },
      });
    }
    if (pages.length) spaces.push({ name, slug: slugify(name, `space-${spaces.length + 1}`), pages });
  };

  const navigationEntries = (spec.navigation ?? []).map((item) => ({ id: item.id, ...(item.icon ? { icon: item.icon } : {}) }));
  if (navigationEntries.length) collect(site.ui?.nav_guides ?? 'Guías', navigationEntries);

  for (const section of spec.sections ?? []) {
    const entries = [
      ...(section.pages ?? []).map((page) => ({ id: page.id, ...(page.icon ? { icon: page.icon } : {}) })),
      ...(section.endpoints ?? []).map((endpoint) => ({ id: endpoint.id })),
    ];
    collect(section.title, entries);
  }

  const orphans = Object.keys(spec.pages).filter((id) => !claimed.has(id));
  if (orphans.length) collect('Sin agrupar', orphans.map((id) => ({ id })));

  if (missingFiles.size) {
    warnings.push(
      `${missingFiles.size} ejemplo(s) de código venían en archivos aparte y llegaron vacíos: ${[...missingFiles].slice(0, 3).join(', ')}${missingFiles.size > 3 ? '…' : ''}. Pégalos en el editor.`,
    );
  }

  const endpointCount = Object.keys(spec.endpoints ?? {}).length;
  if (endpointCount) {
    warnings.push(`${endpointCount} endpoint(s) quedaron fuera: la referencia de API se sincroniza desde OpenAPI, no se edita a mano.`);
  }

  const access = site.access ?? { mode: 'open' as const };
  const accessConfig: Record<string, unknown> = {};
  if (access.mode === 'gate') {
    accessConfig.endpoint = access.endpoint;
    if (access.contact) accessConfig.contact = access.contact;
  }
  if (access.mode === 'accounts') accessConfig.portal_url = access.portal_url;

  const brand: Record<string, unknown> = {};
  if (site.theme?.accent) brand.accent = site.theme.accent;
  if (site.theme?.fonts) brand.fonts = site.theme.fonts;
  if (site.theme?.stylesheet) brand.stylesheet = site.theme.stylesheet;
  if (site.logos) brand.logos = site.logos;
  if (site.use_logos) brand.useLogos = true;

  const name = site.brand ?? site.name ?? 'Portal';
  return {
    name,
    slug: slugify(name, 'portal'),
    siteUrl: site.site_url ?? null,
    locales: site.languages?.length ? site.languages.map((language) => language.code) : [site.lang ?? 'es'],
    accessMode: access.mode,
    accessConfig,
    brand,
    spaces,
    warnings,
  };
}
