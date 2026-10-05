import cors from '@fastify/cors';
import Fastify, { type FastifyBaseLogger } from 'fastify';
import type { Deps } from './deps';
import { registerLeadRoutes } from './modules/leads/routes';
import { registerTelephonyRoutes } from './modules/telephony/routes';
import { registerAgentRoutes } from './modules/agents/routes';
import { registerCampaignRoutes } from './modules/campaigns/routes';
import { registerNotificationRoutes } from './modules/org/notifications';
import { registerOrgRoutes } from './modules/org/routes';
import { registerErrorHandler } from './plugins/errors';

export async function buildApp(deps: Deps) {
  const app = Fastify({
    loggerInstance: deps.logger as FastifyBaseLogger,
    trustProxy: true,
    bodyLimit: 5 * 1024 * 1024,
  });
  registerErrorHandler(app);
  await app.register(cors, {
    origin: deps.config.CORS_ORIGINS.split(',').map((s) => s.trim()),
    credentials: true,
  });

  app.get('/health', async () => ({ ok: true }));
  await registerOrgRoutes(app, deps);
  await registerNotificationRoutes(app, deps);
  await registerLeadRoutes(app, deps);
  await registerTelephonyRoutes(app, deps);
  await registerAgentRoutes(app, deps);
  await registerCampaignRoutes(app, deps);

  return app;
}
