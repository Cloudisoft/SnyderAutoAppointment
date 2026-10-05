import { z } from 'zod';
import { withTx, type Db, type DbClient } from '../../db/pool';
import { badRequest, notFound } from '../../lib/errors';
import { searchTerms } from './routes';

/** Statuses an admin may set in bulk (dialer-owned states like queued/in_progress are excluded). */
export const BULK_LEAD_STATUSES = ['new', 'callback', 'contacted', 'not_interested', 'do_not_call', 'bad_number', 'completed'] as const;

/** Leads are chosen either by explicit ids or by the same filters as the leads list ("select all matching"). */
const Selection = z
  .object({
    ids: z.array(z.string().uuid()).max(50_000).optional(),
    filter: z
      .object({ list_id: z.string().uuid().optional(), status: z.string().optional(), q: z.string().optional() })
      .optional(),
  })
  .refine((s) => (s.ids && s.ids.length > 0) || s.filter, 'Select at least one lead');

export const LeadBulkInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('delete'), selection: Selection }),
  z.object({ action: z.literal('move_to_list'), selection: Selection, lead_list_id: z.string().uuid() }),
  z.object({ action: z.literal('remove_from_list'), selection: Selection }),
  z.object({ action: z.literal('set_status'), selection: Selection, status: z.enum(BULK_LEAD_STATUSES) }),
  z.object({ action: z.literal('add_to_campaign'), selection: Selection, campaign_id: z.string().uuid() }),
  z.object({ action: z.literal('remove_from_campaign'), selection: Selection, campaign_id: z.string().uuid() }),
]);
export type LeadBulkInput = z.infer<typeof LeadBulkInput>;

export interface BulkResult {
  affected: number;
  skipped: number;
  message: string;
}

/** Resolves the selection to lead ids inside the organization. */
async function selectedIds(c: DbClient, organizationId: string, sel: z.infer<typeof Selection>): Promise<string[]> {
  if (sel.ids?.length) {
    const { rows } = await c.query<{ id: string }>('select id from leads where organization_id = $1 and id = any($2::uuid[])', [
      organizationId,
      sel.ids,
    ]);
    return rows.map((r) => r.id);
  }
  const f = sel.filter ?? {};
  const s = searchTerms(f.q);
  const { rows } = await c.query<{ id: string }>(
    `select l.id from leads l
      where l.organization_id = $1
        and ($2::uuid is null or l.lead_list_id = $2)
        and ($3::text is null or l.status = $3)
        and ($4::text is null
             or (coalesce(l.first_name, '') || ' ' || coalesce(l.last_name, '')) ilike $4
             or l.email ilike $4
             or ($5::text is not null and l.phone_digits like '%' || $5 || '%'))`,
    [organizationId, f.list_id ?? null, f.status || null, s.text, s.digits],
  );
  return rows.map((r) => r.id);
}

/** Leads with a call still in flight are never deleted or re-statused underneath the dialer. */
async function busyIds(c: DbClient, ids: string[]): Promise<Set<string>> {
  const { rows } = await c.query<{ lead_id: string }>(
    `select distinct lead_id from calls
      where lead_id = any($1::uuid[]) and end_processed_at is null and created_at > now() - interval '2 hours'`,
    [ids],
  );
  return new Set(rows.map((r) => r.lead_id));
}

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

