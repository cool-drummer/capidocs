import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { assertCan } from '../lib/access.js';
import { badRequest } from '../lib/errors.js';
import { deleteAttachment, getAttachment, listAttachments, saveAttachment } from '../modules/attachments.js';
import { actorFor, loadSpaceSubject } from '../modules/context.js';
import type { RouteContext } from './context.js';

export function attachmentRoutes(app: FastifyInstance, context: RouteContext) {
  const { db, store } = context;

  app.get('/attachments', async (request) => {
    const user = await context.currentUser(request);
    const query = z.object({ spaceId: z.string().uuid().optional() }).parse(request.query);
    if (query.spaceId) {
      const subject = await loadSpaceSubject(db, user.workspaceId, query.spaceId, user.id);
      assertCan(actorFor(user), 'page.read', subject);
    }
    return { attachments: await listAttachments(db, user.workspaceId, query.spaceId ?? null, store) };
  });

  app.post('/attachments', async (request, reply) => {
    const user = await context.currentUser(request);
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
    });
    return reply.status(201).send({ attachment: { id: record.id, url: record.url, fileName: record.fileName, size: record.size, mime: record.mime } });
  });

  app.get('/files/:key', async (request, reply) => {
    const user = await context.currentUser(request);
    const params = z.object({ key: z.string().min(5) }).parse(request.params);
    const record = await getAttachment(db, user.workspaceId, params.key);
    const bytes = await store.get(record.storageKey);
    return reply.header('Content-Type', record.mime).header('Cache-Control', 'private, max-age=300').send(bytes);
  });

  app.delete('/attachments/:key', async (request) => {
    const user = await context.currentUser(request);
    const params = z.object({ key: z.string().min(5) }).parse(request.params);
    const record = await getAttachment(db, user.workspaceId, params.key);
    if (record.spaceId) {
      const subject = await loadSpaceSubject(db, user.workspaceId, record.spaceId, user.id);
      assertCan(actorFor(user), 'page.update', subject);
    }
    await deleteAttachment(db, store, user.workspaceId, params.key);
    return { ok: true };
  });
}
