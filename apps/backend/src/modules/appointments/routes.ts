import { APPOINTMENT_STATUSES } from '@snyder/shared';
import ExcelJS from 'exceljs';
import type { FastifyInstance } from 'fastify';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { isPgError, PG, withTx } from '../../db/pool';
import type { Deps } from '../../deps';
import { toCsv } from '../../lib/csv';
import { conflict, notFound } from '../../lib/errors';
import { authenticate, authOf, requirePermission } from '../../plugins/auth';
import { searchTerms } from '../leads/routes';
import { getOpenSlots } from './availability/service';
import { recordAppointmentEvent } from './events';
import { confirmAppointment, type AppointmentRow } from './finalize';
import { cancelAppointment, rescheduleAppointment, rulesForAppointment } from './lifecycle';
import { kickNotifications } from './notifications/dispatcher';
import { enqueueNotification } from './notifications/queue';

const idParam = z.object({ id: z.string().uuid() });

const ListQuery = z.object({
  campaign_id: z.string().uuid().optional(),
  host_id: z.string().uuid().optional(),
  status: z.string().optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  q: z.string().max(200).optional(),
  call_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(2000).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

const LIST_SQL = `
  select a.id, a.status, a.starts_at, a.ends_at, a.lead_time_zone, a.source, a.attendee_name, a.attendee_email, a.notes,
         a.created_at, a.confirmed_at, a.cancel_reason, a.version, a.call_id, a.lead_id, a.campaign_id,
         cp.name as campaign_name, h.id as host_id, h.display_name as host_name, t.name as type_name, t.duration_minutes,
         l.first_name, l.last_name, l.email as lead_email, l.phone_e164,
         count(*) over()::int as total_count
    from appointments a
    join appointment_hosts h on h.id = a.host_id
    join appointment_types t on t.id = a.appointment_type_id
    left join campaigns cp on cp.id = a.campaign_id
    left join leads l on l.id = a.lead_id
   where a.organization_id = $1
     and ($2::uuid is null or a.campaign_id = $2)
     and ($3::uuid is null or a.host_id = $3)
     and ($4::text[] is null or a.status = any($4))
     and ($5::timestamptz is null or a.ends_at > $5)
     and ($6::timestamptz is null or a.starts_at < $6)
     and ($7::text is null
          or (coalesce(l.first_name,'') || ' ' || coalesce(l.last_name,'')) ilike $7
          or coalesce(a.attendee_name, '') ilike $7
          or coalesce(a.attendee_email, l.email, '') ilike $7
          or ($8::text is not null and l.phone_digits like '%' || $8 || '%'))
     and ($9::uuid is null or a.call_id = $9)
   order by a.starts_at
   limit $10 offset $11`;

async function listAppointments(deps: Deps, organizationId: string, raw: unknown) {
  const q = ListQuery.parse(raw);
  const s = searchTerms(q.q);
  const statuses = q.status ? q.status.split(',').filter((x) => (APPOINTMENT_STATUSES as readonly string[]).includes(x)) : null;
  const { rows } = await deps.db.query(LIST_SQL, [
    organizationId, q.campaign_id ?? null, q.host_id ?? null, statuses?.length ? statuses : null,
    q.from ?? null, q.to ?? null, s.text, s.digits, q.call_id ?? null, q.limit, q.offset,
  ]);
  return { rows: rows.map(({ total_count: _t, ...r }) => r), total: rows[0]?.total_count ?? 0 };
}

const EXPORT_COLUMNS: [string, (r: Record<string, unknown>) => unknown][] = [
  ['Appointment ID', (r) => r.id],
  ['Status', (r) => r.status],
  ['Start (UTC)', (r) => (r.starts_at as Date).toISOString()],
  ['Start (prospect time)', (r) => DateTime.fromJSDate(r.starts_at as Date, { zone: r.lead_time_zone as string }).toFormat('yyyy-MM-dd HH:mm ZZZZ')],
  ['Duration (min)', (r) => r.duration_minutes],
  ['Type', (r) => r.type_name],
  ['Host', (r) => r.host_name],
  ['Lead first name', (r) => r.first_name],
  ['Lead last name', (r) => r.last_name],
  ['Attendee', (r) => r.attendee_name],
  ['Email', (r) => r.attendee_email ?? r.lead_email],
  ['Phone', (r) => r.phone_e164],
  ['Campaign', (r) => r.campaign_name],
  ['Source', (r) => r.source],
  ['Notes', (r) => r.notes],
  ['Cancel reason', (r) => r.cancel_reason],
  ['Booked at', (r) => (r.created_at as Date).toISOString()],
];

export async function registerAppointmentRoutes(app: FastifyInstance, deps: Deps) {
  const { db } = deps;
  const auth = authenticate(deps);
  const view = [auth, requirePermission('appointments.view')];
  const manage = [auth, requirePermission('appointments.manage')];

  async function loadOwned(organizationId: string, id: string): Promise<AppointmentRow> {
    const { rows } = await db.query<AppointmentRow>('select * from appointments where id = $1 and organization_id = $2', [id, organizationId]);
    if (!rows[0]) throw notFound();
    return rows[0];
  }

  app.get('/api/appointments', { preHandler: view }, async (req) => listAppointments(deps, authOf(req).organizationId, req.query));

  app.get('/api/appointments/export', { preHandler: view }, async (req, reply) => {
    const { organizationId } = authOf(req);
    const { format } = z.object({ format: z.enum(['csv', 'xlsx']).default('csv') }).parse(req.query);
    const { rows } = await listAppointments(deps, organizationId, { ...(req.query as object), limit: 2000, offset: 0 });
    const stamp = DateTime.fromJSDate(deps.clock.now()).toFormat('yyyyLLdd-HHmm');
    if (format === 'csv') {
      const csv = toCsv(EXPORT_COLUMNS.map(([h]) => h), rows.map((r) => EXPORT_COLUMNS.map(([, f]) => f(r))));
      return reply.type('text/csv; charset=utf-8').header('content-disposition', `attachment; filename="appointments-${stamp}.csv"`).send(csv);
    }
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Appointments');
    ws.columns = EXPORT_COLUMNS.map(([h]) => ({ header: h, key: h, width: Math.max(12, h.length + 2) }));
    for (const r of rows) ws.addRow(EXPORT_COLUMNS.map(([, f]) => f(r) ?? ''));
    ws.getRow(1).font = { bold: true };
    const buf = await wb.xlsx.writeBuffer();
    return reply
      .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('content-disposition', `attachment; filename="appointments-${stamp}.xlsx"`)
      .send(Buffer.from(buf as ArrayBuffer));
  });

  app.get('/api/appointments/:id', { preHandler: view }, async (req) => {
    const { organizationId } = authOf(req);
    const { id } = idParam.parse(req.params);
    const { rows } = await db.query(
      `select a.*, h.display_name as host_name, h.email as host_email, t.name as type_name, t.duration_minutes, t.location_type, t.location_details,
              cp.name as campaign_name, l.first_name, l.last_name, l.email as lead_email, l.phone_e164, l.company, c.summary as call_summary
         from appointments a
         join appointment_hosts h on h.id = a.host_id
         join appointment_types t on t.id = a.appointment_type_id
         left join campaigns cp on cp.id = a.campaign_id
         left join leads l on l.id = a.lead_id
         left join calls c on c.id = a.call_id
        where a.id = $1 and a.organization_id = $2`,
      [id, organizationId],
    );
    if (!rows[0]) throw notFound();
    const { token_hash: _h, ...appt } = rows[0];
    const [events, notifications] = await Promise.all([
      db.query(
        `select e.id, e.type, e.actor_type, e.metadata, e.created_at, p.email as actor_email
           from appointment_events e left join profiles p on p.id = e.actor_id where e.appointment_id = $1 order by e.id`,
        [id],
      ),
      db.query(
        `select id, type, channel, status, recipient, attempts, last_error, sent_at, send_after, appointment_version
           from appointment_notifications where appointment_id = $1 order by created_at`,
        [id],
      ),
    ]);
    return { ...appt, events: events.rows, notifications: notifications.rows };
  });

  app.get('/api/appointments/:id/slots', { preHandler: manage }, async (req) => {
    const { organizationId } = authOf(req);
    const { id } = idParam.parse(req.params);
    const appt = await loadOwned(organizationId, id);
    const settings = await rulesForAppointment(db, appt);
    const result = await getOpenSlots({
      db, organizationId, settings: { ...settings, min_notice_minutes: Math.min(settings.min_notice_minutes, 30) },
      now: deps.clock.now(), leadTimeZone: appt.lead_time_zone, excludeAppointmentId: appt.id, all: true, limit: 300,
    });
    return result.slots;
  });

  // Supervisor confirms a needs_review appointment (transcript extraction); this sends the email.
  app.post('/api/appointments/:id/confirm', { preHandler: manage }, async (req) => {
    const { organizationId, userId } = authOf(req);
    const { id } = idParam.parse(req.params);
    const appt = await loadOwned(organizationId, id);
    if (appt.status !== 'needs_review') throw conflict(`Only appointments that need review can be confirmed (this one is ${appt.status}).`);
    const body = z.object({ attendee_email: z.string().email().optional() }).parse(req.body ?? {});
    try {
      await withTx(db, async (c) => {
        if (body.attendee_email) await c.query('update appointments set attendee_email = $2 where id = $1', [id, body.attendee_email]);
        await confirmAppointment(c, deps, id, { type: 'user', id: userId });
      });
    } catch (err) {
      if (isPgError(err, PG.exclusionViolation)) throw conflict('That time overlaps another appointment for this host. Reschedule it first.', 'slot_unavailable');
      throw err;
    }
    await kickNotifications(deps, id);
    return loadOwned(organizationId, id);
  });

  app.post('/api/appointments/:id/reschedule', { preHandler: manage }, async (req) => {
    const { organizationId, userId } = authOf(req);
    const { id } = idParam.parse(req.params);
    await loadOwned(organizationId, id);
    const b = z.object({ start_utc: z.string().datetime(), host_id: z.string().uuid().optional() }).parse(req.body);
    return rescheduleAppointment(deps, id, { startUtc: b.start_utc, hostId: b.host_id }, { type: 'user', id: userId });
  });

  app.post('/api/appointments/:id/cancel', { preHandler: manage }, async (req) => {
    const { organizationId, userId } = authOf(req);
    const { id } = idParam.parse(req.params);
    await loadOwned(organizationId, id);
    const b = z.object({ reason: z.string().max(1000).optional() }).parse(req.body ?? {});
    return cancelAppointment(deps, id, b.reason?.trim() || null, { type: 'user', id: userId });
  });

  app.post('/api/appointments/:id/status', { preHandler: manage }, async (req) => {
    const { organizationId, userId } = authOf(req);
    const { id } = idParam.parse(req.params);
    const { status } = z.object({ status: z.enum(['completed', 'no_show']) }).parse(req.body);
    const updated = await withTx(db, async (c) => {
      const { rows } = await c.query<AppointmentRow>(
        `update appointments set status = $3, completed_at = case when $3 = 'completed' then now() else completed_at end
          where id = $1 and organization_id = $2 and status in ('confirmed', 'rescheduled', 'completed', 'no_show') returning *`,
        [id, organizationId, status],
      );
      if (!rows[0]) throw conflict('Only confirmed appointments can be marked completed or no-show.');
      await recordAppointmentEvent(c, { organizationId, appointmentId: id, type: status, actorType: 'user', actorId: userId });
      return rows[0];
    });
    return updated;
  });

  // Resend the confirmation for the current version (a deliberate, manual resend).
  app.post('/api/appointments/:id/resend-confirmation', { preHandler: manage }, async (req) => {
    const { organizationId } = authOf(req);
    const { id } = idParam.parse(req.params);
    const appt = await loadOwned(organizationId, id);
    if (!['confirmed', 'rescheduled'].includes(appt.status)) throw conflict('Only confirmed appointments can be resent.');
    const type = appt.version > 1 ? 'reschedule' : 'confirmation';
    const inserted = await enqueueNotification(db, {
      organizationId, appointmentId: id, type, channel: 'email', appointmentVersion: appt.version, recipient: appt.attendee_email,
    });
    if (!inserted) {
      await db.query(
        `update appointment_notifications set status = 'queued', attempts = 0, next_attempt_at = now(), last_error = null, recipient = $2
          where appointment_id = $1 and type = $3 and channel = 'email' and appointment_version = $4`,
        [id, appt.attendee_email, type, appt.version],
      );
    }
    await kickNotifications(deps, id);
    return { ok: true };
  });
}
