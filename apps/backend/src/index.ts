import { buildApp } from './app';
import { loadConfig } from './config';
import { createPool } from './db/pool';
import type { Deps } from './deps';
import { systemClock } from './lib/clock';
import { createLogger } from './lib/logger';

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);
const db = createPool(config.DATABASE_URL);

const deps: Deps = { config, db, logger, clock: systemClock };
const app = await buildApp(deps);

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'shutting down');
  await app.close();
  await db.end();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port: config.PORT, host: '0.0.0.0' });
