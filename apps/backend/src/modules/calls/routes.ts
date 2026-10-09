import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../../deps';
import { badRequest, notFound } from '../../lib/errors';
import { toE164 } from '../../lib/phone';
import { getMonitor, sendControl, transferNumberFor } from './liveControl';
import { authenticate, authOf, requirePermission } from '../../plugins/auth';
import { neutralize } from '../../lib/http';
import { sendTableExport, type ExportColumn } from '../../lib/tableExport';
import type { Db } from '../../db/pool';
import { searchTerms } from '../leads/routes';

const EXPORT_MAX_ROWS = 10_000;

const CallQuery = z.object({
  campaign_id: z.string().uuid().optional(),
  disposition: z.string().optional(),
  q: z.string().optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  /** Comma-separated call ids, to export just a selection. */
  ids: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').filter(Boolean) : undefined))
    .pipe(z.array(z.string().uuid()).max(1000).optional()),
});
type CallFilters = z.infer<typeof CallQuery>;
type CallRow = Record<string, unknown> & {
  total_count?: number;
  appointment?: { status?: string; starts_at?: string } | null;
  cost?: string | number | null;
};

async function listCalls(db: Db, organizationId: string, q: CallFilters, page: { limit: number; offset: number }): Promise<CallRow[]> {
  const s = searchTerms(q.q);
  const { rows } = await db.query(
    `select c.id, c.created_at, c.started_at, c.ended_at, c.duration_seconds, c.status, c.ended_reason, c.connected,
            c.voicemail, c.transferred, c.dnc_requested, c.cost, c.recording_url, c.transcript, c.summary,
            c.disposition_key, d.label as disposition_label, c.to_number, c.from_number, c.campaign_id, cp.name as campaign_name,
            c.lead_id, l.first_name, l.last_name, l.email, l.company,
            (select json_build_object('id', a.id, 'status', a.status, 'starts_at', a.starts_at, 'lead_time_zone', a.lead_time_zone)
               from appointments a where a.call_id = c.id and a.status <> 'cancelled' order by a.created_at desc limit 1) as appointment,
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
        and ($10::uuid[] is null or c.id = any($10))
        and ($6::text is null
             or (coalesce(l.first_name,'') || ' ' || coalesce(l.last_name,'')) ilike $6 or l.email ilike $6
             or ($7::text is not null and regexp_replace(c.to_number, '\\D', '', 'g') like '%' || $7 || '%'))
      order by c.created_at desc limit $8 offset $9`,
    [organizationId, q.campaign_id ?? null, q.disposition ?? null, q.from ?? null, q.to ?? null, s.text, s.digits, page.limit, page.offset, q.ids ?? null],
  );
  return rows;
}

const yesNo = (v: unknown) => (v ? 'yes' : 'no');
const CALL_EXPORT_COLUMNS: ExportColumn<CallRow>[] = [
  ['Call ID', (r) => r.id],
  ['Created at', (r) => r.created_at],
  ['Started at', (r) => r.started_at],
  ['Ended at', (r) => r.ended_at],
  ['Duration (s)', (r) => r.duration_seconds],
  ['First name', (r) => r.first_name],
  ['Last name', (r) => r.last_name],
  ['Email', (r) => r.email],
  ['Company', (r) => r.company],
  ['To number', (r) => r.to_number],
  ['From number', (r) => r.from_number],
  ['Campaign', (r) => r.campaign_name],
  ['Status', (r) => r.status],
  ['Connected', (r) => yesNo(r.connected)],
  ['Voicemail', (r) => yesNo(r.voicemail)],
  ['Transferred', (r) => yesNo(r.transferred)],
  ['Do not call requested', (r) => yesNo(r.dnc_requested)],
  ['Ended reason', (r) => (typeof r.ended_reason === 'string' ? neutralize(r.ended_reason) : null)],
  ['Disposition', (r) => r.disposition_label ?? r.disposition_key],
  ['Appointment status', (r) => r.appointment?.status],
  ['Appointment start (UTC)', (r) => r.appointment?.starts_at],
  ['Cost (USD)', (r) => (r.cost == null ? null : Number(r.cost))],
  ['Summary', (r) => r.summary],
  ['Recording URL', (r) => r.recording_url],
  ['Transcript', (r) => r.transcript],
];

