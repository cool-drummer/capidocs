import type { ZodError } from 'zod';
import { specSchema, type Spec } from './schema.js';

export interface SpecIssue {
  path: string;
  message: string;
}

export type ValidationResult =
  | { ok: true; spec: Spec; issues: [] }
  | { ok: false; spec: null; issues: SpecIssue[] };

function formatZodIssues(error: ZodError): SpecIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.') || '(root)',
    message: issue.message,
  }));
}

function collectRouteIssues(spec: Spec): SpecIssue[] {
  const issues: SpecIssue[] = [];
  const pages = new Set(Object.keys(spec.pages));
  const endpoints = new Set(Object.keys(spec.endpoints ?? {}));

  if (!pages.has('home')) {
    issues.push({ path: 'pages.home', message: 'A hero page with id "home" is required' });
  }

  (spec.navigation ?? []).forEach((item, index) => {
    if (!pages.has(item.id) && !endpoints.has(item.id)) {
      issues.push({ path: `navigation.${index}.id`, message: `Unknown page "${item.id}"` });
    }
  });

  (spec.sections ?? []).forEach((section, sectionIndex) => {
    (section.pages ?? []).forEach((page, pageIndex) => {
      if (!pages.has(page.id)) {
        issues.push({ path: `sections.${sectionIndex}.pages.${pageIndex}.id`, message: `Unknown page "${page.id}"` });
      }
    });
    (section.endpoints ?? []).forEach((endpoint, endpointIndex) => {
      if (!endpoints.has(endpoint.id)) {
        issues.push({
          path: `sections.${sectionIndex}.endpoints.${endpointIndex}.id`,
          message: `Endpoint "${endpoint.id}" has no entry in endpoints`,
        });
      }
    });
  });

  const tabs = spec.site_config.navbar?.tabs ?? [];
  if (tabs.length) {
    const groups = new Set<string>(['nav_guides', ...(spec.sections ?? []).map((section) => section.title)]);
    tabs.forEach((tab, tabIndex) => {
      tab.groups.forEach((group, groupIndex) => {
        if (!groups.has(group)) {
          issues.push({
            path: `site_config.navbar.tabs.${tabIndex}.groups.${groupIndex}`,
            message: `Tab group "${group}" does not match any sidebar section`,
          });
        }
      });
    });
  }

  return issues;
}

export function validateSpec(input: unknown): ValidationResult {
  const parsed = specSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, spec: null, issues: formatZodIssues(parsed.error) };
  }
  const issues = collectRouteIssues(parsed.data);
  if (issues.length) {
    return { ok: false, spec: null, issues };
  }
  return { ok: true, spec: parsed.data, issues: [] };
}

export function assertSpec(input: unknown, label = 'spec'): Spec {
  const result = validateSpec(input);
  if (result.ok) return result.spec;
  const lines = result.issues.map((issue) => `  ${issue.path}: ${issue.message}`);
  throw new Error(`Invalid ${label}:\n${lines.join('\n')}`);
}
