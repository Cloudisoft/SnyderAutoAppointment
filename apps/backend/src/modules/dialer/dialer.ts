import { TERMINAL_LEAD_STATUSES, type CampaignSnapshot } from '@snyder/shared';
import { withTx } from '../../db/pool';
import type { Deps } from '../../deps';
import { isVapiValidationError } from '../../integrations/vapi';
import { acquireLease } from '../../lib/lease';
import { resolveLeadTimeZone } from '../../lib/timezone';
import { buildAssistant, type AssistantExtension, type AssistantLead } from '../agents/assistantBuilder';
import { loadVersionSnapshot } from '../campaigns/service';
import { addCallEvent } from '../calls/events';
import { handleCallEnded, type CallPipeline } from '../calls/pipeline';
import { inCallingWindow } from './window';

export const DIALER_LEASE = 'dialer';
const LEASE_TTL_MS = 30_000;

interface ClaimedLead extends AssistantLead {
  campaign_lead_id: string;
  time_zone: string | null;
}

export interface PlacedCall {
  callId: string;
  organizationId: string;
  versionId: string;
  snapshot: CampaignSnapshot;
  lead: ClaimedLead;
  phone: CampaignSnapshot['phone_numbers'][number];
}

/** One dialer pass ("process one batch"). Only the lease holder dials. */
export async function dialerTick(deps: Deps, pipeline: CallPipeline, holder: string): Promise<{ dialed: number }> {
  if (!(await acquireLease(deps.db, DIALER_LEASE, holder, LEASE_TTL_MS))) return { dialed: 0 };
  const { rows: campaigns } = await deps.db.query<{ id: string; organization_id: string; current_version_id: string }>(
    `select id, organization_id, current_version_id from campaigns where status = 'active' and current_version_id is not null`,
  );
  let dialed = 0;
  for (const c of campaigns) {
    try {
      const placed = await claimForCampaign(deps, c.organization_id, c.id, c.current_version_id);
      for (const p of placed) {
        await placeCall(deps, pipeline, p);
        dialed++;
      }
    } catch (err) {
      deps.logger.error({ err, campaignId: c.id }, 'dialer failed for campaign');
    }
  }
  return { dialed };
}

