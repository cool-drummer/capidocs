import type { Spec } from '@capidocs/spec';
import { buildSearchIndex, orderedRoutes, pageMarkdown, pageSummary, type SearchEntry } from '@capidocs/site/spec-utils';

export interface SiteOutputs {
  searchIndex: SearchEntry[];
  llms: string;
  llmsFull: string;
  sitemap: string;
  robots: string;
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[char] ?? char);
}

export function buildLlms(spec: Spec): string {
  const api = spec.api ?? {};
  const site = spec.site_config;
  const lines: string[] = [`# ${api.name ?? site.name ?? 'API Documentation'}`];
  if (api.description) lines.push('', `> ${api.description}`);
  if (api.base_url) lines.push('', `Base URL: ${api.base_url}`);
  lines.push('', '## Pages');
  for (const route of orderedRoutes(spec)) {
    const summary = pageSummary(spec, route.id);
    lines.push(`- [${route.title}](#${route.id})${summary ? `: ${summary}` : ''}`);
  }
  return `${lines.join('\n')}\n`;
}

export function buildLlmsFull(spec: Spec): string {
  const api = spec.api ?? {};
  const lines: string[] = [`# ${api.name ?? 'API Documentation'} — full documentation`, ''];
  for (const route of orderedRoutes(spec)) {
    lines.push(pageMarkdown(spec, route.id), '', '---', '');
  }
  return lines.join('\n');
}

export function siteUrl(spec: Spec): string {
  return (spec.site_config.site_url ?? 'https://example.com').replace(/\/$/, '');
}

export function buildSitemap(spec: Spec): string {
  const base = siteUrl(spec);
  const urls = orderedRoutes(spec).map((route) => `  <url><loc>${escapeXml(base)}/#${escapeXml(route.id)}</loc></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

export function buildRobots(spec: Spec): string {
  const base = siteUrl(spec);
  return `User-agent: *\nAllow: /\n\nSitemap: ${base}/sitemap.xml\n# LLM-friendly docs\n# ${base}/llms.txt\n# ${base}/llms-full.txt\n`;
}

export function buildOutputs(spec: Spec, labels?: { guide?: string; page?: string }): SiteOutputs {
  return {
    searchIndex: buildSearchIndex(spec, labels),
    llms: buildLlms(spec),
    llmsFull: buildLlmsFull(spec),
    sitemap: buildSitemap(spec),
    robots: buildRobots(spec),
  };
}
