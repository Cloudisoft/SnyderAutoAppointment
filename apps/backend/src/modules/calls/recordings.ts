import { createHmac, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../../deps';
import { recordingUrlOf } from '../../integrations/vapi';
import { notFound } from '../../lib/errors';
import { authenticate, authOf, requirePermission } from '../../plugins/auth';

/**
 * Recordings are streamed through this server. The calling service may keep them on private
 * storage behind expiring links, so a stored URL can stop working; when it does (or there is none
 * yet), a fresh one is fetched from the calling service with the server's key.
 */
const key = (secret: string) => createHmac('sha256', secret).update('recording-link:v1').digest();
const sign = (secret: string, callId: string, exp: number) => createHmac('sha256', key(secret)).update(`${callId}.${exp}`).digest('base64url');

export function signedRecordingUrl(config: Deps['config'], callId: string, now: Date, ttlMs = 6 * 3_600_000): string {
  const exp = now.getTime() + ttlMs;
  return `${config.BACKEND_PUBLIC_URL.replace(/\/$/, '')}/api/recordings/${callId}?exp=${exp}&sig=${sign(config.VAPI_WEBHOOK_SECRET, callId, exp)}`;
}

function verify(secret: string, callId: string, exp: number, sig: string, now: Date): boolean {
  if (!Number.isFinite(exp) || exp < now.getTime()) return false;
  const expected = Buffer.from(sign(secret, callId, exp));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

async function reachable(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { headers: { range: 'bytes=0-0' }, signal: AbortSignal.timeout(8_000) });
    await r.body?.cancel();
    return r.ok;
  } catch {
    return false;
  }
}

/** A playable URL for a call's recording, refreshed from the calling service when needed. */
export async function resolveRecordingUrl(deps: Deps, callId: string): Promise<string | null> {
  const { rows } = await deps.db.query<{ recording_url: string | null; vapi_call_id: string | null }>(
    'select recording_url, vapi_call_id from calls where id = $1',
    [callId],
  );
  const c = rows[0];
  if (!c) return null;
  if (c.recording_url && (await reachable(c.recording_url))) return c.recording_url;
  if (!c.vapi_call_id) return null;
  const remote = await deps.vapi.getCall(c.vapi_call_id).catch(() => null);
  const fresh = remote ? recordingUrlOf(remote.artifact, remote.recordingUrl) : null;
  if (fresh && fresh !== c.recording_url) await deps.db.query('update calls set recording_url = $2 where id = $1', [callId, fresh]);
  return fresh;
}

export async function registerRecordingRoutes(app: FastifyInstance, deps: Deps) {
  const auth = authenticate(deps);
  const idParam = z.object({ id: z.string().uuid() });

  // A short-lived link the browser's audio player (which can't send auth headers) can stream from.
  app.get('/api/calls/:id/recording-link', { preHandler: [auth, requirePermission('calls.view')] }, async (req) => {
    const { organizationId } = authOf(req);
    const { id } = idParam.parse(req.params);
    const own = await deps.db.query('select 1 from calls where id = $1 and organization_id = $2', [id, organizationId]);
    if (!own.rowCount) throw notFound();
    return { url: signedRecordingUrl(deps.config, id, deps.clock.now()) };
  });

  app.get('/api/recordings/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const q = z.object({ exp: z.coerce.number(), sig: z.string(), download: z.string().optional() }).parse(req.query);
    if (!verify(deps.config.VAPI_WEBHOOK_SECRET, id, q.exp, q.sig, deps.clock.now())) {
      return reply.status(403).send({ error: 'forbidden', message: 'This recording link expired. Reopen the call to get a new one.' });
    }
    const url = await resolveRecordingUrl(deps, id);
    if (!url) return reply.status(404).send({ error: 'not_found', message: 'No recording is available for this call.' });
    const range = req.headers.range;
    const upstream = await fetch(url, { headers: range ? { range } : {}, signal: AbortSignal.timeout(60_000) });
    if (!upstream.ok || !upstream.body) {
      return reply.status(502).send({ error: 'upstream_error', message: `The recording could not be loaded (${upstream.status}).` });
    }
    reply.status(upstream.status);
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
      const v = upstream.headers.get(h);
      if (v) reply.header(h, v);
    }
    if (!upstream.headers.get('content-type')) reply.header('content-type', 'audio/wav');
    reply.header('cache-control', 'private, max-age=300');
    reply.header('content-disposition', `${q.download ? 'attachment' : 'inline'}; filename="call-${id}.wav"`);
    return reply.send(Readable.fromWeb(upstream.body as import('node:stream/web').ReadableStream));
  });
}
