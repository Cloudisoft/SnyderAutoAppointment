import { timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { unauthorized } from '../lib/errors';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Extracts the shared secret Vapi sends (X-Vapi-Secret, or Authorization: Bearer). */
export function presentedVapiSecret(req: FastifyRequest): string | null {
  const header = req.headers['x-vapi-secret'];
  if (typeof header === 'string' && header) return header;
  const auth = req.headers.authorization;
  if (auth?.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return null;
}

/** Rejects any Vapi server/tool request that doesn't carry VAPI_WEBHOOK_SECRET. */
export function verifyVapiSecret(secret: string) {
  return async (req: FastifyRequest) => {
    const presented = presentedVapiSecret(req);
    if (!presented || !safeEqual(presented, secret)) {
      req.log.warn({ ip: req.ip }, 'rejected Vapi request with missing/invalid secret');
      throw unauthorized('Invalid webhook secret');
    }
  };
}
