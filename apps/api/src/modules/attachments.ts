import { randomBytes } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { attachments, pages } from '../db/schema.js';
import { ApiError, badRequest, notFound } from '../lib/errors.js';
import type { AttachmentStore } from '../lib/storage.js';

export const FILES_PATH = '/api/files/';

const TYPES = {
  'image/png': { extension: 'png', inline: true },
  'image/jpeg': { extension: 'jpg', inline: true },
  'image/gif': { extension: 'gif', inline: true },
  'image/webp': { extension: 'webp', inline: true },
  'application/pdf': { extension: 'pdf', inline: false },
} as const;

export type AttachmentMime = keyof typeof TYPES;

const MAGIC: { mime: AttachmentMime; test: (bytes: Buffer) => boolean }[] = [
  { mime: 'image/png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/gif', test: (b) => ['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString('latin1')) },
  { mime: 'image/webp', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
  { mime: 'application/pdf', test: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
];

export const unsupportedType = () => new ApiError(400, 'unsupported_file', 'Ese tipo de archivo no se admite. Sube una imagen PNG, JPG, GIF o WEBP, o un PDF.');
export const fileTooLarge = (maxBytes: number) =>
  new ApiError(413, 'file_too_large', `El archivo supera el límite de ${Math.floor(maxBytes / (1024 * 1024))} MB.`);

export function detectMime(bytes: Buffer): AttachmentMime | null {
  return MAGIC.find((entry) => entry.test(bytes))?.mime ?? null;
}

export function storageKeyFor(mime: AttachmentMime): string {
  return `${randomBytes(16).toString('hex')}.${TYPES[mime].extension}`;
}

export function servesInline(mime: string): boolean {
  return mime in TYPES && TYPES[mime as AttachmentMime].inline;
}

export function sanitizeFileName(raw: string, mime: AttachmentMime): string {
  const base = raw.normalize('NFC').split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .replace(/[\p{Cc}\p{Cf}"<>|:*?;]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '');
  const stem = cleaned.replace(/\.[^.]*$/, '').slice(0, 100).trim() || 'archivo';
  return `${stem}.${TYPES[mime].extension}`;
}

export function contentDisposition(fileName: string, inline: boolean): string {
  const ascii = fileName.normalize('NFD').replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '') || 'archivo';
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export function fileUrl(key: string): string {
  return `${FILES_PATH}${key}`;
}

export async function saveAttachment(
  db: Database,
  store: AttachmentStore,
  input: {
    workspaceId: string;
    spaceId: string;
    pageId: string | null;
    fileName: string;
    bytes: Buffer;
    creatorId: string;
    maxBytes: number;
  },
) {
  if (!input.bytes.length) throw badRequest('El archivo llegó vacío.');
  if (input.bytes.length > input.maxBytes) throw fileTooLarge(input.maxBytes);

  const mime = detectMime(input.bytes);
  if (!mime) throw unsupportedType();

  if (input.pageId) {
    const page = await db
      .select({ id: pages.id })
      .from(pages)
      .where(and(eq(pages.id, input.pageId), eq(pages.spaceId, input.spaceId), isNull(pages.deletedAt)))
      .limit(1);
    if (!page.length) throw badRequest('La página no pertenece a este espacio.');
  }

  const key = storageKeyFor(mime);
  await store.put(key, input.bytes, mime);

  const [record] = await db
    .insert(attachments)
    .values({
      workspaceId: input.workspaceId,
      spaceId: input.spaceId,
      pageId: input.pageId,
      storageKey: key,
      fileName: sanitizeFileName(input.fileName, mime),
      mime,
      size: input.bytes.length,
      creatorId: input.creatorId,
    })
    .returning();

  return { ...record!, url: fileUrl(key) };
}

export async function listAttachments(db: Database, workspaceId: string, spaceId: string) {
  const rows = await db
    .select()
    .from(attachments)
    .where(and(eq(attachments.workspaceId, workspaceId), eq(attachments.spaceId, spaceId)))
    .orderBy(desc(attachments.createdAt))
    .limit(200);
  return rows.map((row) => ({
    id: row.id,
    fileName: row.fileName,
    mime: row.mime,
    size: row.size,
    createdAt: row.createdAt,
    url: fileUrl(row.storageKey),
  }));
}

export async function getAttachment(db: Database, workspaceId: string, key: string) {
  const rows = await db
    .select()
    .from(attachments)
    .where(and(eq(attachments.workspaceId, workspaceId), eq(attachments.storageKey, key)))
    .limit(1);
  const record = rows[0];
  if (!record || !record.spaceId) throw notFound();
  return { ...record, spaceId: record.spaceId };
}

export async function deleteAttachment(db: Database, store: AttachmentStore, id: string, key: string) {
  await db.delete(attachments).where(eq(attachments.id, id));
  await store.remove(key);
}
