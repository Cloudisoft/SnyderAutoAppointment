import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../../deps';
import { HttpError, notFound } from '../../lib/errors';
import { UpstreamError } from '../../lib/http';
import { authenticate, authOf, requirePermission } from '../../plugins/auth';
import { buildAssistant, serverUrl, type AssistantExtension, type AssistantLead } from '../agents/assistantBuilder';
import type { CallPipeline } from '../calls/pipeline';
import { resolveSnapshot } from '../campaigns/service';
import { loadTwilioCredentials } from '../telephony/routes';

export interface CheckResult {
  ok: boolean;
  message: string;
}

const describe = (err: unknown) =>
  err instanceof UpstreamError ? err.userMessage : err instanceof HttpError ? err.message : (err as Error)?.message || 'Unknown error';

async function check(fn: () => Promise<string>): Promise<CheckResult> {
  try {
    return { ok: true, message: await fn() };
  } catch (err) {
    return { ok: false, message: describe(err) };
  }
}

export async function registerHealthRoutes(app: FastifyInstance, deps: Deps, pipeline: CallPipeline) {
  const { db } = deps;
  const auth = authenticate(deps);
  const manage = [auth, requirePermission('settings.manage')];

  // Live check of every outside service the calling flow depends on, using the server's own keys.
  app.get('/api/integrations/health', { preHandler: manage }, async (req) => {
    const { organizationId } = authOf(req);
    const accounts = await db.query<{ id: string; name: string; account_sid: string }>(
      'select id, label as name, account_sid from twilio_accounts where organization_id = $1 order by created_at',
      [organizationId],
    );
    const smtp = await db.query<{ last_test_ok: boolean | null; last_test_error: string | null }>(
      'select last_test_ok, last_test_error from organization_smtp_settings where organization_id = $1',
      [organizationId],
    );
    const [vapi, cartesia, twilio] = await Promise.all([
      check(async () => {
        await deps.vapi.ping();
        return 'Connected';
      }),
      check(async () => {
        const voices = await deps.cartesia.listVoices();
        return `Connected · ${voices.length} voices available`;
      }),
      Promise.all(
        accounts.rows.map(async (a) => ({
          id: a.id,
          name: a.name || a.account_sid,
          ...(await check(async () => {
            const creds = await loadTwilioCredentials(deps, organizationId, a.id);
            const r = await deps.twilio.verifyCredentials(creds.accountSid, creds.authToken);
            return `Connected · ${r.friendlyName}`;
          })),
        })),
      ),
    ]);
    const s = smtp.rows[0];
    return {
      vapi,
      cartesia,
      twilio: twilio.length ? twilio : [{ id: null, name: 'Twilio', ok: false, message: 'No Twilio account added yet (Settings → Phone numbers)' }],
      email: !s
        ? { ok: false, message: 'Not set up (Settings → Email)' }
        : s.last_test_ok === false
          ? { ok: false, message: `Last test failed: ${s.last_test_error ?? 'unknown error'}` }
          : { ok: true, message: s.last_test_ok ? 'Configured · last test passed' : 'Configured · send a test email to verify' },
      webhook: { ok: true, message: serverUrl(deps.config) },
    };
  });

  // Sends this campaign's exact call config (model, Cartesia voice, tools, recording) to Vapi for
  // validation by creating and immediately deleting a temporary assistant. No call is placed.
  app.post('/api/campaigns/:id/test-config', { preHandler: [auth, requirePermission('campaigns.manage')] }, async (req) => {
    const { organizationId } = authOf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { rows } = await db.query<{ name: string; draft: Record<string, unknown> }>(
      'select name, draft from campaigns where id = $1 and organization_id = $2',
      [id, organizationId],
    );
    if (!rows[0]) throw notFound();
    const resolved = await resolveSnapshot(db, organizationId, rows[0]);
    if (!resolved.snapshot) return { ok: false, errors: resolved.errors, warnings: resolved.warnings };
    const snapshot = resolved.snapshot;

    const leadRow = await db.query<AssistantLead & { time_zone: string | null }>(
      'select id, first_name, last_name, email, company, phone_e164, custom_fields, time_zone from leads where organization_id = $1 order by created_at desc limit 1',
      [organizationId],
    );
    const lead = leadRow.rows[0] ?? {
      id: randomUUID(),
      first_name: 'Alex',
      last_name: 'Sample',
      email: 'alex@example.com',
      company: 'Sample Co',
      phone_e164: '+12125550100',
      custom_fields: {},
      time_zone: null,
    };
    const callId = randomUUID();
    const extensions: AssistantExtension[] = [];
    for (const provider of pipeline.extensions) {
      const ext = await provider({ deps, snapshot, lead, callId, organizationId, leadTimeZone: lead.time_zone ?? snapshot.time_zone });
      if (ext) extensions.push(ext);
    }
    const assistant = buildAssistant({ snapshot, lead, callId, organizationId, config: deps.config, extensions });
    assistant.name = `config-test ${snapshot.campaign_name}`.slice(0, 40);
    const summary = {
      model: `${assistant.model.provider} · ${assistant.model.model}`,
      voice: `${assistant.voice.provider} · ${assistant.voice.model} · ${snapshot.agent.voice.name}`,
      tools: assistant.model.tools.map((t) => (t.type === 'function' ? t.function.name : t.type)),
      recording: !!assistant.artifactPlan?.recordingEnabled,
    };
    try {
      const created = await deps.vapi.createAssistant(assistant);
      await deps.vapi.deleteAssistant(created.id).catch((err) => req.log.warn({ err, id: created.id }, 'could not delete config-test assistant'));
      return { ok: true, errors: [], warnings: resolved.warnings, ...summary };
    } catch (err) {
      return { ok: false, errors: [`Vapi rejected the call config: ${describe(err)}`], warnings: resolved.warnings, ...summary };
    }
  });
}
