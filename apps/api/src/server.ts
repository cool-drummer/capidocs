import { createApp } from './app.js';
import { ConfigError, loadConfig, type Config } from './config.js';

function readConfig(): Config {
  try {
    return loadConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}

const config = readConfig();
const app = await createApp(config, { logger: true });
await app.listen({ port: config.server.port, host: config.server.host });

let closing = false;
const shutdown = async (signal: string) => {
  if (closing) return;
  closing = true;
  app.fastify.log.info({ signal }, 'shutting down');
  await app.close();
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
