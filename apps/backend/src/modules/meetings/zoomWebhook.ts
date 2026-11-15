import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../../deps';
import { forgetConnectionsForExternalUser } from './connections';

export const ZOOM_WEBHOOK_PATH = '/webhooks/zoom';

const hmac = (secret: string, message: string) => createHmac('sha256', secret).update(message).digest('hex');

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

interface ZoomEvent {
  event?: string;
  event_ts?: number;
  payload?: { plainToken?: string; user_id?: string; account_id?: string };
}

/**
 * Zoom event notifications. Handles the endpoint URL validation challenge and "app_deauthorized":
 * when a user removes the app in Zoom, the organization's stored Zoom token is deleted.
 * Requests are verified with the app's Secret Token (x-zm-signature over the raw body).
 */
export async function registerZoomWebhook(app: FastifyInstance, deps: Deps) {
  await app.register(async (scope) => {
    // Keep the exact bytes Zoom signed.
    scope.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => done(null, body));

    scope.post(ZOOM_WEBHOOK_PATH, async (req, reply) => {
      const secret = deps.config.ZOOM_WEBHOOK_SECRET_TOKEN;
      if (!secret) return reply.status(503).send({ message: 'Zoom events are not configured on this server.' });
      const raw = typeof req.body === 'string' ? req.body : '';
      let evt: ZoomEvent;
      try {
        evt = JSON.parse(raw) as ZoomEvent;
      } catch {
        return reply.status(400).send({ message: 'Invalid JSON' });
      }

      if (evt.event === 'endpoint.url_validation' && evt.payload?.plainToken) {
        const plainToken = evt.payload.plainToken;
        return { plainToken, encryptedToken: hmac(secret, plainToken) };
      }

      const ts = req.headers['x-zm-request-timestamp'];
      const sig = req.headers['x-zm-signature'];
      if (typeof ts !== 'string' || typeof sig !== 'string' || !safeEqual(sig, `v0=${hmac(secret, `v0:${ts}:${raw}`)}`)) {
        req.log.warn('rejected Zoom event with invalid signature');
        return reply.status(401).send({ message: 'Invalid signature' });
      }

      if (evt.event === 'app_deauthorized' && evt.payload?.user_id) {
        const removed = await forgetConnectionsForExternalUser(deps, 'zoom', evt.payload.user_id);
        req.log.info({ removed }, 'Zoom app deauthorized: stored Zoom connection deleted');
      }
      return { ok: true };
    });
  });
}
