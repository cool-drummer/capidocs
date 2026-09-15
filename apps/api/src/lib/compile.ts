import { createHash } from 'node:crypto';
import { assertSpec, type Spec } from '@capidocs/spec';
import type { HeroDocument, PageDocument } from './document.js';

export interface PortalInput {
  slug: string;
  name: string;
  brand: {
    accent?: { light: string; dark: string };
    fonts?: { sans?: string; headings?: string; mono?: string; imports?: string[] };
    stylesheet?: string;
    logos?: Record<string, string>;
    useLogos?: boolean;
    icon?: string;
  };
  accessMode: 'open' | 'gate' | 'accounts';
  accessConfig?: Record<string, unknown>;
  siteUrl?: string | null;
  locales: string[];
}

export interface SpacePages {
  spaceId: string;
  spaceName: string;
  spaceSlug: string;
  pages: CompilablePage[];
}

export interface CompilablePage {
  id: string;
  slugId: string;
  kind: 'page' | 'hero' | 'endpoint' | 'feature';
  icon: string | null;
  parentPageId: string | null;
  position: string;
  title: string;
  document: PageDocument | HeroDocument | Record<string, unknown>;
}

export interface CompileInput {
  portal: PortalInput;
  locale: string;
  defaultLocale: string;
  spaces: SpacePages[];
  ui?: Record<string, string>;
}

export interface CompileResult {
  spec: Spec;
  checksum: string;
  routeIds: string[];
}

function routeId(page: CompilablePage): string {
  return page.slugId;
}

function accessBlock(portal: PortalInput): Spec['site_config']['access'] {
  if (portal.accessMode === 'open') return { mode: 'open' };
  if (portal.accessMode === 'accounts') {
    const url = String(portal.accessConfig?.portal_url ?? '');
    return url ? { mode: 'accounts', portal_url: url } : { mode: 'open' };
  }
  const endpoint = String(portal.accessConfig?.endpoint ?? '');
  if (!endpoint) return { mode: 'open' };
  const gate: { mode: 'gate'; endpoint: string; brand?: string; contact?: string; days?: number } = {
    mode: 'gate',
    endpoint,
    brand: portal.name,
  };
  const contact = portal.accessConfig?.contact;
  if (typeof contact === 'string' && contact) gate.contact = contact;
  return gate;
}

export function compilePortal(input: CompileInput): CompileResult {
  const { portal, locale, spaces } = input;
  const pages: Spec['pages'] = {};
  const sections: NonNullable<Spec['sections']> = [];
  const navigation: NonNullable<Spec['navigation']> = [];
  const routeIds: string[] = [];
  const titles: Record<string, string> = {};

  let home: CompilablePage | null = null;
  for (const space of spaces) {
    for (const page of space.pages) {
      if (page.kind === 'hero' && !home) home = page;
    }
  }

  for (const space of spaces) {
    const entries: { id: string; title: string; icon?: string }[] = [];
    for (const page of [...space.pages].sort((a, b) => (a.position < b.position ? -1 : 1))) {
      const id = page === home ? 'home' : routeId(page);
      routeIds.push(id);
      titles[id] = page.title;

      if (page.kind === 'hero') {
        const doc = page.document as HeroDocument;
        pages[id] = {
          template: 'hero',
          content: {
            hero: doc.hero,
            ...(doc.features ? { features: doc.features } : {}),
          },
        };
      } else {
        const doc = page.document as PageDocument;
        pages[id] = {
          template: 'content',
          content: {
            title: page.title,
            sections: doc.sections ?? [],
          },
        };
      }

      entries.push({ id, title: page.title, ...(page.icon ? { icon: page.icon } : {}) });
    }
    if (entries.length) sections.push({ title: space.spaceName, pages: entries });
  }

  if (!pages.home) {
    pages.home = {
      template: 'hero',
      content: { hero: { title: portal.name, subtitle: '' } },
    };
    navigation.push({ id: 'home', title: portal.name, type: 'page' });
    routeIds.unshift('home');
  }

  const brand = portal.brand ?? {};
  const theme: NonNullable<Spec['site_config']['theme']> = {};
  if (brand.accent) theme.accent = brand.accent;
  if (brand.fonts) theme.fonts = brand.fonts;
  if (brand.stylesheet) theme.stylesheet = brand.stylesheet;

  const spec: Spec = {
    site_config: {
      name: portal.name,
      brand: portal.name,
      use_logos: !!brand.useLogos,
      ...(brand.logos ? { logos: brand.logos } : {}),
      default_theme: 'system',
      ...(Object.keys(theme).length ? { theme } : {}),
      access: accessBlock(portal),
      lang: locale,
      ...(portal.siteUrl ? { site_url: portal.siteUrl } : {}),
      page_titles: { base_title: portal.name, separator: ' | ', routes: titles },
      ...(portal.locales.length > 1
        ? {
            languages: portal.locales.map((code) => ({
              code,
              label: code.toUpperCase(),
              spec: code === input.defaultLocale ? 'config/api-spec.json' : `config/api-spec.${code}.json`,
            })),
          }
        : {}),
      ...(input.ui ? { ui: input.ui } : {}),
    },
    ...(navigation.length ? { navigation } : {}),
    sections,
    pages,
  };

  const validated = assertSpec(spec, `portal ${portal.slug} (${locale})`);
  const checksum = createHash('sha256').update(JSON.stringify(validated)).digest('hex');
  return { spec: validated, checksum, routeIds };
}
