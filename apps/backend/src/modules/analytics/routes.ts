import type { FastifyInstance } from 'fastify';
import { DateTime } from 'luxon';
import { z } from 'zod';
import type { Deps } from '../../deps';
import { authenticate, authOf, requirePermission } from '../../plugins/auth';

export interface RollupRow {
  day: string;
  campaign_id: string | null;
  calls: number;
  connected: number;
  voicemail: number;
  talk_seconds: number;
  [k: string]: unknown;
}

export async function loadRollup(deps: Deps, organizationId: string, from: Date, to: Date, campaignId?: string): Promise<RollupRow[]> {
  const { rows } = await deps.db.query<RollupRow & { day_key: string }>(
    `select r.*, to_char(r.day, 'YYYY-MM-DD') as day_key from analytics_rollup($1, $2, $3) r
      where ($4::uuid is null or r.campaign_id = $4) order by r.day`,
    [organizationId, from.toISOString(), to.toISOString(), campaignId ?? null],
  );
  return rows.map(({ day_key, ...r }) => ({ ...r, day: day_key }));
}

/** Sums every numeric column across roll-up rows. */
export function totals(rows: RollupRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    for (const [k, v] of Object.entries(r)) if (typeof v === 'number') out[k] = (out[k] ?? 0) + v;
  }
  return out;
}

export async function registerAnalyticsRoutes(app: FastifyInstance, deps: Deps) {
  const auth = authenticate(deps);
  app.get('/api/dashboard', { preHandler: [auth, requirePermission('dashboard.view')] }, async (req) => {
    const { organizationId } = authOf(req);
    const q = z
      .object({ days: z.coerce.number().int().min(1).max(365).default(30), campaign_id: z.string().uuid().optional() })
      .parse(req.query);
    const to = DateTime.fromJSDate(deps.clock.now()).plus({ minutes: 1 }).toJSDate();
    const from = DateTime.fromJSDate(to).minus({ days: q.days }).startOf('day').toJSDate();
    const rows = await loadRollup(deps, organizationId, from, to, q.campaign_id);
    const t = totals(rows);
    const byDay = new Map<string, Record<string, number>>();
    for (const r of rows) {
      const d = byDay.get(r.day) ?? {};
      for (const [k, v] of Object.entries(r)) if (typeof v === 'number') d[k] = (d[k] ?? 0) + v;
      byDay.set(r.day, d);
    }
    const { rows: dispositions } = await deps.db.query(
      `select coalesce(d.label, c.disposition_key, 'In progress') as label, c.disposition_key as key, count(*)::int as n
         from calls c left join dispositions d on d.organization_id = c.organization_id and d.key = c.disposition_key
        where c.organization_id = $1 and c.created_at >= $2 and c.created_at < $3 and ($4::uuid is null or c.campaign_id = $4)
        group by 1, 2 order by n desc`,
      [organizationId, from.toISOString(), to.toISOString(), q.campaign_id ?? null],
    );
    const calls = t.calls ?? 0;
    const connected = t.connected ?? 0;
    return {
      range: { from: from.toISOString(), to: to.toISOString() },
      kpis: {
        calls,
        connected,
        connect_rate: calls ? connected / calls : 0,
        avg_talk_seconds: connected ? Math.round((t.talk_seconds ?? 0) / connected) : 0,
        ...extraKpis(t),
      },
      daily: [...byDay.entries()].map(([day, v]) => ({ day, ...v })),
      dispositions,
    };
  });
}

/** Feature KPIs derived from roll-up totals (extended by the appointments feature). */
export function extraKpis(t: Record<string, number>): Record<string, number> {
  const booked = t.appointments_booked ?? 0;
  const completed = t.appointments_completed ?? 0;
  const noShow = t.appointments_no_show ?? 0;
  return {
    appointments_booked: booked,
    appointments_completed: completed,
    appointments_no_show: noShow,
    // -1 means "no attended/no-show appointments yet".
    show_rate: completed + noShow ? completed / (completed + noShow) : -1,
    booked_per_100_connected: t.connected ? (booked / t.connected) * 100 : 0,
  };
}
