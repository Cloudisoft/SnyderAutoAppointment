import cors from '@fastify/cors';
import Fastify, { type FastifyBaseLogger } from 'fastify';
import type { Deps } from './deps';
import { registerErrorHandler } from './plugins/errors';

export async function buildApp(deps: Deps) {
  const app = Fastify({ loggerInstance: deps.logger as FastifyBaseLogger, trustProxy: true, bodyLimit: 5 * 1024 * 1024 });
  registerErrorHandler(app);
  await app.register(cors, {
    origin: deps.config.CORS_ORIGINS.split(',').map((s) => s.trim()),
    credentials: true,
  });

  app.get('/health', async () => ({ ok: true }));

  return app;
}