/** Claims due leads within concurrency and calling-window limits and creates their call rows. */
export async function claimForCampaign(deps: Deps, organizationId: string, campaignId: string, versionId: string): Promise<PlacedCall[]> {
  const snapshot = await loadVersionSnapshot(deps.db, versionId);
  if (!snapshot.phone_numbers.length) return [];
  const now = deps.clock.now();
  return withTx(deps.db, async (client) => {
    // Serialize claims per campaign so concurrent ticks can't overshoot concurrency.
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [`dialer:${campaignId}`]);
    // Leads that became terminal or DNC since queueing are never dialed.
    await client.query(
      `update campaign_leads cl set state = 'done'
         from leads l
        where cl.lead_id = l.id and cl.campaign_id = $1 and cl.state in ('queued', 'retry_wait')
          and (l.status = any($2::text[])
               or exists (select 1 from dnc_numbers d where d.organization_id = l.organization_id and d.phone_e164 = l.phone_e164))`,
      [campaignId, TERMINAL_LEAD_STATUSES],
    );
    const { rows: inflight } = await client.query<{ n: number }>(
      `select count(*)::int as n from calls where campaign_id = $1 and end_processed_at is null and created_at > $2::timestamptz - interval '2 hours'`,
      [campaignId, now.toISOString()],
    );
    const capacity = snapshot.concurrency - (inflight[0]?.n ?? 0);
    if (capacity <= 0) return [];

    const { rows: candidates } = await client.query<ClaimedLead>(
      `select cl.id as campaign_lead_id, l.id, l.first_name, l.last_name, l.email, l.company, l.phone_e164,
              l.custom_fields, l.time_zone
         from campaign_leads cl join leads l on l.id = cl.lead_id
        where cl.campaign_id = $1 and cl.state in ('queued', 'retry_wait') and cl.next_attempt_at <= $2
        order by cl.next_attempt_at
        limit $3
        for update of cl skip locked`,
      [campaignId, now.toISOString(), capacity * 5],
    );
    const chosen = candidates
      .filter((l) => {
        const tz = resolveLeadTimeZone({ leadTimeZone: l.time_zone, phoneE164: l.phone_e164, campaignTimeZone: snapshot.time_zone });
        return inCallingWindow(now, tz.timeZone, snapshot.calling_window);
      })
      .slice(0, capacity);

    const placed: PlacedCall[] = [];
    for (const [i, lead] of chosen.entries()) {
      const phone = snapshot.phone_numbers[(Date.now() + i) % snapshot.phone_numbers.length]!;
      await client.query(`update campaign_leads set state = 'dialing', attempts = attempts + 1 where id = $1`, [lead.campaign_lead_id]);
      const { rows } = await client.query<{ id: string }>(
        `insert into calls(organization_id, campaign_id, campaign_version_id, campaign_lead_id, lead_id, phone_number_id, to_number, from_number)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
        [organizationId, campaignId, versionId, lead.campaign_lead_id, lead.id, phone.id, lead.phone_e164, phone.e164],
      );
      await client.query(`update campaign_leads set last_call_id = $2 where id = $1`, [lead.campaign_lead_id, rows[0]!.id]);
      placed.push({ callId: rows[0]!.id, organizationId, versionId, snapshot, lead, phone });
    }
    return placed;
  });
}

/**
 * Builds the per-call assistant (with feature extensions) and dispatches it to Vapi. If Vapi
 * rejects the config, the call is re-sent without optional extensions (booking tools) and the
 * rejection is logged. A call that can't be placed is finalized as failed so the lead is retried.
 */
export async function placeCall(deps: Deps, pipeline: CallPipeline, p: PlacedCall): Promise<void> {
  const log = deps.logger.child({ callId: p.callId });
  const tz = resolveLeadTimeZone({ leadTimeZone: p.lead.time_zone, phoneE164: p.lead.phone_e164, campaignTimeZone: p.snapshot.time_zone });
  const extensions: AssistantExtension[] = [];
  for (const provider of pipeline.extensions) {
    try {
      const ext = await provider({ deps, snapshot: p.snapshot, lead: p.lead, callId: p.callId, organizationId: p.organizationId, leadTimeZone: tz.timeZone });
      if (ext) extensions.push(ext);
    } catch (err) {
      log.error({ err }, 'assistant extension failed; placing call without it');
    }
  }

  const send = async (exts: AssistantExtension[]) => {
    const assistant = buildAssistant({
      snapshot: p.snapshot,
      lead: p.lead,
      callId: p.callId,
      organizationId: p.organizationId,
      config: deps.config,
      extensions: exts,
    });
    const res = await deps.vapi.createCall({
      phoneNumberId: p.phone.vapi_phone_number_id,
      customer: { number: p.lead.phone_e164, name: [p.lead.first_name, p.lead.last_name].filter(Boolean).join(' ') || undefined },
      assistant,
      metadata: { callId: p.callId, organizationId: p.organizationId },
    });
    await deps.db.query(
      `update calls set vapi_call_id = $2, status = 'queued', booking_tools_enabled = $3 where id = $1`,
      [p.callId, res.id, exts.some((e) => e.name === 'appointments')],
    );
    if (res.monitor?.listenUrl || res.monitor?.controlUrl) {
      await deps.db.query(
        `insert into call_monitors(call_id, organization_id, listen_url, control_url) values ($1, $2, $3, $4)
         on conflict (call_id) do update set listen_url = excluded.listen_url, control_url = excluded.control_url`,
        [p.callId, p.organizationId, res.monitor.listenUrl ?? null, res.monitor.controlUrl ?? null],
      );
    }
  };

  try {
    try {
      await send(extensions);
    } catch (err) {
      const optional = extensions.filter((e) => e.optional);
      if (!isVapiValidationError(err) || !optional.length) throw err;
      log.error(
        { err, dropped: optional.map((e) => e.name) },
        'VAPI REJECTED ASSISTANT CONFIG: re-sending call without optional tools (booking disabled for this call)',
      );
      await addCallEvent(deps.db, {
        organizationId: p.organizationId,
        callId: p.callId,
        type: 'system',
        content: `The calling service rejected the ${optional.map((e) => e.name).join(', ')} tools; call placed without them`,
        metadata: { error: (err as Error).message.slice(0, 500) },
      });
      await send(extensions.filter((e) => !e.optional));
    }
  } catch (err) {
    log.error({ err }, 'failed to place call with Vapi');
    await deps.db.query('update calls set error = $2 where id = $1', [p.callId, (err as Error).message.slice(0, 1000)]);
    await handleCallEnded(
      deps,
      pipeline,
      {
        vapiCallId: '',
        endedReason: 'call.start.error-vapi-request-failed',
        startedAt: null,
        endedAt: null,
        durationSeconds: 0,
        recordingUrl: null,
        transcript: null,
        summary: null,
        structuredData: null,
        cost: null,
        source: 'reconcile',
      },
      { callId: p.callId },
    );
  }
}
