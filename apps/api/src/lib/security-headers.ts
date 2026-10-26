import type { FastifyReply, FastifyRequest } from 'fastify';

export const PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()';
export const API_CSP = "default-src 'none'; frame-ancestors 'none'";

export function studioCsp(secure: boolean): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: blob: https:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
    "worker-src 'none'",
    "manifest-src 'self'",
    ...(secure ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

export function securityHeaders(options: { secure: boolean; apiPrefix: string }) {
  return async function applySecurityHeaders(request: FastifyRequest, reply: FastifyReply, payload: unknown) {
    const set = (name: string, value: string) => {
      if (!reply.hasHeader(name)) reply.header(name, value);
    };
    set('X-Content-Type-Options', 'nosniff');
    set('Referrer-Policy', 'no-referrer');
    set('X-Frame-Options', 'DENY');
    set('Cross-Origin-Opener-Policy', 'same-origin');
    set('Cross-Origin-Resource-Policy', 'same-origin');
    set('Permissions-Policy', PERMISSIONS_POLICY);
    if (options.secure) set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    if (request.url.startsWith(`${options.apiPrefix}/`)) {
      set('Cache-Control', 'no-store');
      set('Content-Security-Policy', API_CSP);
    }
    return payload;
  };
}
