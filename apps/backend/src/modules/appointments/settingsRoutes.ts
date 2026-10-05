import { LOCATION_TYPES } from '@snyder/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTx } from '../../db/pool';
import type { Deps } from '../../deps';
import { badRequest, notFound } from '../../lib/errors';
import { isValidTimeZone } from '../../lib/timezone';
import { authenticate, authOf, requirePermission } from '../../plugins/auth';
import { DEFAULT_TEMPLATES, renderAppointmentEmail, type AppointmentEmailContext, type EmailKind } from './email/render';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/);
const idParam = z.object({ id: z.string().uuid() });
const KINDS = ['confirmation', 'reschedule', 'cancellation', 'reminder', 'host_notice'] as const;

const TypeInput = z.object({
  name: z.string().trim().min(1).max(120),
  duration_minutes: z.number().int().min(5).max(480),
  buffer_before_minutes: z.number().int().min(0).max(240).default(0),
  buffer_after_minutes: z.number().int().min(0).max(240).default(0),
  location_type: z.enum(LOCATION_TYPES),
  location_details: z.string().max(1000).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  is_active: z.boolean().default(true),
});

const HostInput = z.object({
  user_id: z.string().uuid().nullable().optional(),
  display_name: z.string().trim().min(1).max(120),
  email: z.string().trim().email(),
  time_zone: z.string().refine(isValidTimeZone, 'Unknown time zone'),
  is_active: z.boolean().default(true),
});

/** Sample data for template previews and test emails. */
export function sampleEmailContext(org: { name: string }, now: Date): AppointmentEmailContext {
  const start = new Date(Math.ceil((now.getTime() + 2 * 86_400_000) / 3_600_000) * 3_600_000);
  return {
    appointment: {
      id: '00000000-0000-4000-8000-000000000000',
      organization_id: '00000000-0000-4000-8000-000000000000',
      starts_at: start,
      ends_at: new Date(start.getTime() + 30 * 60_000),
      status: 'confirmed',
      version: 1,
      lead_time_zone: 'America/New_York',
      attendee_name: 'Alex Morgan',
      attendee_email: 'alex@example.com',
      notes: null,
      call_id: null,
      campaign_version_id: null,
    },
    type: { name: 'Intro call', duration_minutes: 30, location_type: 'video', location_details: 'https://meet.example.com/your-room', description: null },
    host: { display_name: 'Jordan Rivera', email: 'jordan@example.com', time_zone: 'America/New_York' },
    lead: { first_name: 'Alex', last_name: 'Morgan', email: 'alex@example.com', phone_e164: '+12125550100', company: 'Example Inc', custom_fields: {} },
    organizationName: org.name,
    campaignName: 'Sample campaign',
    businessName: org.name,
    agentName: 'Katie',
    settings: null,
    callSummary: 'Interested and asked for a 30 minute intro.',
  };
}

