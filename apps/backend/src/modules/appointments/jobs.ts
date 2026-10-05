import { parseAppointmentSettings, reminderType } from '@snyder/shared';
import { withTx } from '../../db/pool';
import type { Deps } from '../../deps';
import { recordAppointmentEvent } from './events';
import { releaseHolds } from './finalize';
import { enqueueNotification, prospectChannels } from './notifications/queue';

/** Releases pending holds past hold_expires_at whose call never confirmed them. */
export async function holdExpiryBatch(deps: Deps, limit = 100): Promise<{ processed: number }> {
  const released = await withTx(deps.db, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `select id from appointments where status = 'pending' and hold_expires_at < $1
        order by hold_expires_at limit $2 for update skip locked`,
      [deps.clock.now().toISOString(), limit],
    );
    if (!rows.length) return [];
    return releaseHolds(client, { appointmentIds: rows.map((r) => r.id) }, 'hold expired');
  });
  return { processed: released.length };
}

/**
 * Enqueues reminder notifications at each campaign's offsets (default 24h and 1h). Idempotent via
 * the notification unique key; reminders whose time passed before the booking are skipped.
 */
export async function reminderSchedulerBatch(deps: Deps, limit = 500): Promise<{ processed: number }> {
  const now = deps.clock.now();
  const { rows } = await deps.db.query<{
    id: string;
    organization_id: string;
    starts_at: Date;
    confirmed_at: Date | null;
    updated_at: Date;
    version: number;
    attendee_email: string | null;
    appointments: unknown;
  }>(
    `select a.id, a.organization_id, a.starts_at, a.confirmed_at, a.updated_at, a.version, a.attendee_email,
            v.snapshot->'appointments' as appointments
       from appointments a left join campaign_versions v on v.id = a.campaign_version_id
      where a.status in ('confirmed', 'rescheduled') and a.starts_at > $1 and a.starts_at < $1::timestamptz + interval '8 days'
      order by a.starts_at limit $2`,
    [now.toISOString(), limit],
  );
  let processed = 0;
  for (const a of rows) {
    const settings = a.appointments ? parseAppointmentSettings(a.appointments) : parseAppointmentSettings({});
    const bookedAt = (a.version > 1 ? a.updated_at : a.confirmed_at) ?? now;
    for (const offset of settings.reminder_offsets_minutes) {
      const sendAt = new Date(a.starts_at.getTime() - offset * 60_000);
      if (sendAt < bookedAt) continue; // e.g. booked 3 hours ahead: no 24h reminder
      for (const channel of prospectChannels(a.appointments ? settings : null, deps.config.SMS_APPOINTMENTS_ENABLED)) {
        const added = await enqueueNotification(deps.db, {
          organizationId: a.organization_id,
          appointmentId: a.id,
          type: reminderType(offset),
          channel,
          appointmentVersion: a.version,
          recipient: channel === 'email' ? a.attendee_email : null,
          sendAfter: sendAt,
        });
        if (added) processed++;
      }
    }
  }
  return { processed };
}

/** Flags confirmed appointments 2h past their end that nobody marked completed. */
export async function noShowBatch(deps: Deps, limit = 200): Promise<{ processed: number }> {
  return withTx(deps.db, async (client) => {
    const { rows } = await client.query<{ id: string; organization_id: string }>(
      `update appointments set status = 'no_show'
        where id in (select id from appointments
                      where status in ('confirmed', 'rescheduled') and ends_at < $1::timestamptz - interval '2 hours'
                      order by ends_at limit $2 for update skip locked)
        returning id, organization_id`,
      [deps.clock.now().toISOString(), limit],
    );
    for (const r of rows) {
      await recordAppointmentEvent(client, { organizationId: r.organization_id, appointmentId: r.id, type: 'no_show', actorType: 'system', metadata: { auto: true } });
    }
    return { processed: rows.length };
  });
}
