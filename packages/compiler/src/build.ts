import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { assertSpec, type Spec } from '@capidocs/spec';
import { resolveCodeFiles } from './resolve.js';
import { buildOutputs } from './outputs.js';

export interface BuildResult {
  siteDir: string;
  specPath: string;
  spec: Spec;
  missingFiles: string[];
  written: { path: string; bytes: number }[];
}

export async function loadSpecFile(specPath: string): Promise<{ spec: Spec; missingFiles: string[] }> {
  const raw = JSON.parse(await readFile(specPath, 'utf8')) as unknown;
  const spec = assertSpec(raw, specPath);
  const { missing } = await resolveCodeFiles(spec, { baseDir: dirname(dirname(specPath)) });
  return { spec, missingFiles: missing };
}

export async function buildSite(siteDir: string, specFile = 'config/api-spec.json'): Promise<BuildResult> {
  const root = resolve(siteDir);
  const specPath = join(root, specFile);
  const { spec, missingFiles } = await loadSpecFile(specPath);
  const outputs = buildOutputs(spec);

  const files: { path: string; content: string }[] = [
    { path: join(root, 'search-index.json'), content: JSON.stringify(outputs.searchIndex) },
    { path: join(root, 'llms.txt'), content: outputs.llms },
    { path: join(root, 'llms-full.txt'), content: outputs.llmsFull },
    { path: join(root, 'sitemap.xml'), content: outputs.sitemap },
    { path: join(root, 'robots.txt'), content: outputs.robots },
  ];

  const written: { path: string; bytes: number }[] = [];
  for (const file of files) {
    await writeFile(file.path, file.content);
    written.push({ path: file.path, bytes: Buffer.byteLength(file.content) });
  }

  return { siteDir: root, specPath, spec, missingFiles, written };
}
