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

export function handleError(error: FastifyError | Error, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof ApiError) {
    if (error instanceof RateLimitedError) reply.header('Retry-After', String(error.retryAfterSeconds));
    return reply.status(error.statusCode).send({ error: error.code, message: error.message });
  }
  if (error instanceof z.ZodError) {
    request.log.warn({ issues: error.issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code })) }, 'validation failed');
    return reply.status(400).send({ error: 'bad_request', message: 'Revisa los datos e inténtalo de nuevo.' });
  }
  const code = (error as FastifyError).code;
  const known = code ? FRAMEWORK_ERRORS[code] : undefined;
  if (known) {
    request.log.warn({ code }, 'request rejected by the framework');
    return reply.status(known.status).send({ error: known.code, message: known.message });
  }
  if ((error as FastifyError).statusCode === 400 && error instanceof SyntaxError) {
    return reply.status(400).send({ error: 'bad_request', message: 'Revisa los datos e inténtalo de nuevo.' });
  }
  request.log.error({ err: error }, 'unexpected error');
  return reply.status(500).send({ error: 'internal', message: 'Algo salió mal, inténtalo de nuevo en un momento.' });
}
