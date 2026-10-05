import type { Deps } from '../../deps';
import { UpstreamError } from '../../lib/http';
import { fromVapiCall } from './normalize';
import { handleCallEnded, type CallPipeline } from './pipeline';
import { runPostCallSummary } from './summary';

/**
 * Call reconciliation ("process one batch"). Finalizes calls whose end-of-call webhook never
 * arrived by asking Vapi directly, fails calls that were never dispatched, and retries pending
 * post-call summaries.
 */
export async function reconcileCallsBatch(deps: Deps, pipeline: CallPipeline, limit = 25): Promise<{ processed: number }> {
  let processed = 0;
  const now = deps.clock.now();

  const { rows: open } = await deps.db.query<{ id: string; vapi_call_id: string }>(
    `select id, vapi_call_id from calls
      where end_processed_at is null and vapi_call_id is not null and created_at < $1::timestamptz - interval '3 minutes'
      order by created_at limit $2`,
    [now.toISOString(), limit],
  );
  for (const c of open) {
    try {
      const remote = await deps.vapi.getCall(c.vapi_call_id);
      if (remote.status !== 'ended') continue;
      const r = await handleCallEnded(deps, pipeline, fromVapiCall(remote), { callId: c.id, awaitSummary: true });
      if (r.status === 'processed') {
        processed++;
        deps.logger.warn({ callId: c.id }, 'call finalized by reconciliation (end-of-call webhook missing)');
      }
    } catch (err) {
      if (err instanceof UpstreamError && err.status === 404) {
        await handleCallEnded(
          deps,
          pipeline,
          { ...emptyEnd(c.vapi_call_id), endedReason: 'call.not-found-at-vapi' },
          { callId: c.id },
        );
        processed++;
      } else deps.logger.error({ err, callId: c.id }, 'call reconciliation failed');
    }
  }

  // Calls we created but never handed to Vapi (crash between insert and dispatch).
  const { rows: stuck } = await deps.db.query<{ id: string }>(
    `select id from calls where end_processed_at is null and vapi_call_id is null
        and created_at < $1::timestamptz - interval '10 minutes' order by created_at limit $2`,
    [now.toISOString(), limit],
  );
  for (const c of stuck) {
    await handleCallEnded(deps, pipeline, { ...emptyEnd(''), endedReason: 'call.start.error-not-dispatched' }, { callId: c.id });
    processed++;
  }

  const { rows: pending } = await deps.db.query<{ id: string }>(
    `select id from calls where summary_processed_at is null and end_processed_at < $1::timestamptz - interval '2 minutes'
      order by end_processed_at limit 10`,
    [now.toISOString()],
  );
  for (const c of pending) {
    await runPostCallSummary(deps, c.id, pipeline.summarySteps).catch((err) =>
      deps.logger.error({ err, callId: c.id }, 'post-call summary retry failed'),
    );
  }
  return { processed };
}

function emptyEnd(vapiCallId: string) {
  return {
    vapiCallId,
    endedReason: null,
    startedAt: null,
    endedAt: null,
    durationSeconds: null,
    recordingUrl: null,
    transcript: null,
    summary: null,
    structuredData: null,
    cost: null,
    source: 'reconcile' as const,
  };
}
