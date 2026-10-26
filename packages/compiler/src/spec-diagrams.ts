import { readFile, realpath } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { importDiagramFile } from '@capidocs/site/diagram/import';
import { findDiagram, parseDiagramSetJson, validateDiagramSet, type DiagramSet } from '@capidocs/site/diagram/model';

export interface DiagramBlockIssue {
  path: string;
  message: string;
}

export interface SpecDiagramOptions {
  baseDir: string;
  readFile?: (path: string) => Promise<string>;
  realpath?: (path: string) => Promise<string>;
}

type Block = Record<string, unknown>;

const MAX_SPEC_DEPTH = 64;

function within(base: string, file: string): boolean {
  const inside = relative(base, file);
  return inside !== '' && inside !== '..' && !inside.startsWith(`..${sep}`) && !isAbsolute(inside);
}

function isRecord(value: unknown): value is Block {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function collectBlocks(value: unknown, path: string, found: { path: string; block: Block }[], depth: number): void {
  if (depth > MAX_SPEC_DEPTH) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectBlocks(item, path ? `${path}.${index}` : String(index), found, depth + 1));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (key === 'diagram' && isRecord(child) && ('set' in child || 'src' in child || 'diagram' in child)) {
      found.push({ path: childPath, block: child });
      continue;
    }
    collectBlocks(child, childPath, found, depth + 1);
  }
}

async function loadSource(
  src: string,
  path: string,
  options: Required<SpecDiagramOptions>,
  issues: DiagramBlockIssue[],
): Promise<DiagramSet | null> {
  const base = resolve(options.baseDir);
  const file = resolve(base, src);
  const outside = { path: `${path}.src`, message: `"${src}" points outside the site directory` };
  if (isAbsolute(src) || !within(base, file)) {
    issues.push(outside);
    return null;
  }
  let text: string;
  try {
    const [realBase, realFile] = await Promise.all([options.realpath(base), options.realpath(file)]);
    if (!within(realBase, realFile)) {
      issues.push(outside);
      return null;
    }
    text = await options.readFile(realFile);
  } catch {
    issues.push({ path: `${path}.src`, message: `File not found: ${src}` });
    return null;
  }
  if (extname(src).toLowerCase() === '.json') {
    const result = parseDiagramSetJson(text);
    if (!result.ok) {
      result.issues.forEach((issue) => issues.push({ path: `${path}.src(${src}).${issue.path}`, message: issue.message }));
      return null;
    }
    return result.set;
  }
  const imported = await importDiagramFile({ name: src, text });
  if (!imported.ok) {
    issues.push({ path: `${path}.src`, message: `${src}: ${imported.error.code} (${imported.error.detail})` });
    return null;
  }
  return imported.set;
}

export async function validateSpecDiagrams(spec: unknown, options: SpecDiagramOptions): Promise<DiagramBlockIssue[]> {
  const settings: Required<SpecDiagramOptions> = { readFile: (path) => readFile(path, 'utf8'), realpath: (path) => realpath(path), ...options };
  const blocks: { path: string; block: Block }[] = [];
  collectBlocks(spec, '', blocks, 0);
  const issues: DiagramBlockIssue[] = [];
  for (const { path, block } of blocks) {
    const { set, src, diagram } = block;
    let resolved: DiagramSet | null = null;
    if (set !== undefined && src !== undefined) {
      issues.push({ path, message: 'Use either "set" or "src", not both' });
      continue;
    }
    if (set !== undefined) {
      const result = validateDiagramSet(set);
      if (result.ok) resolved = result.set;
      else result.issues.forEach((issue) => issues.push({ path: `${path}.set.${issue.path}`, message: issue.message }));
    } else if (typeof src === 'string' && src.trim()) {
      if (/^https?:\/\//i.test(src)) continue;
      resolved = await loadSource(src, path, settings, issues);
    } else {
      issues.push({ path, message: 'A diagram block needs "set" or "src"' });
      continue;
    }
    if (resolved && diagram !== undefined && (typeof diagram !== 'string' || !findDiagram(resolved, diagram))) {
      issues.push({ path: `${path}.diagram`, message: `Unknown diagram "${String(diagram)}"` });
    }
  }
  return issues;
}
