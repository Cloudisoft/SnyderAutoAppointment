import { parseAppointmentSettings, type AppointmentSettings } from '@snyder/shared';
import type pg from 'pg';
import { isPgError, PG, withTx, type DbClient } from '../../db/pool';
import type { Deps } from '../../deps';
import { conflict, notFound } from '../../lib/errors';
import { notifyInApp } from '../org/notifications';
import { isSlotOpen } from './availability/service';
import { displaySlotLabel } from './availability/spoken';
import { recordAppointmentEvent } from './events';
import { settingsForAppointment, TOKEN_TTL_DAYS_AFTER_END, type AppointmentRow } from './finalize';
import { kickNotifications } from './notifications/dispatcher';
import { cancelPendingNotifications, enqueueNotification, prospectChannels } from './notifications/queue';

export type Actor = { type: 'user' | 'prospect' | 'system'; id?: string | null };

const MODIFIABLE = ['confirmed', 'rescheduled'];

async function lockAppointment(client: pg.PoolClient, id: string): Promise<AppointmentRow> {
  const { rows } = await client.query<AppointmentRow>('select * from appointments where id = $1 for update', [id]);
  if (!rows[0]) throw notFound();
  return rows[0];
}

/**
 * Booking rules for an appointment: its campaign version's settings, or (manual appointments)
 * the appointment's own type and host with default notice/horizon.
 */
export async function rulesForAppointment(db: DbClient, appt: AppointmentRow): Promise<AppointmentSettings> {
  const s = await settingsForAppointment(db, appt);
  if (s?.appointment_type_id) return { ...s, appointment_type_id: appt.appointment_type_id };
  return parseAppointmentSettings({
    booking_enabled: true,
    appointment_type_id: appt.appointment_type_id,
    host_assignment: { strategy: 'specific_host', host_ids: [appt.host_id] },
  });
}

/** Atomic swap to a new open slot. The exclusion constraint guards the new time. */
export async function rescheduleAppointment(
  deps: Deps,
  appointmentId: string,
  to: { startUtc: string; hostId?: string },
  actor: Actor,
): Promise<AppointmentRow> {
  const now = deps.clock.now();
  const result = await withTx(deps.db, async (client) => {
    const appt = await lockAppointment(client, appointmentId);
    if (!MODIFIABLE.includes(appt.status)) throw conflict(`A ${appt.status.replace('_', ' ')} appointment can't be rescheduled.`, 'not_modifiable');
    if (appt.starts_at.getTime() <= now.getTime()) throw conflict('This appointment has already started.', 'read_only');
    const settings = await rulesForAppointment(client, appt);
    const hostId = to.hostId ?? appt.host_id;
    const allowedHosts = settings.host_assignment.host_ids.length ? settings.host_assignment.host_ids : [appt.host_id];
    if (!allowedHosts.includes(hostId) && hostId !== appt.host_id) throw conflict('That host is not available for this appointment.', 'slot_unavailable');
    const open = await isSlotOpen({
      db: client,
      organizationId: appt.organization_id,
      settings,
      now,
      leadTimeZone: appt.lead_time_zone,
      hostId,
      startUtc: to.startUtc,
      excludeAppointmentId: appt.id,
    });
    if (!open) throw conflict('That time is no longer available. Please pick another.', 'slot_unavailable');
    const { rows: typeRows } = await client.query<{ duration_minutes: number; buffer_before_minutes: number; buffer_after_minutes: number }>(
      'select duration_minutes, buffer_before_minutes, buffer_after_minutes from appointment_types where id = $1',
      [appt.appointment_type_id],
    );
    const type = typeRows[0]!;
    const start = new Date(to.startUtc);
    const end = new Date(start.getTime() + type.duration_minutes * 60_000);
    let updated: AppointmentRow;
    try {
      await client.query('savepoint swap');
      const { rows } = await client.query<AppointmentRow>(
        `update appointments set starts_at = $2, ends_at = $3, host_id = $4, status = 'rescheduled', version = version + 1,
                buffer_before_minutes = $5, buffer_after_minutes = $6,
                token_expires_at = $3::timestamptz + make_interval(days => $7)
          where id = $1 returning *`,
        [appt.id, start.toISOString(), end.toISOString(), hostId, type.buffer_before_minutes, type.buffer_after_minutes, TOKEN_TTL_DAYS_AFTER_END],
      );
      updated = rows[0]!;
    } catch (err) {
      if (isPgError(err, PG.exclusionViolation)) {
        await client.query('rollback to savepoint swap');
        throw conflict('That time was just taken. Please pick another.', 'slot_unavailable');
      }
      throw err;
    }
    await client.query(
      `update appointment_tokens set expires_at = $2::timestamptz + make_interval(days => $3) where appointment_id = $1 and revoked_at is null`,
      [appt.id, end.toISOString(), TOKEN_TTL_DAYS_AFTER_END],
    );
    await cancelPendingNotifications(client, appt.id, 'reminder_%');
    await recordAppointmentEvent(client, {
      organizationId: appt.organization_id,
      appointmentId: appt.id,
      type: 'rescheduled',
      actorType: actor.type,
      actorId: actor.id ?? null,
      metadata: { from: appt.starts_at.toISOString(), to: start.toISOString(), fromHost: appt.host_id, toHost: hostId, version: updated.version },
    });
    const campaignSettings = await settingsForAppointment(client, appt);
    for (const channel of prospectChannels(campaignSettings, deps.config.SMS_APPOINTMENTS_ENABLED)) {
      await enqueueNotification(client, {
        organizationId: appt.organization_id,
        appointmentId: appt.id,
        type: 'reschedule',
        channel,
        appointmentVersion: updated.version,
        recipient: channel === 'email' ? appt.attendee_email : null,
      });
    }
    const { rows: host } = await client.query<{ email: string }>('select email from appointment_hosts where id = $1', [hostId]);
    await enqueueNotification(client, {
      organizationId: appt.organization_id,
      appointmentId: appt.id,
      type: 'host_notice',
      channel: 'email',
      appointmentVersion: updated.version,
      recipient: host[0]?.email ?? null,
    });
    return updated;
  });
  await kickNotifications(deps, appointmentId);
  return result;
}

