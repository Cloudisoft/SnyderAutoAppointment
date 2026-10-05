import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import path from 'node:path';

const BACKEND_PREFIXES = ['/api/', '/webhooks/', '/public/', '/health'];

/**
 * Serves the built web app (apps/frontend/dist) from the API process when FRONTEND_DIST_DIR is set,
 * so one deployment hosts the app, the API, webhooks and the public appointment page on one origin.
 * Unknown GET routes fall back to index.html for client-side routing.
 */
export async function registerFrontend(app: FastifyInstance, distDir: string | undefined) {
  if (!distDir) return;
  const root = path.resolve(distDir);
  if (!existsSync(path.join(root, 'index.html'))) {
    app.log.warn({ root }, 'FRONTEND_DIST_DIR has no index.html; not serving the web app');
    return;
  }
  await app.register(fastifyStatic, { root, wildcard: false, index: false, maxAge: '1h' });
  app.setNotFoundHandler((req, reply) => {
    const isBackend = BACKEND_PREFIXES.some((p) => req.url.startsWith(p));
    if (req.method !== 'GET' || isBackend) return reply.status(404).send({ error: 'not_found', message: 'Not found' });
    return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
  });
}
