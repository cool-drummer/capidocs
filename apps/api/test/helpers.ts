import postgres from 'postgres';
import type { CapidocsApp } from '../src/app.js';

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';
type InjectResponse = Awaited<ReturnType<CapidocsApp['inject']>>;

export const TEST_DATABASE_ROOT = process.env.TEST_DATABASE_ROOT ?? 'postgres://capidocs:capidocs@127.0.0.1:55432';

export function testDatabaseUrl(name: string): string {
  return `${TEST_DATABASE_ROOT}/${name}`;
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

  constructor(private readonly app: CapidocsApp) {}

  request(method: Method, path: string, options: { payload?: unknown; headers?: Record<string, string> } = {}): Promise<InjectResponse> {
    return this.app.inject({
      method,
      url: `/api${path}`,
      ...(options.payload === undefined ? {} : { payload: options.payload as never }),
      headers: { ...(this.cookie ? { cookie: this.cookie } : {}), ...options.headers },
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
  }

  async login(email: string, password: string): Promise<InjectResponse> {
    const response = await this.request('POST', '/auth/login', { payload: { email, password } });
    this.adopt(response);
    return response;
  }
}