export async function registerCallRoutes(app: FastifyInstance, deps: Deps) {
  const { db } = deps;
  const auth = authenticate(deps);

  // Call detail records (CDR).
  app.get('/api/calls', { preHandler: [auth, requirePermission('calls.view')] }, async (req) => {
    const { organizationId } = authOf(req);
    const q = CallQuery.parse(req.query);
    const rows = await listCalls(db, organizationId, q, { limit: q.limit, offset: q.offset });
    return { rows: rows.map(({ total_count: _t, transcript: _tr, summary: _s, recording_url: _r, ...r }) => r), total: rows[0]?.total_count ?? 0 };
  });

  // CDR download with the same filters as the list: recordings, transcripts and summaries included.
  app.get('/api/calls/export', { preHandler: [auth, requirePermission('calls.view')] }, async (req, reply) => {
    const { organizationId } = authOf(req);
    const q = CallQuery.extend({ format: z.enum(['csv', 'xlsx']).default('csv') }).parse(req.query);
    const rows = await listCalls(db, organizationId, q, { limit: EXPORT_MAX_ROWS, offset: 0 });
    return sendTableExport(reply, { format: q.format, name: 'call-records', sheet: 'Calls', columns: CALL_EXPORT_COLUMNS, rows, now: deps.clock.now() });
  });

  // Deletes finished call records (with their transcripts/events). Calls still in flight are kept.
  app.post('/api/calls/bulk-delete', { preHandler: [auth, requirePermission('calls.manage')] }, async (req) => {
    const { organizationId } = authOf(req);
    const body = z.object({ ids: z.array(z.string().uuid()).min(1).max(5000) }).parse(req.body);
    const { rowCount } = await db.query(
      `delete from calls where organization_id = $1 and id = any($2::uuid[])
          and (end_processed_at is not null or status in ('ended', 'failed') or created_at < now() - interval '2 hours')`,
      [organizationId, body.ids],
    );
    const n = rowCount ?? 0;
    const kept = body.ids.length - n;
    return { affected: n, skipped: kept, message: `Deleted ${n} call record${n === 1 ? '' : 's'}${kept ? `; ${kept} still live or not found were kept` : ''}` };
  });

  app.get('/api/calls/:id', { preHandler: [auth, requirePermission('calls.view')] }, async (req) => {
    const { organizationId } = authOf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { rows } = await db.query(
      `select c.*, d.label as disposition_label, cp.name as campaign_name, v.version as campaign_version,
              l.first_name, l.last_name, l.email, l.phone_e164, l.status as lead_status,
              (select json_build_object('id', a.id, 'status', a.status, 'starts_at', a.starts_at, 'lead_time_zone', a.lead_time_zone)
                 from appointments a where a.call_id = c.id and a.status <> 'cancelled' order by a.created_at desc limit 1) as appointment
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
              l.first_name, l.last_name, c.transferred,
              exists (select 1 from call_monitors m where m.call_id = c.id and m.listen_url is not null) as can_listen,
              exists (select 1 from call_monitors m where m.call_id = c.id and m.control_url is not null) as can_control,
              (select v.snapshot->'agent'->>'transfer_number' from campaign_versions v where v.id = c.campaign_version_id) as transfer_number
         from calls c
         left join leads l on l.id = c.lead_id
         left join campaigns cp on cp.id = c.campaign_id
        where c.organization_id = $1 and c.end_processed_at is null and c.created_at > now() - interval '2 hours'
        order by c.created_at desc limit 100`,
      [organizationId],
    );
    return rows;
  });

  // Live listen: the audio stream link for a call in progress (never stored client-side).
  app.get('/api/monitor/calls/:id/listen', { preHandler: [auth, requirePermission('monitor.control')] }, async (req) => {
    const { organizationId } = authOf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const monitor = await getMonitor(deps, id, organizationId);
    if (!monitor?.listen_url) throw notFound('Live listening is not available for this call (it may have ended).');
    return { listenUrl: monitor.listen_url };
  });

  // Supervisor controls on a live call: speak a line, transfer to a person, or hang up.
  app.post('/api/monitor/calls/:id/control', { preHandler: [auth, requirePermission('monitor.control')] }, async (req) => {
    const { organizationId } = authOf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .discriminatedUnion('action', [
        z.object({ action: z.literal('say'), content: z.string().trim().min(1).max(500) }),
        z.object({ action: z.literal('end') }),
        z.object({ action: z.literal('transfer'), number: z.string().max(30).optional() }),
      ])
      .parse(req.body);
    const monitor = await getMonitor(deps, id, organizationId);
    if (!monitor?.control_url) throw notFound('This call is no longer live.');
    if (body.action === 'say') {
      await sendControl(deps, monitor, { type: 'say', content: body.content }, `supervisor said: ${body.content}`);
    } else if (body.action === 'end') {
      await sendControl(deps, monitor, { type: 'end-call' }, 'supervisor ended the call');
    } else {
      const raw = body.number?.trim() || (await transferNumberFor(deps, id));
      const number = raw ? toE164(raw) : null;
      if (!number) throw badRequest('Enter a valid phone number to transfer to (or set a live transfer number on the agent).');
      await sendControl(
        deps,
        monitor,
        { type: 'transfer', destination: { type: 'number', number }, content: 'One moment while I connect you.' },
        `supervisor transferred the call to ${number}`,
      );
      await db.query('update calls set transferred = true where id = $1', [id]);
    }
    return { ok: true };
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
