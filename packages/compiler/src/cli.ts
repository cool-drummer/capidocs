#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { validateSpec } from '@capidocs/spec';
import { buildSite, loadSpecFile } from './build.js';
import { fromOpenApi } from './openapi.js';

const USAGE = `capidocs <command>

  build [siteDir] [--spec=config/api-spec.json]   Write search-index.json, llms.txt, llms-full.txt, sitemap.xml, robots.txt
  validate <specFile...>                          Validate one or more spec files against the schema
  import-openapi <openapi.json> [output.json]     Convert an OpenAPI 3.x document into a capidocs spec
`;

function parseFlags(args: string[]): { positional: string[]; flags: Record<string, string> } {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (const arg of args) {
    if (arg.startsWith('--')) {
      const [key, value] = arg.slice(2).split('=');
      flags[key!] = value ?? 'true';
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

async function commandBuild(args: string[]): Promise<number> {
  const { positional, flags } = parseFlags(args);
  const siteDir = positional[0] ?? 'apps/site';
  const result = await buildSite(siteDir, flags.spec ?? 'config/api-spec.json');
  for (const file of result.written) {
    process.stdout.write(`${relative(process.cwd(), file.path).padEnd(22)} ${file.bytes} bytes\n`);
  }
  if (result.missingFiles.length) {
    process.stderr.write(`Missing example files:\n${result.missingFiles.map((file) => `  ${file}`).join('\n')}\n`);
    return 1;
  }
  return 0;
}

async function commandValidate(args: string[]): Promise<number> {
  const { positional } = parseFlags(args);
  if (!positional.length) {
    process.stderr.write('Usage: capidocs validate <specFile...>\n');
    return 2;
  }
  let failed = 0;
  for (const file of positional) {
    const path = resolve(file);
    try {
      const result = validateSpec(JSON.parse(await readFile(path, 'utf8')));
      if (result.ok) {
        const { missingFiles } = await loadSpecFile(path);
        if (missingFiles.length) {
          failed += 1;
          process.stderr.write(`FAIL ${file}\n${missingFiles.map((entry) => `  missing example file: ${entry}`).join('\n')}\n`);
        } else {
          process.stdout.write(`OK   ${file}\n`);
        }
      } else {
        failed += 1;
        process.stderr.write(`FAIL ${file}\n${result.issues.map((issue) => `  ${issue.path}: ${issue.message}`).join('\n')}\n`);
      }
    } catch (error) {
      failed += 1;
      process.stderr.write(`FAIL ${file}\n  ${(error as Error).message}\n`);
    }
  }
  return failed ? 1 : 0;
}

async function commandImportOpenApi(args: string[]): Promise<number> {
  const { positional } = parseFlags(args);
  const input = positional[0];
  if (!input) {
    process.stderr.write('Usage: capidocs import-openapi <openapi.json> [output.json]\n');
    return 2;
  }
  const output = positional[1] ?? 'config/api-spec.json';
  const openapi = JSON.parse(await readFile(resolve(input), 'utf8')) as Record<string, unknown>;
  const spec = fromOpenApi(openapi);
  await writeFile(resolve(output), `${JSON.stringify(spec, null, 2)}\n`);
  process.stdout.write(`Wrote ${output} with ${Object.keys(spec.endpoints ?? {}).length} endpoints\n`);
  return 0;
}

const [command, ...args] = process.argv.slice(2);
const commands: Record<string, (args: string[]) => Promise<number>> = {
  build: commandBuild,
  validate: commandValidate,
  'import-openapi': commandImportOpenApi,
};

if (!command || !commands[command]) {
  process.stderr.write(USAGE);
  process.exit(command ? 2 : 0);
}

process.exitCode = await commands[command]!(args);
