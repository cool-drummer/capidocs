import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ApiError } from './errors.js';
import { RateLimitedError } from './rate-limit.js';

const FRAMEWORK_ERRORS: Record<string, { status: number; code: string; message: string }> = {
  FST_ERR_CTP_BODY_TOO_LARGE: { status: 413, code: 'payload_too_large', message: 'El contenido que enviaste es demasiado grande.' },
  FST_ERR_CTP_INVALID_MEDIA_TYPE: { status: 415, code: 'unsupported_media_type', message: 'Revisa los datos e inténtalo de nuevo.' },
  FST_ERR_CTP_EMPTY_JSON_BODY: { status: 400, code: 'bad_request', message: 'Revisa los datos e inténtalo de nuevo.' },
  FST_ERR_CTP_INVALID_CONTENT_LENGTH: { status: 400, code: 'bad_request', message: 'Revisa los datos e inténtalo de nuevo.' },
};

function postgresCode(error: unknown): string | null {
  for (let current = error, depth = 0; current && depth < 4; depth += 1) {
    const candidate = current as { code?: unknown; cause?: unknown; severity?: unknown };
    if (typeof candidate.code === 'string' && /^[0-9A-Z]{5}$/.test(candidate.code) && candidate.severity) return candidate.code;
    current = candidate.cause;
  }
  return null;
}

export function handleError(error: FastifyError | Error, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof ApiError) {
    if (error instanceof RateLimitedError) reply.header('Retry-After', String(error.retryAfterSeconds));
    return reply.status(error.statusCode).send({ error: error.code, message: error.message });
  }
  if (error instanceof z.ZodError) {
    request.log.warn({ issues: error.issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code })) }, 'validation failed');
    return reply.status(400).send({ error: 'bad_request', message: 'Revisa los datos e inténtalo de nuevo.' });
  }
  const databaseCode = postgresCode(error);
  if (databaseCode === '23505') {
    request.log.warn({ code: databaseCode }, 'unique constraint violated');
    return reply.status(409).send({ error: 'conflict', message: 'Ese valor ya está en uso. Elige otro.' });
  }
  if (databaseCode === '23503' || databaseCode === '22001' || databaseCode === '22P02') {
    request.log.warn({ code: databaseCode }, 'database rejected the input');
    return reply.status(400).send({ error: 'bad_request', message: 'Revisa los datos e inténtalo de nuevo.' });
  }
  const code = (error as FastifyError).code;
  const known = code ? FRAMEWORK_ERRORS[code] : undefined;
  if (known) {
    request.log.warn({ code }, 'request rejected by the framework');
    return reply.status(known.status).send({ error: known.code, message: known.message });
  }
  const status = (error as FastifyError).statusCode;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    request.log.warn({ code: code ?? null, status }, 'request rejected');
    return reply.status(status).send({ error: 'bad_request', message: 'Revisa los datos e inténtalo de nuevo.' });
  }
  request.log.error({ err: error }, 'unexpected error');
  return reply.status(500).send({ error: 'internal', message: 'Algo salió mal, inténtalo de nuevo en un momento.' });
}
