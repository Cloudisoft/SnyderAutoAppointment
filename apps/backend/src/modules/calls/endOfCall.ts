import type pg from 'pg';
import { withTx } from '../../db/pool';
import type { Deps } from '../../deps';
import { applyDisposition } from '../dispositions/apply';
import { addCallEvent } from './events';
import { classifyOutcome, type CallOutcome } from './outcome';
import type { CallEndData, CallRow } from './types';

export type CallEndResult =
  | { status: 'unknown_call' }
  | { status: 'duplicate'; callId: string }
  | { status: 'processed'; callId: string; outcome: CallOutcome; dispositionKey: string | null };

/** Steps contributed by feature modules that run inside the end-of-call transaction. */
export interface CallEndStep {
  name: string;
  /** Returns facts to merge into the disposition decision (e.g. appointmentBooked). */
  run(client: pg.PoolClient, deps: Deps, call: CallRow, outcome: CallOutcome): Promise<{ appointmentBooked?: boolean }>;
  /** Runs after commit (e.g. sending email); failures are logged, never rethrown. */
  afterCommit?(deps: Deps, call: CallRow, outcome: CallOutcome): Promise<void>;
}

async function lockCall(client: pg.PoolClient, by: { callId?: string; vapiCallId?: string }): Promise<CallRow | null> {
  const { rows } = await client.query<CallRow>(
    `select * from calls where ($1::uuid is not null and id = $1::uuid) or ($2::text is not null and vapi_call_id = $2)
      limit 1 for update`,
    [by.callId ?? null, by.vapiCallId || null],
  );
  return rows[0] ?? null;
}

/**
 * Finalizes an ended call exactly once: stores the report, classifies the outcome, runs feature
 * steps (appointment confirmation), applies the disposition and lead status. Used by both the
 * end-of-call webhook and the reconciliation job, so a lost webhook still finalizes the call.
 */
export async function processCallEnded(
  deps: Deps,
  data: CallEndData,
  opts: { callId?: string; steps?: CallEndStep[] } = {},
): Promise<CallEndResult> {
  const steps = opts.steps ?? [];
  const result = await withTx(deps.db, async (client): Promise<CallEndResult & { call?: CallRow }> => {
    const call = await lockCall(client, { callId: opts.callId, vapiCallId: data.vapiCallId });
    if (!call) return { status: 'unknown_call' };
    if (call.end_processed_at) return { status: 'duplicate', callId: call.id };

    const outcome = classifyOutcome({
      endedReason: data.endedReason,
      startedAt: data.startedAt ?? call.started_at,
      endedAt: data.endedAt,
      durationSeconds: data.durationSeconds,
      dncRequested: call.dnc_requested,
    });
    await client.query(
      `update calls set
         status = case when $2::boolean then 'failed' else 'ended' end,
         ended_reason = $3, started_at = coalesce($4::timestamptz, started_at), ended_at = coalesce($5::timestamptz, now()),
         duration_seconds = $6, recording_url = coalesce($7, recording_url), transcript = coalesce($8, transcript),
         summary = coalesce($9, summary), analysis = analysis || jsonb_build_object('structured', $10::jsonb),
         cost = coalesce($11, cost), connected = $12, voicemail = $13, transferred = $14,
         end_processed_at = now()
       where id = $1`,
      [
        call.id,
        outcome.failed,
        data.endedReason,
        data.startedAt,
        data.endedAt,
        outcome.durationSeconds,
        data.recordingUrl,
        data.transcript,
        data.summary,
        JSON.stringify(data.structuredData ?? null),
        data.cost,
        outcome.connected,
        outcome.voicemail,
        outcome.transferred,
      ],
    );

    let appointmentBooked = false;
    for (const step of steps) {
      const r = await step.run(client, deps, call, outcome);
      appointmentBooked ||= !!r.appointmentBooked;
    }

    const rule = await applyDisposition(client, call, { ...outcome, appointmentBooked });
    await addCallEvent(client, {
      organizationId: call.organization_id,
      callId: call.id,
      type: 'status',
      content: 'ended',
      metadata: { endedReason: data.endedReason, disposition: rule?.key ?? null, source: data.source },
    });
    return { status: 'processed', callId: call.id, outcome, dispositionKey: rule?.key ?? null, call };
  });

  if (result.status === 'processed' && result.call) {
    for (const step of steps) {
      if (!step.afterCommit) continue;
      await step.afterCommit(deps, result.call, result.outcome).catch((err) =>
        deps.logger.error({ err, step: step.name, callId: result.callId }, 'end-of-call afterCommit step failed'),
      );
    }
    const { call: _c, ...rest } = result;
    return rest;
  }
  if (result.status === 'duplicate') deps.logger.info({ callId: result.callId }, 'duplicate end-of-call ignored');
  return result.status === 'processed' ? { status: 'processed', callId: result.callId, outcome: result.outcome, dispositionKey: result.dispositionKey } : result;
}
