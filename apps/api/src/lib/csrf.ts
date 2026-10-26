import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { ApiError } from './errors.js';

export const CSRF_HEADER = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const SAME_SITE_FETCH = new Set(['same-origin', 'none']);

export function csrfTokenFor(sessionToken: string): string {
  return createHmac('sha256', sessionToken).update('capidocs-csrf').digest('base64url');
}

function sameToken(expected: string, presented: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(presented);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const csrfRejected = () =>
  new ApiError(403, 'csrf_rejected', 'Tu sesión no es válida para esta acción. Recarga la página e inténtalo de nuevo.');

export interface CsrfGuardOptions {
  allowedOrigins: string[];
  sessionToken: (request: FastifyRequest) => string | null;
}

export function createCsrfGuard(options: CsrfGuardOptions) {
  const allowed = new Set(options.allowedOrigins.filter(Boolean));

  return async function csrfGuard(request: FastifyRequest): Promise<void> {
    if (SAFE_METHODS.has(request.method)) return;

    const fetchSite = request.headers['sec-fetch-site'];
    if (typeof fetchSite === 'string' && !SAME_SITE_FETCH.has(fetchSite)) throw csrfRejected();

    const origin = request.headers.origin;
    if (typeof origin === 'string' && !allowed.has(origin)) throw csrfRejected();

    if (request.routeOptions.config?.publicEntry) return;

    const token = options.sessionToken(request);
    if (!token) return;
    const presented = request.headers[CSRF_HEADER];
    if (typeof presented !== 'string' || !sameToken(csrfTokenFor(token), presented)) throw csrfRejected();
  };
}
