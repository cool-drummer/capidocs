import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { attachments } from '../db/schema.js';
import { notFound } from '../lib/errors.js';
import { previewExplorer, previewExplorerCsp, previewFrame, previewFrameCsp, type UrlSigner } from '../lib/preview.js';
import { readStaticFile, runtimeVersion } from '../lib/static-files.js';
import { STORAGE_KEY_PATTERN } from '../lib/storage.js';
import { contentDisposition, servesInline } from '../modules/attachments.js';
import type { RouteContext } from './context.js';

const RUNTIME_PREFIXES = ['assets', 'logos'];

const VERSIONED_PATH = /^v([0-9a-f]{12})\/(.+)$/;

export const RUNTIME_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Cross-Origin-Resource-Policy': 'cross-origin',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
} as const;

export async function runtimeBase(runtimeDir: string): Promise<string> {
  return `/site/v${await runtimeVersion(runtimeDir, RUNTIME_PREFIXES)}`;
}

export function previewRoutes(app: FastifyInstance, context: RouteContext, signer: UrlSigner) {
  const { db, store, config } = context;

  app.get('/preview/frame', async (_request, reply) => {
    const { html, nonce } = previewFrame(await runtimeBase(context.runtimeDir));
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

  app.get('/preview/explorer', async (_request, reply) => {
    const { html, nonce } = previewExplorer(await runtimeBase(context.runtimeDir));
    return reply
      .headers({
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': previewExplorerCsp(config.publicOrigin, nonce),
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
    const requested = (request.params as { '*': string })['*'];
    const versioned = VERSIONED_PATH.exec(requested);
    const file = await readStaticFile(context.runtimeDir, versioned ? versioned[2]! : requested, RUNTIME_PREFIXES);
    if (!file) throw notFound();
    const current = versioned !== null && versioned[1] === (await runtimeVersion(context.runtimeDir, RUNTIME_PREFIXES));
    return reply
      .headers(RUNTIME_HEADERS)
      .header('Content-Type', file.contentType)
      .header('Cache-Control', current ? 'public, max-age=31536000, immutable' : 'no-cache')
      .send(file.bytes);
  });
}
