import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { pool } from './db/client.js';
import { redis } from './lib/redis.js';

const server = createApp().listen(env.PORT, () => logger.info(`API listening on :${env.PORT}`));

async function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down`);
  server.close();
  await Promise.allSettled([pool.end(), redis.quit()]);
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
