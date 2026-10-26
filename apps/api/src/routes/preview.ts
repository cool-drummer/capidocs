import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { attachments } from '../db/schema.js';
import { notFound } from '../lib/errors.js';
import { previewFrame, previewFrameCsp, type UrlSigner } from '../lib/preview.js';
import { readStaticFile } from '../lib/static-files.js';
import { STORAGE_KEY_PATTERN } from '../lib/storage.js';
import { contentDisposition, servesInline } from '../modules/attachments.js';
import type { RouteContext } from './context.js';

const RUNTIME_PREFIXES = ['assets', 'logos'];

export const RUNTIME_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Cross-Origin-Resource-Policy': 'cross-origin',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  'Cache-Control': 'public, max-age=3600',
} as const;

export function previewRoutes(app: FastifyInstance, context: RouteContext, signer: UrlSigner) {
  const { db, store, config } = context;

  app.get('/preview/frame', async (_request, reply) => {
    const { html, nonce } = previewFrame();
    return reply
      .headers({
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': previewFrameCsp(config.publicOrigin, nonce),
        'X-Frame-Options': 'SAMEORIGIN',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      })
      .send(html);
  });

  app.get('/preview/files/:key', async (request, reply) => {
    const params = z.object({ key: z.string().regex(STORAGE_KEY_PATTERN) }).parse(request.params);
    const query = z.object({ expires: z.coerce.number().int(), signature: z.string().max(100) }).parse(request.query);
    if (!signer.verify(params.key, query.expires, query.signature)) throw notFound();

    const rows = await db.select().from(attachments).where(eq(attachments.storageKey, params.key)).limit(1);
    const record = rows[0];
    if (!record) throw notFound();
    const bytes = await store.get(record.storageKey);
    return reply
      .headers({
        'Content-Type': record.mime,
        'Content-Disposition': contentDisposition(record.fileName, servesInline(record.mime)),
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'Referrer-Policy': 'no-referrer',
        'Cache-Control': 'private, max-age=300',
      })
      .send(bytes);
  });
}

export function runtimeRoutes(app: FastifyInstance, context: RouteContext) {
  app.get('/site/*', async (request, reply) => {
    const path = (request.params as { '*': string })['*'];
    const file = await readStaticFile(context.runtimeDir, path, RUNTIME_PREFIXES);
    if (!file) throw notFound();
    return reply.headers(RUNTIME_HEADERS).header('Content-Type', file.contentType).send(file.bytes);
  });
}
