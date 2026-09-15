declare module '@capidocs/site/spec-utils' {
  import type { Spec } from '@capidocs/spec';

  export interface SearchEntry {
    type: 'page' | 'section' | 'endpoint';
    title: string;
    route: string;
    subtitle: string;
    text: string;
    anchor?: string;
    method?: string;
    path?: string;
  }

  export function slug(text: string): string;
  export function orderedRoutes(spec: Spec): { id: string; title: string }[];
  export function pageGroupMap(spec: Spec): Record<string, string>;
  export function stripTags(html: string): string;
  export function sectionText(section: unknown): string;
  export function buildSearchIndex(spec: Spec, labels?: { guide?: string; page?: string }): SearchEntry[];
  export function codeText(block: unknown): string;
  export function pageMarkdown(spec: Spec, route: string): string;
  export function pageSummary(spec: Spec, route: string, maxLength?: number): string;
}
