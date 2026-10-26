import { resolve } from 'node:path';

export type Environment = 'production' | 'development' | 'test';

export const REQUIRED_ENV = ['DATABASE_URL'] as const;
export const REQUIRED_PRODUCTION_ENV = [
  'PUBLIC_URL',
  'RESEND_API_KEY',
  'MAIL_FROM',
  'S3_ENDPOINT',
  'S3_REGION',
  'S3_BUCKET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
] as const;

export type StorageConfig =
  | { driver: 'local'; dir: string }
  | { driver: 's3'; endpoint: string; region: string; bucket: string; prefix: string; accessKeyId: string; secretAccessKey: string };

export interface Config {
  environment: Environment;
  databaseUrl: string;
  databasePoolSize: number;
  server: { host: string; port: number; trustProxyHops: number; logLevel: string };
  publicUrl: string;
  publicOrigin: string;
  secureCookies: boolean;
  session: { idleMinutes: number; absoluteHours: number };
  passwordResetTtlMinutes: number;
  invitationTtlHours: number;
  setupToken: string | null;
  runtimeDir: string;
  storage: StorageConfig;
  attachments: { maxBytes: number };
  publish: {
    publishRoot: string | null;
    wranglerBin: string | null;
    cloudflare: { apiToken: string; accountId: string } | null;
    git: { authorName: string; authorEmail: string; sshCommand: string | null };
  };
  mail: { transport: 'resend' | 'console'; apiKey: string | null; from: string | null; brand: string; timeZone: string };
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
    session: {
      idleMinutes: read.integer('SESSION_IDLE_MINUTES', 120, { min: 5, max: 1440 }),
      absoluteHours: read.integer('SESSION_ABSOLUTE_HOURS', 24, { min: 1, max: 720 }),
    },
    passwordResetTtlMinutes: read.integer('PASSWORD_RESET_TTL_MINUTES', 30, { min: 5, max: 1440 }),
    invitationTtlHours: read.integer('INVITATION_TTL_HOURS', 168, { min: 1, max: 720 }),
    setupToken: read.text('SETUP_TOKEN'),
    runtimeDir: resolve(read.text('CAPIDOCS_RUNTIME_DIR') ?? 'apps/site'),
    storage: { driver: 'local', dir: '' },
    attachments: { maxBytes: read.integer('ATTACHMENT_MAX_BYTES', 8 * 1024 * 1024, { min: 1024, max: 50 * 1024 * 1024 }) },
    publish: {
      publishRoot: read.text('PUBLISH_ROOT') ? resolve(read.text('PUBLISH_ROOT')!) : null,
      wranglerBin: read.text('WRANGLER_BIN'),
      cloudflare:
        read.text('CLOUDFLARE_API_TOKEN') && read.text('CLOUDFLARE_ACCOUNT_ID')
          ? { apiToken: read.text('CLOUDFLARE_API_TOKEN')!, accountId: read.text('CLOUDFLARE_ACCOUNT_ID')! }
          : null,
      git: {
        authorName: read.text('DEPLOY_GIT_AUTHOR_NAME') ?? 'Capidocs Studio',
        authorEmail: read.text('DEPLOY_GIT_AUTHOR_EMAIL') ?? 'studio@localhost',
        sshCommand: read.text('DEPLOY_GIT_SSH_COMMAND'),
      },
    },
    mail: {
      transport: mailTransport,
      apiKey: resendKey,
      from: mailFrom,
      brand: read.text('MAIL_BRAND') ?? 'Capidocs Studio',
      timeZone: read.text('MAIL_TIME_ZONE') ?? 'America/Mexico_City',
    },
  };

  const driver = read.choice('STORAGE_DRIVER', ['s3', 'local'] as const, production ? 's3' : 'local');
  if (production && driver !== 's3') read.problems.push('STORAGE_DRIVER must be s3 in production');
  if (driver === 's3') {
    const endpoint = read.url('S3_ENDPOINT', null, ['https:', ...(production ? [] : ['http:'])]);
    config.storage = {
      driver: 's3',
      endpoint: endpoint?.origin ?? '',
      region: read.required('S3_REGION'),
      bucket: read.required('S3_BUCKET'),
      prefix: read.text('S3_PREFIX') ?? 'attachments/',
      accessKeyId: read.required('S3_ACCESS_KEY_ID'),
      secretAccessKey: read.required('S3_SECRET_ACCESS_KEY'),
    };
    if (!endpoint && !production) read.problems.push('S3_ENDPOINT is required');
  } else {
    config.storage = { driver: 'local', dir: resolve(read.text('FILES_DIR') ?? '.tmp/files') };
  }

  const setupToken = config.setupToken;
  if (setupToken !== null && setupToken.length < 24) read.problems.push('SETUP_TOKEN must have at least 24 characters');
  try {
    new Intl.DateTimeFormat('es-MX', { timeZone: config.mail.timeZone });
  } catch {
    read.problems.push('MAIL_TIME_ZONE must be an IANA time zone');
  }

  if (config.storage.driver === 's3' && !/^([a-z0-9_-]+\/)*$/.test(config.storage.prefix)) {
    read.problems.push('S3_PREFIX must be empty or end with a slash and use only a-z, 0-9, _ and -');
  }

  if (read.problems.length) throw new ConfigError([...new Set(read.problems)]);
  return config;
}
