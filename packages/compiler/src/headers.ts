import type { Spec } from '@capidocs/spec';

export interface SiteOrigins {
  connect: Set<string>;
  style: Set<string>;
  font: Set<string>;
  img: Set<string>;
}

const GOOGLE_FONTS_CSS = 'https://fonts.googleapis.com';
const GOOGLE_FONTS_FILES = 'https://fonts.gstatic.com';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost']);
const MAX_IMG_TAG = 4096;

function originOf(value: unknown, secure: boolean): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:') return url.origin;
    if (url.protocol === 'http:' && (!secure || LOOPBACK_HOSTS.has(url.hostname))) return url.origin;
    return null;
  } catch {
    return null;
  }
}

function asciiLower(value: string): string {
  return value.replace(/[A-Z]+/g, (letters) => letters.toLowerCase());
}

export function imageSources(html: string): string[] {
  const lower = asciiLower(html);
  const sources: string[] = [];
  let pos = 0;
  for (;;) {
    const start = lower.indexOf('<img', pos);
    if (start === -1) break;
    const end = lower.indexOf('>', start);
    if (end === -1) break;
    const boundary = lower[start + 4];
    if (end - start <= MAX_IMG_TAG && (boundary === '>' || boundary === '/' || /\s/.test(boundary ?? ''))) {
      const match = /(?:^|\s)src\s*=\s*["']([^"']+)["']/i.exec(html.slice(start + 4, end));
      if (match?.[1]) sources.push(match[1]);
    }
    pos = end + 1;
  }
  return sources;
}

export function isSecureSite(specs: Spec[]): boolean {
  return !specs.some((spec) => /^http:/i.test(spec.site_config.site_url ?? ''));
}

export function collectOrigins(specs: Spec[]): SiteOrigins {
  const origins: SiteOrigins = { connect: new Set(), style: new Set(), font: new Set(), img: new Set() };
  const secure = isSecureSite(specs);
  const addOrigin = (target: Set<string>, value: unknown, strict = true): void => {
    const origin = originOf(value, strict && secure);
    if (origin) target.add(origin);
  };
  for (const spec of specs) {
    const site = spec.site_config;
    addOrigin(origins.connect, spec.api?.base_url);
    if (site.access?.mode === 'gate') addOrigin(origins.connect, site.access.endpoint);
    for (const href of site.theme?.fonts?.imports ?? []) addOrigin(origins.style, href, false);
    for (const logo of Object.values(site.logos ?? {})) addOrigin(origins.img, logo);
    for (const page of Object.values(spec.pages)) {
      if (page.template === 'hero') {
        addOrigin(origins.connect, page.content.hero.base_url);
        continue;
      }
      for (const section of page.content.sections ?? []) {
        addOrigin(origins.img, section.image?.src);
        for (const source of imageSources(section.prose ?? '')) addOrigin(origins.img, source);
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
    ['upgrade-insecure-requests', []],
  ];
  return directives.map(([name, values]) => (values.length ? `${name} ${values.join(' ')}` : name)).join('; ');
}

export function buildHeaders(specs: Spec[]): string {
  const headers = [
    `Content-Security-Policy: ${buildContentSecurityPolicy(specs)}`,
    'X-Content-Type-Options: nosniff',
    'X-Frame-Options: DENY',
    'Referrer-Policy: strict-origin-when-cross-origin',
    'Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Cross-Origin-Opener-Policy: same-origin',
    'Strict-Transport-Security: max-age=31536000; includeSubDomains',
  ];
  return `/*\n${headers.map((header) => `  ${header}`).join('\n')}\n`;
}
