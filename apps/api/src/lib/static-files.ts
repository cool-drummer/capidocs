import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

export interface StaticFile {
  bytes: Buffer;
  contentType: string;
}

export function isSafeRelativePath(path: string): boolean {
  if (!path || path.length > 300) return false;
  if (path.includes('\0') || path.includes('\\')) return false;
  return path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..' && !segment.startsWith('.'));
}

export async function readStaticFile(root: string, relativePath: string, allowedPrefixes?: string[]): Promise<StaticFile | null> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(relativePath);
  } catch {
    return null;
  }
  if (!isSafeRelativePath(decoded)) return null;
  if (allowedPrefixes && !allowedPrefixes.some((prefix) => decoded === prefix || decoded.startsWith(`${prefix}/`))) return null;

  const contentType = CONTENT_TYPES[extname(decoded).toLowerCase()];
  if (!contentType) return null;

  const base = resolve(root);
  const target = resolve(base, decoded);
  if (!target.startsWith(base + sep)) return null;
  try {
    const info = await stat(target);
    if (!info.isFile()) return null;
    return { bytes: await readFile(target), contentType };
  } catch {
    return null;
  }
}
