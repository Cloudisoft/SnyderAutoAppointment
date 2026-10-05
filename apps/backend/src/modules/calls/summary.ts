import type pg from 'pg';
import { withTx } from '../../db/pool';
import type { Deps } from '../../deps';
import type { CallExtraction } from '../../integrations/openai';

/** Hooks that act on the post-call extraction (e.g. transcript fallback for appointments). */
export interface SummaryStep {
  name: string;
  run(client: pg.PoolClient, deps: Deps, callId: string, extraction: CallExtraction): Promise<void>;
}

/**
 * Post-call summary step (OpenAI). Runs once per ended, connected call with a transcript.
 * Idempotent via calls.summary_processed_at; the reconciliation job retries pending ones.
 */
export async function runPostCallSummary(deps: Deps, callId: string, steps: SummaryStep[] = []): Promise<'done' | 'skipped'> {
  const { rows } = await deps.db.query<{
    transcript: string | null;
    connected: boolean;
    summary_processed_at: Date | null;
    organization_id: string;
    time_zone: string;
  }>(
    `select c.transcript, c.connected, c.summary_processed_at, c.organization_id,
            coalesce(v.snapshot->>'time_zone', o.time_zone) as time_zone
       from calls c
       join organizations o on o.id = c.organization_id
       left join campaign_versions v on v.id = c.campaign_version_id
      where c.id = $1 and c.end_processed_at is not null`,
    [callId],
  );
  const call = rows[0];
  if (!call || call.summary_processed_at) return 'skipped';
  if (!call.connected || !call.transcript?.trim() || !deps.openai.enabled) {
    await deps.db.query('update calls set summary_processed_at = now() where id = $1 and summary_processed_at is null', [callId]);
    return 'skipped';
  }
  const extraction = await deps.openai.extractCall({
    transcript: call.transcript,
    nowIso: deps.clock.now().toISOString(),
    timeZone: call.time_zone,
  });
  await withTx(deps.db, async (client) => {
    const locked = await client.query(
      'select 1 from calls where id = $1 and summary_processed_at is null for update',
      [callId],
    );
    if (!locked.rowCount) return;
    await client.query(
      `update calls set summary = coalesce(nullif(summary, ''), $2), analysis = analysis || jsonb_build_object('extraction', $3::jsonb),
              summary_processed_at = now()
        where id = $1`,
      [callId, extraction.summary, JSON.stringify(extraction)],
    );
    for (const step of steps) await step.run(client, deps, callId, extraction);
  });
  return 'done';
}
