import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type CapidocsApp } from '../src/app.js';
import { memoryMailer, productionConfig, resetDatabase, testConfig, testDatabaseUrl } from './helpers.js';

const DATABASE_URL = testDatabaseUrl('capidocs_headers_test');
let studioDir: string;
let app: CapidocsApp;

function directives(csp: unknown): Map<string, string> {
  return new Map(
    String(csp)
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => [part.split(' ')[0]!, part] as const),
  );
}

beforeAll(async () => {
  await resetDatabase(DATABASE_URL);
  studioDir = await mkdtemp(join(tmpdir(), 'capidocs-studio-'));
  await mkdir(join(studioDir, 'assets'));
  await writeFile(join(studioDir, 'index.html'), '<!doctype html><html><head><script type="module" src="/assets/app.js"></script></head><body></body></html>');
  await writeFile(join(studioDir, 'assets', 'app.js'), 'console.log("studio")');
  app = await createApp(productionConfig(DATABASE_URL, { STUDIO_DIST_DIR: studioDir }), { mailer: memoryMailer() });
}, 60000);

afterAll(async () => {
  await app?.close();
  if (studioDir) await rm(studioDir, { recursive: true, force: true });
});

describe('studio document', () => {
  it('is served with a strict CSP without unsafe-inline or unsafe-eval', async () => {
    const response = await app.inject({ method: 'GET', url: '/' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('text/html; charset=utf-8');
    const csp = String(response.headers['content-security-policy']);
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval/);
    const parts = directives(csp);
    expect(parts.get('script-src')).toBe("script-src 'self'");
    expect(parts.get('style-src')).toBe("style-src 'self'");
    expect(parts.get('frame-ancestors')).toBe("frame-ancestors 'none'");
    expect(parts.get('object-src')).toBe("object-src 'none'");
    expect(parts.get('base-uri')).toBe("base-uri 'none'");
    expect(parts.has('upgrade-insecure-requests')).toBe(true);
    expect(response.headers['cache-control']).toBe('no-cache');
  });

  it('carries the transport and isolation headers', async () => {
    const response = await app.inject({ method: 'GET', url: '/' });
    expect(response.headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['permissions-policy']).toContain('camera=()');
    expect(response.headers['cross-origin-opener-policy']).toBe('same-origin');
  });

  it('serves hashed assets as immutable and nothing outside them', async () => {
    const asset = await app.inject({ method: 'GET', url: '/assets/app.js' });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    for (const url of ['/assets/..%2findex.html', '/assets/..%2f..%2fpackage.json', '/assets/..%5cindex.html', '/package.json', '/.env']) {
      expect((await app.inject({ method: 'GET', url })).statusCode, url).toBe(404);
    }
  });
});

describe('api responses', () => {
  it('are never cached and cannot render as a document', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/me' });
    expect(response.statusCode).toBe(401);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['content-security-policy']).toBe("default-src 'none'; frame-ancestors 'none'");
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.json()).toEqual({ error: 'unauthorized', message: 'Inicia sesión para continuar.' });
  });

  it('let the preview frame keep its own policy', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/preview/frame' });
    expect(String(response.headers['content-security-policy'])).toContain('sandbox allow-scripts');
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
  });

  it('keep unknown routes friendly', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/no-existe' });
    expect(response.statusCode).toBe(404);
    expect(response.json().message).toBe('No encontramos lo que buscas.');
  });
});

describe('development', () => {
  it('does not send HSTS over plain http', async () => {
    const local = await createApp(testConfig(DATABASE_URL), { mailer: memoryMailer() });
    const response = await local.inject({ method: 'GET', url: '/api/health' });
    expect(response.headers['strict-transport-security']).toBeUndefined();
    await local.close();
  });
});
