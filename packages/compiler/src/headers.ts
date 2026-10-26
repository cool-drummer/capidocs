import type { Spec } from '@capidocs/spec';

export interface SiteOrigins {
  connect: Set<string>;
  style: Set<string>;
  font: Set<string>;
  img: Set<string>;
}

const GOOGLE_FONTS_CSS = 'https://fonts.googleapis.com';
const GOOGLE_FONTS_FILES = 'https://fonts.gstatic.com';

function originOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null;
  } catch {
    return null;
  }
}

function addOrigin(target: Set<string>, value: unknown): void {
  const origin = originOf(value);
  if (origin) target.add(origin);
}

const IMG_SRC = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;

export function collectOrigins(specs: Spec[]): SiteOrigins {
  const origins: SiteOrigins = { connect: new Set(), style: new Set(), font: new Set(), img: new Set() };
  for (const spec of specs) {
    const site = spec.site_config;
    addOrigin(origins.connect, spec.api?.base_url);
    if (site.access?.mode === 'gate') addOrigin(origins.connect, site.access.endpoint);
    for (const href of site.theme?.fonts?.imports ?? []) addOrigin(origins.style, href);
    for (const logo of Object.values(site.logos ?? {})) addOrigin(origins.img, logo);
    for (const page of Object.values(spec.pages)) {
      if (page.template === 'hero') {
        addOrigin(origins.connect, page.content.hero.base_url);
        continue;
      }
      for (const section of page.content.sections ?? []) {
        addOrigin(origins.img, section.image?.src);
        for (const match of (section.prose ?? '').matchAll(IMG_SRC)) addOrigin(origins.img, match[1]);
      }
    }
  }
  if (origins.style.has(GOOGLE_FONTS_CSS)) origins.font.add(GOOGLE_FONTS_FILES);
  return origins;
}

const sorted = (values: Set<string>) => [...values].sort();

export function buildContentSecurityPolicy(specs: Spec[]): string {
  const origins = collectOrigins(specs);
  const directives: [string, string[]][] = [
    ['default-src', ["'self'"]],
    ['script-src', ["'self'"]],
    ['style-src', ["'self'", ...sorted(origins.style)]],
    ['font-src', ["'self'", 'data:', ...sorted(origins.font)]],
    ['img-src', ["'self'", 'data:', 'blob:', ...sorted(origins.img)]],
    ['connect-src', ["'self'", ...sorted(origins.connect)]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'none'"]],
    ['form-action', ["'none'"]],
    ['frame-ancestors', ["'none'"]],
  ];
  return directives.map(([name, values]) => `${name} ${values.join(' ')}`).join('; ');
}

export function buildHeaders(specs: Spec[]): string {
  const headers = [
    `Content-Security-Policy: ${buildContentSecurityPolicy(specs)}`,
    'X-Content-Type-Options: nosniff',
    'X-Frame-Options: DENY',
    'Referrer-Policy: strict-origin-when-cross-origin',
    'Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
    'Cross-Origin-Opener-Policy: same-origin',
    'Strict-Transport-Security: max-age=31536000; includeSubDomains',
  ];
  return `/*\n${headers.map((header) => `  ${header}`).join('\n')}\n`;
}
