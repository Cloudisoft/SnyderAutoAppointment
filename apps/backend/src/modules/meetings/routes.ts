import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../../deps';
import { HttpError, notFound } from '../../lib/errors';
import { neutralize, UpstreamError } from '../../lib/http';
import { authenticate, authOf, requirePermission } from '../../plugins/auth';
import {
  clientFor,
  getConnection,
  MeetingSetupError,
  PROVIDER_LABELS,
  PROVIDERS,
  redirectUri,
  removeConnection,
  saveConnection,
  signState,
  verifyState,
  type Provider,
} from './connections';
import { syncAppointmentMeeting } from './sync';

const providerParam = z.object({ provider: z.enum(PROVIDERS) });
const describe = (err: unknown) =>
  neutralize(err instanceof UpstreamError ? err.userMessage : (err as Error)?.message || 'Unknown error').slice(0, 300);

export async function registerMeetingRoutes(app: FastifyInstance, deps: Deps) {
  const { db, config } = deps;
  const auth = authenticate(deps);
  const manage = [auth, requirePermission('settings.manage')];
  const settingsUrl = (q: Record<string, string>) => `${config.APP_PUBLIC_URL.replace(/\/$/, '')}/settings/integrations?${new URLSearchParams(q)}`;

  app.get('/api/integrations', { preHandler: manage }, async (req) => {
    const { organizationId } = authOf(req);
    return Promise.all(
      PROVIDERS.map(async (provider) => {
        const c = await getConnection(db, organizationId, provider);
        return {
          provider,
          label: PROVIDER_LABELS[provider],
          available: clientFor(deps, provider).configured(),
          connected: !!c,
          status: c?.status ?? null,
          account_email: c?.account_email ?? null,
          account_name: c?.account_name ?? null,
          last_error: c?.last_error ?? null,
          connected_at: c?.connected_at ?? null,
          redirect_uri: redirectUri(config, provider),
        };
      }),
    );
  });

  // Starts OAuth: returns the provider's consent URL; the browser goes there and comes back to /callback.
  app.post('/api/integrations/:provider/connect', { preHandler: manage }, async (req) => {
    const { organizationId, userId } = authOf(req);
    const { provider } = providerParam.parse(req.params);
    const client = clientFor(deps, provider);
    if (!client.configured()) {
      throw new HttpError(503, `${PROVIDER_LABELS[provider]} is not set up on the server yet (missing OAuth app credentials).`, 'not_configured');
    }
    const state = signState(config.VAPI_WEBHOOK_SECRET, { organizationId, userId, provider }, deps.clock.now());
    return { url: client.authorizeUrl(redirectUri(config, provider), state) };
  });

  // OAuth redirect target (no session cookie here: the signed state carries the org and user).
  app.get('/api/integrations/:provider/callback', async (req, reply) => {
    const { provider } = providerParam.parse(req.params);
    const q = z.object({ code: z.string().optional(), state: z.string().optional(), error: z.string().optional() }).parse(req.query);
    const fail = (message: string) => reply.redirect(settingsUrl({ provider, error: message }));
    if (q.error) return fail(q.error === 'access_denied' ? 'Access was not granted.' : `The provider returned: ${q.error}`);
    const who = q.state ? verifyState(config.VAPI_WEBHOOK_SECRET, q.state, provider, deps.clock.now()) : null;
    if (!who || !q.code) return fail('This connection link expired or is invalid. Please try again.');
    const allowed = await db.query(
      `select 1 from memberships m join role_permissions rp on rp.role_id = m.role_id
        where m.organization_id = $1 and m.user_id = $2 and rp.permission_key = 'settings.manage'`,
      [who.organizationId, who.userId],
    );
    if (!allowed.rowCount) return fail('You no longer have permission to change integrations.');
    try {
      const client = clientFor(deps, provider);
      const tokens = await client.exchangeCode(q.code, redirectUri(config, provider));
      const account = await client.account(tokens.accessToken);
      await saveConnection(deps, { organizationId: who.organizationId, provider, userId: who.userId, tokens, account });
      return reply.redirect(settingsUrl({ connected: provider }));
    } catch (err) {
      req.log.warn({ err, provider }, 'oauth callback failed');
      return fail(err instanceof MeetingSetupError ? err.message : `Could not connect: ${describe(err)}`);
    }
  });

  app.delete('/api/integrations/:provider', { preHandler: manage }, async (req) => {
    const { organizationId } = authOf(req);
    const { provider } = providerParam.parse(req.params);
    if (!(await removeConnection(deps, organizationId, provider as Provider))) throw notFound('Not connected');
    return { ok: true };
  });

  // Re-creates or updates one appointment's calendar event / meeting link on demand.
  app.post('/api/appointments/:id/meeting/sync', { preHandler: [auth, requirePermission('appointments.manage')] }, async (req) => {
    const { organizationId } = authOf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const own = await db.query('select 1 from appointments where id = $1 and organization_id = $2', [id, organizationId]);
    if (!own.rowCount) throw notFound();
    try {
      const meeting = await syncAppointmentMeeting(deps, id);
      return { ok: true, meeting };
    } catch (err) {
      throw new HttpError(err instanceof MeetingSetupError ? 409 : 502, describe(err), 'meeting_sync_failed');
    }
  });
}
