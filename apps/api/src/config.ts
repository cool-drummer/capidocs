import { resolve } from 'node:path';

export type Environment = 'production' | 'development' | 'test';

export const REQUIRED_ENV = ['DATABASE_URL'] as const;
export const REQUIRED_PRODUCTION_ENV = ['PUBLIC_URL', 'RESEND_API_KEY', 'MAIL_FROM'] as const;

export interface Config {
  environment: Environment;
  databaseUrl: string;
  databasePoolSize: number;
  server: { host: string; port: number; trustProxyHops: number; logLevel: string };
  publicUrl: string;
  publicOrigin: string;
  secureCookies: boolean;
  runtimeDir: string;
  files: { dir: string };
  mail: { transport: 'resend' | 'console'; apiKey: string | null; from: string | null; brand: string };
}

export class ConfigError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`Invalid configuration:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`);
    this.problems = problems;
  }
}

type Env = Record<string, string | undefined>;

class Reader {
  readonly problems: string[] = [];

  constructor(private readonly env: Env) {}

  text(name: string): string | null {
    const value = this.env[name]?.trim();
    return value ? value : null;
  }

  required(name: string): string {
    const value = this.text(name);
    if (!value) this.problems.push(`${name} is required`);
    return value ?? '';
  }

  integer(name: string, fallback: number, range: { min: number; max: number }): number {
    const raw = this.text(name);
    if (raw === null) return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < range.min || value > range.max) {
      this.problems.push(`${name} must be an integer between ${range.min} and ${range.max}`);
      return fallback;
    }
    return value;
  }

  choice<T extends string>(name: string, options: readonly T[], fallback: T): T {
    const raw = this.text(name);
    if (raw === null) return fallback;
    if (!options.includes(raw as T)) {
      this.problems.push(`${name} must be one of: ${options.join(', ')}`);
      return fallback;
    }
    return raw as T;
  }

  url(name: string, fallback: string | null, protocols: string[]): URL | null {
    const raw = this.text(name) ?? fallback;
    if (raw === null) return null;
    try {
      const parsed = new URL(raw);
      if (!protocols.includes(parsed.protocol)) {
        this.problems.push(`${name} must use ${protocols.join(' or ')}`);
        return null;
      }
      return parsed;
    } catch {
      this.problems.push(`${name} must be a valid URL`);
      return null;
    }
  }
}

export function loadConfig(env: Env = process.env): Config {
  const read = new Reader(env);
  const environment = read.choice<Environment>('NODE_ENV', ['production', 'development', 'test'], 'development');
  const production = environment === 'production';

  for (const name of REQUIRED_ENV) read.required(name);
  if (production) for (const name of REQUIRED_PRODUCTION_ENV) read.required(name);

  const databaseUrl = read.text('DATABASE_URL') ?? '';
  if (databaseUrl && !/^postgres(ql)?:\/\//.test(databaseUrl)) read.problems.push('DATABASE_URL must be a postgres:// URL');

  const publicUrl = read.url('PUBLIC_URL', production ? null : 'http://localhost:5190', production ? ['https:'] : ['https:', 'http:']);

  const mailTransport = read.choice('MAIL_TRANSPORT', ['resend', 'console'] as const, production ? 'resend' : 'console');
  if (production && mailTransport !== 'resend') read.problems.push('MAIL_TRANSPORT must be resend in production');
  const mailFrom = read.text('MAIL_FROM');
  const resendKey = read.text('RESEND_API_KEY');
  if (mailTransport === 'resend' && !production && (!mailFrom || !resendKey)) {
    read.problems.push('MAIL_TRANSPORT=resend needs RESEND_API_KEY and MAIL_FROM');
  }

  const config: Config = {
    environment,
    databaseUrl,
    databasePoolSize: read.integer('DATABASE_POOL_SIZE', 10, { min: 1, max: 100 }),
    server: {
      host: read.text('HOST') ?? '127.0.0.1',
      port: read.integer('PORT', 3090, { min: 1, max: 65535 }),
      trustProxyHops: read.integer('TRUST_PROXY_HOPS', 0, { min: 0, max: 5 }),
      logLevel: read.choice('LOG_LEVEL', ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const, 'info'),
    },
    publicUrl: publicUrl ? publicUrl.href.replace(/\/$/, '') : '',
    publicOrigin: publicUrl ? publicUrl.origin : '',
    secureCookies: production,
    runtimeDir: resolve(read.text('CAPIDOCS_RUNTIME_DIR') ?? 'apps/site'),
    files: { dir: resolve(read.text('FILES_DIR') ?? '.tmp/files') },
    mail: {
      transport: mailTransport,
      apiKey: resendKey,
      from: mailFrom,
      brand: read.text('MAIL_BRAND') ?? 'Capidocs Studio',
    },
  };

  if (read.problems.length) throw new ConfigError(read.problems);
  return config;
}
