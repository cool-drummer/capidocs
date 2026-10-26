import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { notFound } from '../lib/errors.js';
import { studioCsp } from '../lib/security-headers.js';
import { readStaticFile } from '../lib/static-files.js';

export function studioRoutes(app: FastifyInstance, options: { studioDir: string; secure: boolean }): boolean {
  if (!existsSync(join(options.studioDir, 'index.html'))) return false;
  const csp = studioCsp(options.secure);

  const sendIndex = async (_request: unknown, reply: FastifyReply) => {
    const file = await readStaticFile(options.studioDir, 'index.html');
    if (!file) throw notFound();
    return reply
      .headers({ 'Content-Type': file.contentType, 'Content-Security-Policy': csp, 'Cache-Control': 'no-cache' })
      .send(file.bytes);
  };

  app.get('/', sendIndex);
  app.get('/index.html', sendIndex);

  app.get('/assets/*', async (request, reply) => {
    const path = `assets/${(request.params as { '*': string })['*']}`;
    const file = await readStaticFile(options.studioDir, path, ['assets']);
    if (!file) throw notFound();
    return reply
      .headers({ 'Content-Type': file.contentType, 'Content-Security-Policy': csp, 'Cache-Control': 'public, max-age=31536000, immutable' })
      .send(file.bytes);
  });

  return true;
}
