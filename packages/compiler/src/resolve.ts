import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';

const CODE_KEYS = ['code', 'content'] as const;
const FILE_KEYS = ['file', 'code_file'] as const;
const EXTENSION_LANGUAGE: Record<string, string> = {
  sh: 'bash',
  bash: 'bash',
  curl: 'bash',
  py: 'python',
  js: 'javascript',
  ts: 'typescript',
  json: 'json',
  http: 'http',
  html: 'markup',
  xml: 'markup',
  yml: 'yaml',
  yaml: 'yaml',
  txt: 'text',
};

type Node = Record<string, unknown>;

function isNode(value: unknown): value is Node {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeCode(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\n$/, '');
}

function targetKey(node: Node): 'code' | 'content' {
  if ('code' in node) return 'code';
  if ('content' in node) return 'content';
  if ('tech' in node) return 'code';
  return 'content';
}

export interface ResolveOptions {
  baseDir: string;
  readFile?: (path: string) => Promise<string>;
}

async function walk(node: unknown, options: Required<ResolveOptions>, missing: string[]): Promise<void> {
  if (Array.isArray(node)) {
    for (const item of node) await walk(item, options, missing);
    return;
  }
  if (!isNode(node)) return;

  for (const key of CODE_KEYS) {
    const value = node[key];
    if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
      node[key] = value.join('\n');
    }
  }

  const fileKey = FILE_KEYS.find((key) => typeof node[key] === 'string');
  if (fileKey) {
    const relativePath = node[fileKey] as string;
    const target = targetKey(node);
    try {
      node[target] = normalizeCode(await options.readFile(resolve(options.baseDir, relativePath)));
      if (!node.language) {
        const language = EXTENSION_LANGUAGE[extname(relativePath).slice(1).toLowerCase()];
        if (language) node.language = language;
      }
    } catch {
      missing.push(relativePath);
      if (typeof node[target] !== 'string') node[target] = '';
    }
  }

  for (const key of Object.keys(node)) {
    if (!(FILE_KEYS as readonly string[]).includes(key)) await walk(node[key], options, missing);
  }
}

export async function resolveCodeFiles<T>(spec: T, options: ResolveOptions): Promise<{ spec: T; missing: string[] }> {
  const missing: string[] = [];
  await walk(spec, { readFile: (path) => readFile(path, 'utf8'), ...options }, missing);
  return { spec, missing };
}
