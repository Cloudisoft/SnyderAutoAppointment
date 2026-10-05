import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../../deps';
import { notFound } from '../../lib/errors';
import { authenticate, authOf, requirePermission } from '../../plugins/auth';
import { searchTerms } from '../leads/routes';

export async function registerCallRoutes(app: FastifyInstance, deps: Deps) {
  const { db } = deps;
  const auth = authenticate(deps);

  // Call detail records (CDR).
  app.get('/api/calls', { preHandler: [auth, requirePermission('calls.view')] }, async (req) => {
    const { organizationId } = authOf(req);
    const q = z
      .object({
        campaign_id: z.string().uuid().optional(),
        disposition: z.string().optional(),
        q: z.string().optional(),
        from: z.string().datetime({ offset: true }).optional(),
        to: z.string().datetime({ offset: true }).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .parse(req.query);
    const s = searchTerms(q.q);
    const { rows } = await db.query(
      `select c.id, c.created_at, c.started_at, c.ended_at, c.duration_seconds, c.status, c.ended_reason, c.connected,
              c.disposition_key, d.label as disposition_label, c.to_number, c.from_number, c.campaign_id, cp.name as campaign_name,
              c.lead_id, l.first_name, l.last_name, l.email,
              count(*) over()::int as total_count
         from calls c
         left join leads l on l.id = c.lead_id
         left join campaigns cp on cp.id = c.campaign_id
         left join dispositions d on d.organization_id = c.organization_id and d.key = c.disposition_key
        where c.organization_id = $1
          and ($2::uuid is null or c.campaign_id = $2)
          and ($3::text is null or c.disposition_key = $3)
          and ($4::timestamptz is null or c.created_at >= $4)
          and ($5::timestamptz is null or c.created_at < $5)
          and ($6::text is null
               or (coalesce(l.first_name,'') || ' ' || coalesce(l.last_name,'')) ilike $6 or l.email ilike $6
               or ($7::text is not null and regexp_replace(c.to_number, '\\D', '', 'g') like '%' || $7 || '%'))
        order by c.created_at desc limit $8 offset $9`,
      [organizationId, q.campaign_id ?? null, q.disposition ?? null, q.from ?? null, q.to ?? null, s.text, s.digits, q.limit, q.offset],
    );
    return { rows: rows.map(({ total_count: _t, ...r }) => r), total: rows[0]?.total_count ?? 0 };
  });

  app.get('/api/calls/:id', { preHandler: [auth, requirePermission('calls.view')] }, async (req) => {
    const { organizationId } = authOf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { rows } = await db.query(
      `select c.*, d.label as disposition_label, cp.name as campaign_name, v.version as campaign_version,
              l.first_name, l.last_name, l.email, l.phone_e164, l.status as lead_status
         from calls c
         left join leads l on l.id = c.lead_id
         left join campaigns cp on cp.id = c.campaign_id
         left join campaign_versions v on v.id = c.campaign_version_id
         left join dispositions d on d.organization_id = c.organization_id and d.key = c.disposition_key
        where c.id = $1 and c.organization_id = $2`,
      [id, organizationId],
    );
    if (!rows[0]) throw notFound();
    const events = await db.query(
      'select id, type, role, content, metadata, created_at from call_events where call_id = $1 order by id',
      [id],
    );
    return { ...rows[0], events: events.rows };
  });

  // Live monitor: calls currently in flight, with their latest transcript lines.
  app.get('/api/monitor/live', { preHandler: [auth, requirePermission('monitor.view')] }, async (req) => {
    const { organizationId } = authOf(req);
    const { rows } = await db.query(
      `select c.id, c.status, c.started_at, c.created_at, c.to_number, c.campaign_id, cp.name as campaign_name,
              l.first_name, l.last_name
         from calls c
         left join leads l on l.id = c.lead_id
         left join campaigns cp on cp.id = c.campaign_id
        where c.organization_id = $1 and c.end_processed_at is null and c.created_at > now() - interval '2 hours'
        order by c.created_at desc limit 100`,
      [organizationId],
    );
    return rows;
  });

  app.get('/api/monitor/calls/:id/events', { preHandler: [auth, requirePermission('monitor.view')] }, async (req) => {
    const { organizationId } = authOf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { rows } = await db.query(
      `select e.id, e.type, e.role, e.content, e.metadata, e.created_at
         from call_events e where e.call_id = $1 and e.organization_id = $2 order by e.id`,
      [id, organizationId],
    );
    return rows;
  });

  app.get('/api/dispositions', { preHandler: [auth] }, async (req) => {
    const { organizationId } = authOf(req);
    const { rows } = await db.query(
      'select id, key, label, priority, conditions, lead_status, retry, is_system, is_active from dispositions where organization_id = $1 order by priority',
      [organizationId],
    );
    return rows;
  });

  app.patch('/api/dispositions/:id', { preHandler: [auth, requirePermission('settings.manage')] }, async (req) => {
    const { organizationId } = authOf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({ label: z.string().trim().min(1).optional(), priority: z.number().int().optional(), retry: z.boolean().optional(), is_active: z.boolean().optional() })
      .parse(req.body);
    const { rows } = await db.query(
      `update dispositions set label = coalesce($3, label), priority = coalesce($4, priority), retry = coalesce($5, retry),
              is_active = coalesce($6, is_active)
        where id = $1 and organization_id = $2 returning *`,
      [id, organizationId, body.label ?? null, body.priority ?? null, body.retry ?? null, body.is_active ?? null],
    );
    if (!rows[0]) throw notFound();
    return rows[0];
  });
}
