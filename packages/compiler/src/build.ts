import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { assertSpec, type Spec } from '@capidocs/spec';
import { resolveCodeFiles } from './resolve.js';
import { buildOutputs } from './outputs.js';
import { buildHeaders } from './headers.js';
import { validateSpecDiagrams, type DiagramBlockIssue } from './spec-diagrams.js';

export interface BuildResult {
  siteDir: string;
  specPath: string;
  spec: Spec;
  missingFiles: string[];
  diagramIssues: DiagramBlockIssue[];
  written: { path: string; bytes: number }[];
}

export async function loadSpecFile(
  specPath: string,
): Promise<{ spec: Spec; missingFiles: string[]; diagramIssues: DiagramBlockIssue[] }> {
  const raw = JSON.parse(await readFile(specPath, 'utf8')) as unknown;
  const spec = assertSpec(raw, specPath);
  const baseDir = dirname(dirname(specPath));
  const { missing } = await resolveCodeFiles(spec, { baseDir });
  const diagramIssues = await validateSpecDiagrams(spec, { baseDir });
  return { spec, missingFiles: missing, diagramIssues };
}

async function loadRelatedSpecs(root: string, spec: Spec, specFile: string): Promise<Spec[]> {
  const site = spec.site_config;
  const files = new Set(
    [...(site.languages ?? []).map((entry) => entry.spec), ...(site.versions ?? []).map((entry) => entry.spec)]
      .filter((file): file is string => typeof file === 'string' && !/^[a-z]+:/i.test(file) && file !== specFile),
  );
  const specs: Spec[] = [];
  for (const file of files) {
    const path = resolve(root, file);
    if (!path.startsWith(`${root}/`)) continue;
    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    specs.push(assertSpec(JSON.parse(raw) as unknown, path));
  }
  return specs;
}

export async function buildSite(siteDir: string, specFile = 'config/api-spec.json'): Promise<BuildResult> {
  const root = resolve(siteDir);
  const specPath = join(root, specFile);
  const { spec, missingFiles, diagramIssues } = await loadSpecFile(specPath);
  const outputs = buildOutputs(spec);
  const related = await loadRelatedSpecs(root, spec, specFile);

  const files: { path: string; content: string }[] = [
    { path: join(root, 'search-index.json'), content: JSON.stringify(outputs.searchIndex) },
    { path: join(root, 'llms.txt'), content: outputs.llms },
    { path: join(root, 'llms-full.txt'), content: outputs.llmsFull },
    { path: join(root, 'sitemap.xml'), content: outputs.sitemap },
    { path: join(root, 'robots.txt'), content: outputs.robots },
    { path: join(root, '_headers'), content: buildHeaders([spec, ...related]) },
  ];

  const written: { path: string; bytes: number }[] = [];
  for (const file of files) {
    await writeFile(file.path, file.content);
    written.push({ path: file.path, bytes: Buffer.byteLength(file.content) });
  }

  return { siteDir: root, specPath, spec, missingFiles, diagramIssues, written };
}
