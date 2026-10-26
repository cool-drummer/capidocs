import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { and, desc, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { attachments } from '../db/schema.js';
import { badRequest, notFound } from '../lib/errors.js';

const ALLOWED = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/gif', 'gif'],
  ['image/webp', 'webp'],
  ['image/svg+xml', 'svg'],
  ['application/pdf', 'pdf'],
]);

const MAGIC: { mime: string; test: (bytes: Buffer) => boolean }[] = [
  { mime: 'image/png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/gif', test: (b) => b.subarray(0, 6).toString('ascii').startsWith('GIF8') },
  { mime: 'image/webp', test: (b) => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP' },
  { mime: 'application/pdf', test: (b) => b.subarray(0, 5).toString('ascii') === '%PDF-' },
  { mime: 'image/svg+xml', test: (b) => /<svg[\s>]/i.test(b.subarray(0, 1024).toString('utf8')) },
];

export const MAX_BYTES = 8 * 1024 * 1024;

export function detectMime(bytes: Buffer): string | null {
  return MAGIC.find((entry) => entry.test(bytes))?.mime ?? null;
}

export function storageKeyFor(mime: string): string {
  const extension = ALLOWED.get(mime);
  if (!extension) throw badRequest('Ese tipo de archivo no se admite.');
  return `${randomBytes(16).toString('hex')}.${extension}`;
}

export interface AttachmentStore {
  put(key: string, bytes: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
  url(key: string): string;
}

export function createLocalStore(root: string, publicPath = '/files'): AttachmentStore {
  const base = resolve(root);
  mkdirSync(base, { recursive: true });
  const pathFor = (key: string) => {
    if (!/^[0-9a-f]{32}\.[a-z]{2,4}$/.test(key)) throw badRequest('Archivo inválido.');
    return join(base, key);
  };
  return {
    async put(key, bytes) {
      writeFileSync(pathFor(key), bytes);
    },
    async get(key) {
      try {
        return readFileSync(pathFor(key));
      } catch {
        throw notFound();
      }
    },
    async remove(key) {
      rmSync(pathFor(key), { force: true });
    },
    url(key) {
      return `${publicPath}/${key}`;
    },
  };
}

export async function saveAttachment(
  db: Database,
  store: AttachmentStore,
  input: { workspaceId: string; spaceId: string | null; pageId: string | null; fileName: string; bytes: Buffer; creatorId: string },
) {
  if (!input.bytes.length) throw badRequest('El archivo llegó vacío.');
  if (input.bytes.length > MAX_BYTES) throw badRequest('El archivo supera el límite de 8 MB.');

  const mime = detectMime(input.bytes);
  if (!mime) throw badRequest('Ese tipo de archivo no se admite.');

  const key = storageKeyFor(mime);
  await store.put(key, input.bytes);

  const [record] = await db
    .insert(attachments)
    .values({
      workspaceId: input.workspaceId,
      spaceId: input.spaceId,
      pageId: input.pageId,
      storageKey: key,
      fileName: input.fileName.slice(0, 300),
      mime,
      size: input.bytes.length,
      creatorId: input.creatorId,
    })
    .returning();

  return { ...record!, url: store.url(key) };
}

export async function listAttachments(db: Database, workspaceId: string, spaceId: string | null, store: AttachmentStore) {
  const rows = await db
    .select()
    .from(attachments)
    .where(spaceId ? and(eq(attachments.workspaceId, workspaceId), eq(attachments.spaceId, spaceId)) : eq(attachments.workspaceId, workspaceId))
    .orderBy(desc(attachments.createdAt))
    .limit(200);
  return rows.map((row) => ({ ...row, url: store.url(row.storageKey) }));
}

export async function getAttachment(db: Database, workspaceId: string, key: string) {
  const rows = await db
    .select()
    .from(attachments)
    .where(and(eq(attachments.workspaceId, workspaceId), eq(attachments.storageKey, key)))
    .limit(1);
  const record = rows[0];
  if (!record) throw notFound();
  return record;
}

export async function deleteAttachment(db: Database, store: AttachmentStore, workspaceId: string, key: string) {
  const record = await getAttachment(db, workspaceId, key);
  await store.remove(record.storageKey);
  await db.delete(attachments).where(eq(attachments.id, record.id));
}

export function checksum(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 16);
}
