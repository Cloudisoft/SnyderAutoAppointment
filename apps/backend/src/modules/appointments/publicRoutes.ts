import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { DateTime } from 'luxon';
import { z } from 'zod';
import type { Deps } from '../../deps';
import { notFound } from '../../lib/errors';
import { getOpenSlots } from './availability/service';
import { googleCalendarUrl, outlookCalendarUrl } from './email/calendarLinks';
import { loadEmailContext, locationText, renderAppointmentEmail, DEFAULT_TEMPLATES } from './email/render';
import { cancelAppointment, rescheduleAppointment, rulesForAppointment } from './lifecycle';
import type { AppointmentRow } from './finalize';
import { resolveToken } from './tokens';

const tokenParam = z.object({ token: z.string().max(200) });

function privateHeaders(reply: FastifyReply) {
  reply.header('X-Robots-Tag', 'noindex, nofollow');
  reply.header('Cache-Control', 'no-store');
  reply.header('Referrer-Policy', 'no-referrer');
}

/**
 * Public, unauthenticated appointment endpoints for /a/:token. Tokens are looked up by hash only;
 * unknown, revoked and expired tokens all return the same 404. Only the first name is exposed.
 */
export async function registerPublicAppointmentRoutes(app: FastifyInstance, deps: Deps) {
  await app.register(async (scope) => {
    await scope.register(rateLimit, { max: 60, timeWindow: '1 minute', global: true });
    scope.addHook('onSend', async (_req, reply) => privateHeaders(reply));

    async function appointmentFor(token: string): Promise<AppointmentRow> {
      const id = await resolveToken(deps.db, token, deps.clock.now());
      if (!id) throw notFound();
      const { rows } = await deps.db.query<AppointmentRow>('select * from appointments where id = $1', [id]);
      if (!rows[0] || rows[0].status === 'needs_review' || rows[0].status === 'pending') throw notFound();
      return rows[0];
    }

    async function view(appt: AppointmentRow) {
      const ctx = await loadEmailContext(deps.db, appt.id);
      const now = deps.clock.now();
      const location = locationText(ctx);
      const calendar = { title: `${ctx.type.name} with ${ctx.host.display_name}`, start: appt.starts_at, end: appt.ends_at, details: ctx.type.description ?? '', location };
      const active = ['confirmed', 'rescheduled'].includes(appt.status);
      return {
        business_name: ctx.businessName,
        first_name: ctx.lead?.first_name ?? ctx.appointment.attendee_name?.split(' ')[0] ?? null,
        appointment_type: ctx.type.name,
        description: ctx.type.description,
        starts_at: appt.starts_at.toISOString(),
        ends_at: appt.ends_at.toISOString(),
        duration_minutes: ctx.type.duration_minutes,
        time_zone: appt.lead_time_zone,
        host_name: ctx.host.display_name,
        location_type: ctx.type.location_type,
        location,
        status: appt.status,
        can_modify: active && appt.starts_at.getTime() > now.getTime(),
        calendar: active ? { google: googleCalendarUrl(calendar), outlook: outlookCalendarUrl(calendar) } : null,
      };
    }

    scope.get('/public/appointments/:token', async (req) => view(await appointmentFor(tokenParam.parse(req.params).token)));

    scope.get('/public/appointments/:token/invite.ics', async (req, reply) => {
      const appt = await appointmentFor(tokenParam.parse(req.params).token);
      const ctx = await loadEmailContext(deps.db, appt.id);
      const kind = appt.status === 'cancelled' ? 'cancellation' : 'confirmation';
      const email = renderAppointmentEmail(ctx, { kind, template: DEFAULT_TEMPLATES[kind], link: null, config: deps.config, now: deps.clock.now() });
      return reply.type('text/calendar; charset=utf-8').header('content-disposition', 'attachment; filename="appointment.ics"').send(email.icalEvent!.content);
    });

    scope.get('/public/appointments/:token/slots', async (req) => {
      const appt = await appointmentFor(tokenParam.parse(req.params).token);
      const q = z.object({ time_zone: z.string().optional() }).parse(req.query);
      const now = deps.clock.now();
      if (!['confirmed', 'rescheduled'].includes(appt.status) || appt.starts_at <= now) return { slots: [] };
      const settings = await rulesForAppointment(deps.db, appt);
      const zone = q.time_zone && DateTime.local().setZone(q.time_zone).isValid ? q.time_zone : appt.lead_time_zone;
      const result = await getOpenSlots({
        db: deps.db,
        organizationId: appt.organization_id,
        settings,
        now,
        leadTimeZone: zone,
        excludeAppointmentId: appt.id,
        all: true,
        limit: 300,
      });
      return {
        slots: result.slots
          .filter((s) => s.startUtc !== appt.starts_at.toISOString())
          .map((s) => ({ host_id: s.hostId, start_utc: s.startUtc, end_utc: s.endUtc, start_local: s.startLocal })),
      };
    });

    scope.post(
      '/public/appointments/:token/reschedule',
      { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
      async (req) => {
        const appt = await appointmentFor(tokenParam.parse(req.params).token);
        const body = z.object({ start_utc: z.string().datetime(), host_id: z.string().uuid().optional() }).parse(req.body);
        const updated = await rescheduleAppointment(deps, appt.id, { startUtc: body.start_utc, hostId: body.host_id }, { type: 'prospect' });
        return view(updated);
      },
    );

    scope.post(
      '/public/appointments/:token/cancel',
      { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
      async (req) => {
        const appt = await appointmentFor(tokenParam.parse(req.params).token);
        const body = z.object({ reason: z.string().max(1000).optional() }).parse(req.body ?? {});
        const updated = await cancelAppointment(deps, appt.id, body.reason?.trim() || null, { type: 'prospect' });
        return view(updated);
      },
    );
  });
}
