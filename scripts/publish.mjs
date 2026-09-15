#!/usr/bin/env node
import { cpSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildSite } from '../packages/compiler/dist/index.js';

const [, , siteArg = 'apps/site', outArg = '.tmp/dist'] = process.argv;
const siteDir = resolve(siteArg);
const outDir = resolve(outArg);

const PUBLISHABLE = new Set([
  'index.html',
  'assets',
  'config',
  'logos',
  'search-index.json',
  'llms.txt',
  'llms-full.txt',
  'sitemap.xml',
  'robots.txt',
]);

const result = await buildSite(siteDir);
if (result.missingFiles.length) {
  process.stderr.write(`Missing example files:\n${result.missingFiles.map((file) => `  ${file}`).join('\n')}\n`);
  process.exit(1);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

let files = 0;
let bytes = 0;
const countInto = (path) => {
  const stats = statSync(path);
  if (stats.isDirectory()) {
    for (const entry of readdirSync(path)) countInto(join(path, entry));
    return;
  }
  files += 1;
  bytes += stats.size;
};

for (const entry of readdirSync(siteDir)) {
  if (!PUBLISHABLE.has(entry)) continue;
  cpSync(join(siteDir, entry), join(outDir, entry), { recursive: true });
  countInto(join(outDir, entry));
}

process.stdout.write(`published tree: ${outDir}\n  ${files} files, ${(bytes / 1024).toFixed(0)} KB\n`);
process.stdout.write(`  routes: ${result.spec.navigation?.length ?? 0} nav, ${Object.keys(result.spec.pages).length} pages, ${Object.keys(result.spec.endpoints ?? {}).length} endpoints\n`);
