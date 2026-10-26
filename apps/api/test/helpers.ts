import { join } from 'node:path';
import postgres from 'postgres';
import type { CapidocsApp } from '../src/app.js';
import { loadConfig, type Config } from '../src/config.js';
import type { MailMessage } from '../src/lib/mail.js';

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';
type InjectResponse = Awaited<ReturnType<CapidocsApp['inject']>>;

export const TEST_DATABASE_ROOT = process.env.TEST_DATABASE_ROOT ?? 'postgres://capidocs:capidocs@127.0.0.1:55432';

export function testDatabaseUrl(name: string): string {
  return `${TEST_DATABASE_ROOT}/${name}`;
}

export const ROOT = join(import.meta.dirname, '..', '..', '..');

export function testConfig(databaseUrl: string, env: Record<string, string> = {}): Config {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    PUBLIC_URL: 'https://studio.test',
    CAPIDOCS_RUNTIME_DIR: join(ROOT, 'apps/site'),
    ...env,
  });
}

export const TEST_SETUP_TOKEN = 'setup-token-for-the-test-suite';

export function productionConfig(databaseUrl: string, env: Record<string, string> = {}): Config {
  return loadConfig({
    NODE_ENV: 'production',
    SETUP_TOKEN: TEST_SETUP_TOKEN,
    DATABASE_URL: databaseUrl,
    PUBLIC_URL: 'https://studio.test',
    RESEND_API_KEY: 'not-used-in-tests',
    MAIL_FROM: 'Studio <studio@example.com>',
    CAPIDOCS_RUNTIME_DIR: join(ROOT, 'apps/site'),
    ...env,
  });
}

export function memoryMailer() {
  const sent: MailMessage[] = [];
  return {
    sent,
    async send(message: MailMessage) {
      sent.push(message);
      return { id: `test-${sent.length}` };
    },
  };
}

export async function resetDatabase(url: string): Promise<void> {
  const admin = postgres(url.replace(/\/[^/]+$/, '/postgres'), { onnotice: () => undefined });
  const name = url.split('/').pop()!;
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`unsafe test database name: ${name}`);
  await admin.unsafe(`DROP DATABASE IF EXISTS ${name}`);
  await admin.unsafe(`CREATE DATABASE ${name}`);
  await admin.end();
}

export interface CallResult {
  status: number;
  body: never;
  headers: InjectResponse['headers'];
  raw: InjectResponse;
}

export class Client {
  cookie = '';
  csrf = '';

  constructor(private readonly app: CapidocsApp) {}

  request(method: Method, path: string, options: { payload?: unknown; headers?: Record<string, string> } = {}): Promise<InjectResponse> {
    return this.app.inject({
      method,
      url: `/api${path}`,
      ...(options.payload === undefined ? {} : { payload: options.payload as never }),
      headers: {
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...(this.csrf && method !== 'GET' ? { 'x-csrf-token': this.csrf } : {}),
        ...options.headers,
      },
    });
  }

  async call(method: Method, path: string, payload?: unknown): Promise<CallResult> {
    const response = await this.request(method, path, payload === undefined ? {} : { payload });
    const text = response.body;
    return { status: response.statusCode, body: (text ? JSON.parse(text) : {}) as never, headers: response.headers, raw: response };
  }

  adopt(response: InjectResponse): void {
    const header = response.headers['set-cookie'];
    const cookie = Array.isArray(header) ? header[0] : header;
    if (cookie) this.cookie = cookie.split(';')[0]!;
    try {
      const body = JSON.parse(response.body) as { csrfToken?: unknown };
      if (typeof body.csrfToken === 'string') this.csrf = body.csrfToken;
    } catch {
      return;
    }
  }

  async login(email: string, password: string): Promise<InjectResponse> {
    const response = await this.request('POST', '/auth/login', { payload: { email, password } });
    this.adopt(response);
    return response;
  }
}
