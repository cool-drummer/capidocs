import type { FastifyLoggerOptions } from 'fastify';

export interface LogDestination {
  write(message: string): void;
}

const LONG_TOKEN = /[A-Za-z0-9_-]{40,}/g;
const URL_CREDENTIALS = /(\b[a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/gi;
const QUERY_PARAMS = /\bparams:.*$/gims;

export function sanitizeLogText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value.replace(QUERY_PARAMS, 'params: [redacted]').replace(URL_CREDENTIALS, '$1[redacted]@').replace(LONG_TOKEN, '[redacted]').slice(0, 2000);
}

export function pathOnly(url: string): string {
  const index = url.indexOf('?');
  return index === -1 ? url : url.slice(0, index);
}

export function loggerOptions(level: string, stream?: LogDestination): FastifyLoggerOptions & { stream?: LogDestination; redact: { paths: string[]; censor: string } } {
  return {
    level,
    ...(stream ? { stream } : {}),
    redact: {
      paths: [
        'req.headers.cookie',
        'req.headers.authorization',
        'req.headers["x-csrf-token"]',
        'res.headers["set-cookie"]',
        '*.password',
        '*.currentPassword',
        '*.newPassword',
        '*.token',
        '*.csrfToken',
        '*.setupToken',
      ],
      censor: '[redacted]',
    },
    serializers: {
      req: (request) => ({
        method: request.method,
        url: pathOnly(request.url ?? ''),
        hostname: request.hostname,
        remoteAddress: request.ip,
      }),
      res: (reply) => ({ statusCode: reply.statusCode }),
      err: (error) => ({
        type: error.name,
        code: typeof error.code === 'string' ? error.code : undefined,
        message: sanitizeLogText(error.message) ?? '',
        stack: sanitizeLogText(error.stack?.split('\n').slice(0, 8).join('\n')) ?? '',
      }),
    },
  };
}