export async function registerAppointmentSettingsRoutes(app: FastifyInstance, deps: Deps) {
  const { db } = deps;
  const auth = authenticate(deps);
  const read = [auth];
  const manage = [auth, requirePermission('appointments.settings')];

  // --- Appointment types ------------------------------------------------------
  app.get('/api/appointment-types', { preHandler: read }, async (req) => {
    const { organizationId } = authOf(req);
    return (await db.query('select * from appointment_types where organization_id = $1 order by name', [organizationId])).rows;
  });
  app.post('/api/appointment-types', { preHandler: manage }, async (req, reply) => {
    const { organizationId } = authOf(req);
    const b = TypeInput.parse(req.body);
    const { rows } = await db.query(
      `insert into appointment_types(organization_id, name, duration_minutes, buffer_before_minutes, buffer_after_minutes,
                                     location_type, location_details, description, is_active)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
      [organizationId, b.name, b.duration_minutes, b.buffer_before_minutes, b.buffer_after_minutes, b.location_type, b.location_details ?? null, b.description ?? null, b.is_active],
    );
    return reply.status(201).send(rows[0]);
  });
  app.put('/api/appointment-types/:id', { preHandler: manage }, async (req) => {
    const { organizationId } = authOf(req);
    const { id } = idParam.parse(req.params);
    const b = TypeInput.parse(req.body);
    const { rows } = await db.query(
      `update appointment_types set name=$3, duration_minutes=$4, buffer_before_minutes=$5, buffer_after_minutes=$6,
              location_type=$7, location_details=$8, description=$9, is_active=$10
        where id = $1 and organization_id = $2 returning *`,
      [id, organizationId, b.name, b.duration_minutes, b.buffer_before_minutes, b.buffer_after_minutes, b.location_type, b.location_details ?? null, b.description ?? null, b.is_active],
    );
    if (!rows[0]) throw notFound();
    return rows[0];
  });

  // --- Hosts, weekly availability, exceptions ---------------------------------
  app.get('/api/appointment-hosts', { preHandler: read }, async (req) => {
    const { organizationId } = authOf(req);
    const { rows } = await db.query(
      `select h.*,
              coalesce((select json_agg(json_build_object('id', r.id, 'weekday', r.weekday,
                        'start_time', to_char(r.start_time, 'HH24:MI'), 'end_time', to_char(r.end_time, 'HH24:MI')) order by r.weekday, r.start_time)
                        from availability_rules r where r.host_id = h.id), '[]') as rules,
              coalesce((select json_agg(json_build_object('id', e.id, 'starts_at', e.starts_at, 'ends_at', e.ends_at, 'type', e.type, 'reason', e.reason) order by e.starts_at)
                        from availability_exceptions e where e.host_id = h.id and e.ends_at > now() - interval '1 day'), '[]') as exceptions
         from appointment_hosts h where h.organization_id = $1 order by h.display_name`,
      [organizationId],
    );
    return rows;
  });
  app.post('/api/appointment-hosts', { preHandler: manage }, async (req, reply) => {
    const { organizationId } = authOf(req);
    const b = HostInput.parse(req.body);
    if (b.user_id) {
      const m = await db.query('select 1 from memberships where organization_id = $1 and user_id = $2', [organizationId, b.user_id]);
      if (!m.rowCount) throw badRequest('That user is not in this organization');
    }
    const { rows } = await db.query(
      `insert into appointment_hosts(organization_id, user_id, display_name, email, time_zone, is_active)
       values ($1,$2,$3,$4,$5,$6) returning *`,
      [organizationId, b.user_id ?? null, b.display_name, b.email, b.time_zone, b.is_active],
    );
    return reply.status(201).send(rows[0]);
  });
  app.put('/api/appointment-hosts/:id', { preHandler: manage }, async (req) => {
    const { organizationId } = authOf(req);
    const { id } = idParam.parse(req.params);
    const b = HostInput.parse(req.body);
    const { rows } = await db.query(
      `update appointment_hosts set user_id=$3, display_name=$4, email=$5, time_zone=$6, is_active=$7
        where id = $1 and organization_id = $2 returning *`,
      [id, organizationId, b.user_id ?? null, b.display_name, b.email, b.time_zone, b.is_active],
    );
    if (!rows[0]) throw notFound();
    return rows[0];
  });

  // Replaces the host's whole weekly schedule.
  app.put('/api/appointment-hosts/:id/availability', { preHandler: manage }, async (req) => {
    const { organizationId } = authOf(req);
    const { id } = idParam.parse(req.params);
    const body = z
      .object({ rules: z.array(z.object({ weekday: z.number().int().min(1).max(7), start_time: hhmm, end_time: hhmm })).max(50) })
      .parse(req.body);
    for (const r of body.rules) if (r.end_time <= r.start_time) throw badRequest('Each block must end after it starts');
    await withTx(db, async (c) => {
      const h = await c.query('select 1 from appointment_hosts where id = $1 and organization_id = $2', [id, organizationId]);
      if (!h.rowCount) throw notFound();
      await c.query('delete from availability_rules where host_id = $1', [id]);
      for (const r of body.rules) {
        await c.query(
          `insert into availability_rules(organization_id, host_id, weekday, start_time, end_time) values ($1,$2,$3,$4,$5)`,
          [organizationId, id, r.weekday, r.start_time, r.end_time === '24:00' ? '23:59:59' : r.end_time],
        );
      }
    });
    return { ok: true };
  });

  app.post('/api/appointment-hosts/:id/exceptions', { preHandler: manage }, async (req, reply) => {
    const { organizationId } = authOf(req);
    const { id } = idParam.parse(req.params);
    const b = z
      .object({ starts_at: z.string().datetime({ offset: true }), ends_at: z.string().datetime({ offset: true }), type: z.enum(['blocked', 'extra_open']), reason: z.string().max(300).optional() })
      .refine((v) => new Date(v.ends_at) > new Date(v.starts_at), 'End must be after start')
      .parse(req.body);
    const h = await db.query('select 1 from appointment_hosts where id = $1 and organization_id = $2', [id, organizationId]);
    if (!h.rowCount) throw notFound();
    const { rows } = await db.query(
      `insert into availability_exceptions(organization_id, host_id, starts_at, ends_at, type, reason) values ($1,$2,$3,$4,$5,$6) returning *`,
      [organizationId, id, b.starts_at, b.ends_at, b.type, b.reason ?? null],
    );
    return reply.status(201).send(rows[0]);
  });
  app.delete('/api/availability-exceptions/:id', { preHandler: manage }, async (req) => {
    const { organizationId } = authOf(req);
    const { id } = idParam.parse(req.params);
    await db.query('delete from availability_exceptions where id = $1 and organization_id = $2', [id, organizationId]);
    return { ok: true };
  });

  // --- Default email templates --------------------------------------------------
  app.get('/api/appointment-email-templates', { preHandler: read }, async (req) => {
    const { organizationId } = authOf(req);
    const { rows } = await db.query<{ type: EmailKind; subject: string; body: string }>(
      'select type, subject, body from appointment_email_templates where organization_id = $1',
      [organizationId],
    );
    return Object.fromEntries(KINDS.map((k) => [k, rows.find((r) => r.type === k) ?? { ...DEFAULT_TEMPLATES[k], is_default: true }]));
  });
  app.put('/api/appointment-email-templates/:type', { preHandler: manage }, async (req) => {
    const { organizationId } = authOf(req);
    const { type } = z.object({ type: z.enum(KINDS) }).parse(req.params);
    const b = z.object({ subject: z.string().trim().min(1).max(300), body: z.string().trim().min(1).max(20_000) }).parse(req.body);
    await db.query(
      `insert into appointment_email_templates(organization_id, type, subject, body) values ($1,$2,$3,$4)
       on conflict (organization_id, type) do update set subject = excluded.subject, body = excluded.body, updated_at = now()`,
      [organizationId, type, b.subject, b.body],
    );
    return { ok: true };
  });
  app.delete('/api/appointment-email-templates/:type', { preHandler: manage }, async (req) => {
    const { organizationId } = authOf(req);
    const { type } = z.object({ type: z.enum(KINDS) }).parse(req.params);
    await db.query('delete from appointment_email_templates where organization_id = $1 and type = $2', [organizationId, type]);
    return { ok: true };
  });

  const PreviewInput = z.object({ kind: z.enum(KINDS), subject: z.string().max(300), body: z.string().max(20_000) });
  async function renderPreview(organizationId: string, input: z.infer<typeof PreviewInput>) {
    const { rows } = await db.query<{ name: string }>('select name from organizations where id = $1', [organizationId]);
    const ctx = sampleEmailContext({ name: rows[0]?.name ?? 'Your business' }, deps.clock.now());
    const link = input.kind === 'cancellation' || input.kind === 'host_notice' ? null : `${deps.config.APPOINTMENTS_PUBLIC_URL.replace(/\/$/, '')}/a/sample-link`;
    return renderAppointmentEmail(ctx, { kind: input.kind, template: { subject: input.subject, body: input.body }, link, config: deps.config, now: deps.clock.now() });
  }
  app.post('/api/appointment-email-templates/preview', { preHandler: read }, async (req) => {
    const { organizationId } = authOf(req);
    const email = await renderPreview(organizationId, PreviewInput.parse(req.body));
    return { subject: email.subject, html: email.html, text: email.text };
  });
  app.post('/api/appointment-email-templates/test', { preHandler: manage }, async (req) => {
    const { organizationId, email: userEmail } = authOf(req);
    const b = PreviewInput.extend({ to: z.string().email().optional() }).parse(req.body);
    const to = b.to ?? userEmail;
    if (!to) throw badRequest('No recipient email');
    const email = await renderPreview(organizationId, b);
    try {
      const res = await deps.mailer.send({ ...email, to, subject: `[Test] ${email.subject}`, organizationId });
      return { ok: true, messageId: res.messageId, to };
    } catch (err) {
      // Surface the real SMTP error to the admin.
      throw badRequest(`SMTP error: ${(err as Error).message}`, 'smtp_error');
    }
  });
}
