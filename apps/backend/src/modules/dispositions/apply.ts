import { TERMINAL_LEAD_STATUSES } from '@snyder/shared';
import type pg from 'pg';
import type { CallRow } from '../calls/types';
import { pickDisposition, type DispositionFacts, type DispositionRule } from './engine';

/** Lead statuses a later disposition must never overwrite (e.g. a DNC request). */
const STICKY_LEAD_STATUSES = ['do_not_call'];

export async function loadDispositionRules(client: pg.PoolClient | pg.Pool, organizationId: string): Promise<DispositionRule[]> {
  const { rows } = await client.query<DispositionRule>(
    `select key, label, priority, conditions, lead_status, retry, is_active
       from dispositions where organization_id = $1 order by priority`,
    [organizationId],
  );
  return rows;
}

/**
 * Picks the disposition for an ended call and applies it: call.disposition_key, lead status,
 * and the campaign lead's retry/done state. Runs inside the end-of-call transaction.
 */
export async function applyDisposition(
  client: pg.PoolClient,
  call: CallRow,
  facts: DispositionFacts,
): Promise<DispositionRule | null> {
  const rules = await loadDispositionRules(client, call.organization_id);
  const rule = pickDisposition(rules, facts);
  if (!rule) return null;

  await client.query('update calls set disposition_key = $2 where id = $1', [call.id, rule.key]);

  let leadStatus: string | null = null;
  if (call.lead_id) {
    const { rows } = await client.query<{ status: string }>(
      `update leads set
         status = case when status = any($3::text[]) or $2::text is null then status else $2 end,
         last_disposition = $4
       where id = $1 returning status`,
      [call.lead_id, rule.lead_status, STICKY_LEAD_STATUSES, rule.key],
    );
    leadStatus = rows[0]?.status ?? null;
  }

  if (call.campaign_lead_id) {
    const { rows } = await client.query<{ max_attempts: number; retry_delay_minutes: number }>(
      `select coalesce((v.snapshot->>'max_attempts')::int, 3) as max_attempts,
              coalesce((v.snapshot->>'retry_delay_minutes')::int, 240) as retry_delay_minutes
         from calls c left join campaign_versions v on v.id = c.campaign_version_id where c.id = $1`,
      [call.id],
    );
    const cfg = rows[0] ?? { max_attempts: 3, retry_delay_minutes: 240 };
    const terminal = leadStatus !== null && (TERMINAL_LEAD_STATUSES as string[]).includes(leadStatus);
    await client.query(
      `update campaign_leads set
         state = case when not $2::boolean and attempts < $3 then 'retry_wait' else 'done' end,
         next_attempt_at = now() + make_interval(mins => $4),
         last_disposition = $5,
         last_call_id = $6
       where id = $1 and state <> 'removed'`,
      [call.campaign_lead_id, terminal || !rule.retry, cfg.max_attempts, cfg.retry_delay_minutes, rule.key, call.id],
    );
  }
  return rule;
}
