import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, REQUIRED_ENV, REQUIRED_PRODUCTION_ENV } from '../src/config.js';

const production = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://studio:value@db:5432/studio',
  PUBLIC_URL: 'https://studio.example.com',
  RESEND_API_KEY: 'value',
  MAIL_FROM: 'Studio <studio@example.com>',
  S3_ENDPOINT: 'https://nyc3.digitaloceanspaces.com',
  S3_REGION: 'nyc3',
  S3_BUCKET: 'studio-files',
  S3_ACCESS_KEY_ID: 'value',
  S3_SECRET_ACCESS_KEY: 'value',
};

function problemsOf(env: Record<string, string>): string[] {
  try {
    loadConfig(env);
    return [];
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
    throw error;
  }
}

describe('configuration', () => {
  it('fails early when the database is missing', () => {
    expect(problemsOf({})).toContain('DATABASE_URL is required');
  });

  it('names every missing production variable at once', () => {
    const problems = problemsOf({ NODE_ENV: 'production', DATABASE_URL: production.DATABASE_URL });
    for (const name of REQUIRED_PRODUCTION_ENV) expect(problems).toContain(`${name} is required`);
  });

  it('never echoes a value in its messages', () => {
    const problems = problemsOf({ ...production, DATABASE_URL: 'mysql://root:hunter2@db/x', PORT: 'hunter2' });
    expect(problems.join(' ')).not.toContain('hunter2');
    expect(problems).toContain('DATABASE_URL must be a postgres:// URL');
  });

  it('requires https for the public URL in production', () => {
    expect(problemsOf({ ...production, PUBLIC_URL: 'http://studio.example.com' })).toContain('PUBLIC_URL must use https:');
  });

  it('refuses to log mail instead of sending it in production', () => {
    expect(problemsOf({ ...production, MAIL_TRANSPORT: 'console' })).toContain('MAIL_TRANSPORT must be resend in production');
  });

  it('loads a complete production configuration with secure cookies', () => {
    const config = loadConfig(production);
    expect(config.secureCookies).toBe(true);
    expect(config.publicOrigin).toBe('https://studio.example.com');
    expect(config.mail.transport).toBe('resend');
  });

  it('keeps development usable without mail credentials', () => {
    const config = loadConfig({ DATABASE_URL: production.DATABASE_URL });
    expect(config.environment).toBe('development');
    expect(config.secureCookies).toBe(false);
    expect(config.mail.transport).toBe('console');
  });

  it('refuses local disk storage in production', () => {
    expect(problemsOf({ ...production, STORAGE_DRIVER: 'local' })).toContain('STORAGE_DRIVER must be s3 in production');
  });

  it('keeps attachments in a private bucket under a safe prefix', () => {
    const config = loadConfig(production);
    expect(config.storage).toMatchObject({ driver: 's3', endpoint: 'https://nyc3.digitaloceanspaces.com', prefix: 'attachments/' });
    expect(problemsOf({ ...production, S3_PREFIX: '../x' })).toContain('S3_PREFIX must be empty or end with a slash and use only a-z, 0-9, _ and -');
  });

  it('declares the database as required in every environment', () => {
    expect(REQUIRED_ENV).toContain('DATABASE_URL');
  });
});
