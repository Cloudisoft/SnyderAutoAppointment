import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../../deps';
import { recordingUrlOf } from '../../integrations/vapi';
import { notFound } from '../../lib/errors';
import { wavToMp3 } from '../../lib/mp3';
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

// Recently converted recordings, so replays and seeking don't re-download and re-encode.
const mp3Cache = new Map<string, Buffer>();
const MP3_CACHE_MAX = 25;

/** The call's recording as MP3: downloaded from storage and converted from WAV when needed. */
export async function recordingMp3(deps: Deps, callId: string): Promise<Buffer | null> {
  const url = await resolveRecordingUrl(deps, callId);
  if (!url) return null;
  const cacheKey = `${callId}:${url.split('?')[0]}`;
  const hit = mp3Cache.get(cacheKey);
  if (hit) return hit;
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`The recording could not be loaded (${res.status}).`);
  const raw = Buffer.from(await res.arrayBuffer());
  const type = res.headers.get('content-type') ?? '';
  const isMp3 = /mpeg|mp3/i.test(type) || raw.subarray(0, 3).toString('ascii') === 'ID3' || (raw[0] === 0xff && (raw[1]! & 0xe0) === 0xe0);
  const mp3 = isMp3 ? raw : wavToMp3(raw);
  if (!mp3) throw new Error('The recording is in an unsupported audio format.');
  mp3Cache.set(cacheKey, mp3);
  if (mp3Cache.size > MP3_CACHE_MAX) mp3Cache.delete(mp3Cache.keys().next().value!);
  return mp3;
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
    let mp3: Buffer | null;
    try {
      mp3 = await recordingMp3(deps, id);
    } catch (err) {
      req.log.warn({ err, callId: id }, 'recording could not be served');
      return reply.status(502).send({ error: 'upstream_error', message: (err as Error).message });
    }
    if (!mp3) return reply.status(404).send({ error: 'not_found', message: 'No recording is available for this call.' });
    reply.header('content-type', 'audio/mpeg');
    reply.header('accept-ranges', 'bytes');
    reply.header('cache-control', 'private, max-age=300');
    reply.header('content-disposition', `${q.download ? 'attachment' : 'inline'}; filename="call-${id}.mp3"`);
    // Range support so the player can seek.
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    if (m && (m[1] || m[2])) {
      const size = mp3.length;
      const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
      const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
      if (start >= size || start > end) return reply.status(416).header('content-range', `bytes */${size}`).send();
      reply.status(206).header('content-range', `bytes ${start}-${end}/${size}`);
      return reply.send(mp3.subarray(start, end + 1));
    }
    return reply.send(mp3);
  });
}
