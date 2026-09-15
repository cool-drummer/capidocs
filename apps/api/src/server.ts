import { createApp } from './app.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const app = await createApp({
  databaseUrl,
  runtimeDir: process.env.CAPIDOCS_RUNTIME_DIR ?? 'apps/site',
  secureCookies: process.env.NODE_ENV === 'production',
  logger: true,
});

const port = Number(process.env.PORT ?? 3090);
await app.listen({ port, host: '127.0.0.1' });