export async function runLeadBulk(db: Db, organizationId: string, input: LeadBulkInput): Promise<BulkResult> {
  return withTx(db, async (c) => {
    const all = await selectedIds(c, organizationId, input.selection);
    if (!all.length) return { affected: 0, skipped: 0, message: 'No leads matched the selection' };

    switch (input.action) {
      case 'delete': {
        const busy = await busyIds(c, all);
        const ids = all.filter((id) => !busy.has(id));
        const { rowCount } = await c.query('delete from leads where organization_id = $1 and id = any($2::uuid[])', [organizationId, ids]);
        const n = rowCount ?? 0;
        return { affected: n, skipped: all.length - n, message: `Deleted ${plural(n, 'lead')}${busy.size ? `; ${busy.size} on a live call were kept` : ''}` };
      }
      case 'move_to_list': {
        const list = await c.query<{ name: string }>('select name from lead_lists where id = $1 and organization_id = $2', [input.lead_list_id, organizationId]);
        if (!list.rows[0]) throw notFound('Lead list not found');
        const { rowCount } = await c.query('update leads set lead_list_id = $3 where organization_id = $1 and id = any($2::uuid[])', [organizationId, all, input.lead_list_id]);
        return { affected: rowCount ?? 0, skipped: 0, message: `Moved ${plural(rowCount ?? 0, 'lead')} to ${list.rows[0].name}` };
      }
      case 'remove_from_list': {
        const { rowCount } = await c.query(
          'update leads set lead_list_id = null where organization_id = $1 and id = any($2::uuid[]) and lead_list_id is not null',
          [organizationId, all],
        );
        const n = rowCount ?? 0;
        return { affected: n, skipped: all.length - n, message: `Removed ${plural(n, 'lead')} from their list` };
      }
      case 'set_status': {
        const busy = await busyIds(c, all);
        const ids = all.filter((id) => !busy.has(id));
        const { rowCount } = await c.query('update leads set status = $3 where organization_id = $1 and id = any($2::uuid[])', [organizationId, ids, input.status]);
        if (input.status === 'do_not_call') {
          await c.query(
            `insert into dnc_numbers(organization_id, phone_e164, source)
             select $1, phone_e164, 'bulk' from leads where organization_id = $1 and id = any($2::uuid[])
             on conflict (organization_id, phone_e164) do nothing`,
            [organizationId, ids],
          );
        }
        if ((['do_not_call', 'bad_number', 'not_interested', 'completed'] as string[]).includes(input.status)) {
          // Terminal statuses stop any queued dialing for these leads.
          await c.query(
            `update campaign_leads set state = 'removed' where organization_id = $1 and lead_id = any($2::uuid[]) and state in ('queued', 'retry_wait')`,
            [organizationId, ids],
          );
        }
        const n = rowCount ?? 0;
        return { affected: n, skipped: all.length - n, message: `Updated ${plural(n, 'lead')}${busy.size ? `; ${busy.size} on a live call were skipped` : ''}` };
      }
      case 'add_to_campaign': {
        const camp = await c.query<{ name: string }>('select name from campaigns where id = $1 and organization_id = $2', [input.campaign_id, organizationId]);
        if (!camp.rows[0]) throw notFound('Campaign not found');
        const { rowCount } = await c.query(
          `insert into campaign_leads(organization_id, campaign_id, lead_id)
           select $1, $2, l.id from leads l
            where l.organization_id = $1 and l.id = any($3::uuid[])
              and l.status not in ('do_not_call', 'bad_number', 'not_interested', 'completed')
              and not exists (select 1 from dnc_numbers d where d.organization_id = $1 and d.phone_e164 = l.phone_e164)
           on conflict (campaign_id, lead_id) do update set state = 'queued', next_attempt_at = now()
             where campaign_leads.state = 'removed'`,
          [organizationId, input.campaign_id, all],
        );
        const n = rowCount ?? 0;
        const skipped = all.length - n;
        return {
          affected: n,
          skipped,
          message: `Added ${plural(n, 'lead')} to ${camp.rows[0].name}${skipped ? `; ${skipped} skipped (already in it, do-not-call or closed)` : ''}`,
        };
      }
      case 'remove_from_campaign': {
        const camp = await c.query('select 1 from campaigns where id = $1 and organization_id = $2', [input.campaign_id, organizationId]);
        if (!camp.rowCount) throw notFound('Campaign not found');
        const { rowCount } = await c.query(
          `update campaign_leads set state = 'removed'
            where organization_id = $1 and campaign_id = $2 and lead_id = any($3::uuid[]) and state in ('queued', 'retry_wait')`,
          [organizationId, input.campaign_id, all],
        );
        const n = rowCount ?? 0;
        return { affected: n, skipped: all.length - n, message: `Removed ${plural(n, 'lead')} from the campaign${all.length - n ? `; ${all.length - n} were not queued in it` : ''}` };
      }
    }
    throw badRequest('Unknown action');
  });
}
