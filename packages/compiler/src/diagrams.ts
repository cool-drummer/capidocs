import { readFile, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importDiagramFile, type ImportResult } from '@capidocs/site/diagram/import';
import { buildStandaloneHtml } from '@capidocs/site/diagram/export/standalone';
import { mergeDiagramSets, serializeDiagramSet, validateDiagramSet, type DiagramSet } from '@capidocs/site/diagram/model';

const DEFAULT_ENTRY = 'assets/js/diagram/standalone-entry.js';

interface ParsedArgs {
  positional: string[];
  flags: Record<string, string>;
}

const VALUE_FLAGS = new Set(['o', 'out', 'title', 'entry', 'layout', 'lang', 'site']);

export function parseArgs(args: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    const match = /^--?([A-Za-z][\w-]*)(?:=(.*))?$/.exec(arg);
    if (!match) {
      positional.push(arg);
      continue;
    }
    const key = match[1]!;
    if (match[2] !== undefined) flags[key] = match[2];
    else if (VALUE_FLAGS.has(key) && index + 1 < args.length) flags[key] = args[++index]!;
    else flags[key] = 'true';
  }
  if (flags.o !== undefined && flags.out === undefined) flags.out = flags.o;
  return { positional, flags };
}

function importOptions(flags: Record<string, string>): { layout: 'keep' | 'auto'; lang?: string } {
  return { layout: flags.layout === 'auto' ? 'auto' : 'keep', ...(flags.lang ? { lang: flags.lang } : {}) };
}

async function importPath(file: string, flags: Record<string, string>): Promise<ImportResult> {
  const text = await readFile(resolve(file), 'utf8');
  return importDiagramFile({ name: basename(file), text }, importOptions(flags));
}

function printFailure(file: string, result: Extract<ImportResult, { ok: false }>): void {
  const lines = [`FAIL ${file}`, `  ${result.error.code}: ${result.error.detail}`];
  for (const issue of result.issues ?? []) lines.push(`  ${issue.path}: ${issue.message}`);
  process.stderr.write(`${lines.join('\n')}\n`);
}

function printWarnings(result: Extract<ImportResult, { ok: true }>): void {
  for (const warning of result.warnings) process.stdout.write(`  warning ${warning.code}: ${warning.detail}\n`);
}

async function diagramsValidate(args: string[]): Promise<number> {
  const { positional, flags } = parseArgs(args);
  if (!positional.length) {
    process.stderr.write('Usage: capidocs diagrams validate <file...>\n');
    return 2;
  }
  let failed = 0;
  for (const file of positional) {
    try {
      const result = await importPath(file, flags);
      if (!result.ok) {
        failed += 1;
        printFailure(file, result);
        continue;
      }
      process.stdout.write(`OK   ${file} (${result.set.diagrams.length} diagrams, ${result.format})\n`);
      printWarnings(result);
    } catch (error) {
      failed += 1;
      process.stderr.write(`FAIL ${file}\n  ${(error as Error).message}\n`);
    }
  }
  return failed ? 1 : 0;
}

async function diagramsImport(args: string[]): Promise<number> {
  const { positional, flags } = parseArgs(args);
  if (!positional.length) {
    process.stderr.write('Usage: capidocs diagrams import <input...> -o set.json [--title=...] [--layout=keep|auto]\n');
    return 2;
  }
  let merged: DiagramSet | null = null;
  for (const file of positional) {
    let result: ImportResult;
    try {
      result = await importPath(file, flags);
    } catch (error) {
      process.stderr.write(`FAIL ${file}\n  ${(error as Error).message}\n`);
      return 1;
    }
    if (!result.ok) {
      printFailure(file, result);
      return 1;
    }
    process.stderr.write(`read ${file} (${result.set.diagrams.length} diagrams)\n`);
    for (const warning of result.warnings) process.stderr.write(`  warning ${warning.code}: ${warning.detail}\n`);
    if (!merged) {
      merged = result.set;
      continue;
    }
    const next = mergeDiagramSets(merged, result.set);
    if (!next.ok) {
      process.stderr.write(`FAIL ${file}\n${next.issues.map((issue) => `  ${issue.path}: ${issue.message}`).join('\n')}\n`);
      return 1;
    }
    merged = next.set;
  }
  const serialized = serializeDiagramSet(merged!);
  if (flags.title) serialized.title = flags.title;
  const final = validateDiagramSet(serialized);
  if (!final.ok) {
    process.stderr.write(`FAIL\n${final.issues.map((issue) => `  ${issue.path}: ${issue.message}`).join('\n')}\n`);
    return 1;
  }
  const output = `${JSON.stringify(serializeDiagramSet(final.set), null, 2)}\n`;
  if (flags.out) {
    await writeFile(resolve(flags.out), output);
    process.stdout.write(`Wrote ${flags.out} with ${final.set.diagrams.length} diagrams\n`);
  } else {
    process.stdout.write(output);
  }
  return 0;
}

export function siteRoot(): string {
  const standalone = import.meta.resolve('@capidocs/site/diagram/export/standalone');
  return fileURLToPath(new URL('../../../../', standalone));
}

async function diagramsBundle(args: string[]): Promise<number> {
  const { positional, flags } = parseArgs(args);
  const input = positional[0];
  if (!input || positional.length > 1) {
    process.stderr.write('Usage: capidocs diagrams bundle <set.json> -o output.html [--title=...] [--entry=...]\n');
    return 2;
  }
  const result = await importPath(input, flags);
  if (!result.ok) {
    printFailure(input, result);
    return 1;
  }
  const root = flags.site ? resolve(flags.site) : siteRoot();
  const entry = flags.entry ?? DEFAULT_ENTRY;
  try {
    const html = await buildStandaloneHtml({
      set: result.set,
      entry,
      ...(flags.title ? { title: flags.title } : {}),
      ...(flags.lang ? { lang: flags.lang } : {}),
      readText: (path) => readFile(join(root, path), 'utf8'),
      readBinary: async (path) => new Uint8Array(await readFile(join(root, path))),
    });
    const output = flags.out ?? `${basename(input, extname(input))}.html`;
    await writeFile(resolve(output), html);
    process.stdout.write(`Wrote ${output} (${Buffer.byteLength(html)} bytes)\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`FAIL ${input}\n  ${(error as Error).message}\n`);
    return 1;
  }
}

export const DIAGRAMS_USAGE = `capidocs diagrams <command>

  validate <file...>                               Validate diagram files (JSON, Mermaid, Markdown, draw.io, HTML)
  import <input...> -o set.json [--title=...]      Import and merge files into one diagram set [--layout=keep|auto]
  bundle <set.json> -o output.html [--title=...]   Build a self-contained HTML viewer [--entry=module] [--site=dir]
`;

export async function commandDiagrams(args: string[]): Promise<number> {
  const [sub, ...rest] = args;
  switch (sub) {
    case 'validate':
      return diagramsValidate(rest);
    case 'import':
      return diagramsImport(rest);
    case 'bundle':
      return diagramsBundle(rest);
    default:
      process.stderr.write(DIAGRAMS_USAGE);
      return sub ? 2 : 0;
  }
}