export async function cancelAppointment(deps: Deps, appointmentId: string, reason: string | null, actor: Actor): Promise<AppointmentRow> {
  const now = deps.clock.now();
  const result = await withTx(deps.db, async (client) => {
    const appt = await lockAppointment(client, appointmentId);
    const cancellable = actor.type === 'prospect' ? MODIFIABLE : [...MODIFIABLE, 'pending', 'needs_review'];
    if (!cancellable.includes(appt.status)) throw conflict(`A ${appt.status.replace('_', ' ')} appointment can't be cancelled.`, 'not_modifiable');
    if (actor.type === 'prospect' && appt.starts_at.getTime() <= now.getTime()) throw conflict('This appointment has already started.', 'read_only');
    const wasConfirmed = MODIFIABLE.includes(appt.status);
    const { rows } = await client.query<AppointmentRow>(
      `update appointments set status = 'cancelled', cancelled_at = now(), cancel_reason = $2, hold_expires_at = null,
              version = version + $3
        where id = $1 returning *`,
      [appt.id, reason?.slice(0, 1000) || null, wasConfirmed ? 1 : 0],
    );
    const updated = rows[0]!;
    await cancelPendingNotifications(client, appt.id, '%');
    await recordAppointmentEvent(client, {
      organizationId: appt.organization_id,
      appointmentId: appt.id,
      type: 'cancelled',
      actorType: actor.type,
      actorId: actor.id ?? null,
      metadata: { reason: reason ?? null },
    });
    const settings = await settingsForAppointment(client, appt);
    if (appt.lead_id && wasConfirmed) {
      await client.query(`update leads set status = 'appointment_cancelled' where id = $1 and status <> 'do_not_call'`, [appt.lead_id]);
      if (settings?.requeue_on_cancel && appt.campaign_id) {
        await client.query(
          `update campaign_leads set state = 'queued', next_attempt_at = now()
            where campaign_id = $1 and lead_id = $2 and state <> 'removed'`,
          [appt.campaign_id, appt.lead_id],
        );
      }
    }
    if (wasConfirmed) {
      for (const channel of prospectChannels(settings, deps.config.SMS_APPOINTMENTS_ENABLED)) {
        await enqueueNotification(client, {
          organizationId: appt.organization_id,
          appointmentId: appt.id,
          type: 'cancellation',
          channel,
          appointmentVersion: updated.version,
          recipient: channel === 'email' ? appt.attendee_email : null,
        });
      }
      if (actor.type === 'prospect') {
        await notifyInApp(client, {
          organizationId: appt.organization_id,
          permission: 'appointments.view',
          type: 'appointment_cancelled',
          title: `${appt.attendee_name ?? 'A prospect'} cancelled their appointment`,
          body: `${displaySlotLabel(appt.starts_at, appt.lead_time_zone)}${reason ? ` — “${reason.slice(0, 200)}”` : ''}`,
          link: `/appointments?id=${appt.id}`,
        });
      }
    }
    return updated;
  });
  await kickNotifications(deps, appointmentId);
  return result;
}
