import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { assertCan } from '../lib/access.js';
import { handleError } from '../lib/error-handler.js';
import { badRequest } from '../lib/errors.js';
import { STORAGE_KEY_PATTERN } from '../lib/storage.js';
import {
  contentDisposition,
  deleteAttachment,
  fileTooLarge,
  getAttachment,
  listAttachments,
  saveAttachment,
  servesInline,
} from '../modules/attachments.js';
import { actorFor, loadSpaceSubject } from '../modules/context.js';
import type { RouteContext } from './context.js';

const keySchema = z.object({ key: z.string().regex(STORAGE_KEY_PATTERN) });

export const FILE_RESPONSE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; sandbox",
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cache-Control': 'private, max-age=300',
} as const;

export function attachmentRoutes(app: FastifyInstance, context: RouteContext) {
  const { db, store, config } = context;
  const maxBytes = config.attachments.maxBytes;

  app.get('/attachments', async (request) => {
    const user = await context.currentUser(request);
    const query = z.object({ spaceId: z.string().uuid() }).parse(request.query);
    const subject = await loadSpaceSubject(db, user.workspaceId, query.spaceId, user.id);
    assertCan(actorFor(user), 'page.read', subject);
    return { attachments: await listAttachments(db, user.workspaceId, query.spaceId) };
  });

  app.post(
    '/attachments',
    {
      bodyLimit: maxBytes + 1,
      onRequest: async (request) => {
        await context.currentUser(request);
      },
      errorHandler: (error, request, reply) =>
        handleError(error.code === 'FST_ERR_CTP_BODY_TOO_LARGE' ? fileTooLarge(maxBytes) : error, request, reply),
    },
    async (request, reply) => {
      const user = request.user ?? (await context.currentUser(request));
      const query = z
        .object({ spaceId: z.string().uuid(), pageId: z.string().uuid().optional(), name: z.string().min(1).max(300) })
        .parse(request.query);
      const subject = await loadSpaceSubject(db, user.workspaceId, query.spaceId, user.id);
      assertCan(actorFor(user), 'page.update', subject);
      const bytes = request.body;
      if (!Buffer.isBuffer(bytes)) throw badRequest('Envía el archivo como cuerpo binario.');
      const record = await saveAttachment(db, store, {
        workspaceId: user.workspaceId,
        spaceId: query.spaceId,
        pageId: query.pageId ?? null,
        fileName: query.name,
        bytes,
        creatorId: user.id,
        maxBytes,
      });
      return reply
        .status(201)
        .send({ attachment: { id: record.id, url: record.url, fileName: record.fileName, size: record.size, mime: record.mime } });
    },
  );

  app.get('/files/:key', async (request, reply) => {
    const user = await context.currentUser(request);
    const params = keySchema.parse(request.params);
    const record = await getAttachment(db, user.workspaceId, params.key);
    const subject = await loadSpaceSubject(db, user.workspaceId, record.spaceId, user.id);
    assertCan(actorFor(user), 'page.read', subject);
    const bytes = await store.get(record.storageKey);
    return reply
      .headers(FILE_RESPONSE_HEADERS)
      .header('Content-Type', record.mime)
      .header('Content-Disposition', contentDisposition(record.fileName, servesInline(record.mime)))
      .send(bytes);
  });

  app.delete('/attachments/:key', async (request) => {
    const user = await context.currentUser(request);
    const params = keySchema.parse(request.params);
    const record = await getAttachment(db, user.workspaceId, params.key);
    const subject = await loadSpaceSubject(db, user.workspaceId, record.spaceId, user.id);
    assertCan(actorFor(user), 'page.update', subject);
    await deleteAttachment(db, store, record.id, record.storageKey);
    return { ok: true };
  });
}
