import type { AppointmentSettings } from '@snyder/shared';
import { reminderType } from '@snyder/shared';
import type { DbClient } from '../../../db/pool';

export type NotificationType = 'confirmation' | 'reschedule' | 'cancellation' | 'host_notice' | string;
export type Channel = 'email' | 'sms';

/** Channels for prospect-facing notifications. SMS only when enabled globally AND on the campaign. */
export function prospectChannels(settings: AppointmentSettings | null, smsGloballyEnabled: boolean): Channel[] {
  return smsGloballyEnabled && settings?.sms_enabled ? ['email', 'sms'] : ['email'];
}

/**
 * Queues a notification. The UNIQUE(appointment_id, type, channel, appointment_version) key makes
 * this idempotent: duplicate webhooks or job runs never queue (or send) twice.
 */
export async function enqueueNotification(
  db: DbClient,
  n: {
    organizationId: string;
    appointmentId: string;
    type: NotificationType;
    channel: Channel;
    appointmentVersion: number;
    recipient: string | null;
    sendAfter?: Date;
  },
): Promise<boolean> {
  const { rowCount } = await db.query(
    `insert into appointment_notifications(organization_id, appointment_id, type, channel, appointment_version, recipient, send_after, next_attempt_at)
     values ($1, $2, $3, $4, $5, $6, coalesce($7, now()), coalesce($7, now()))
     on conflict (appointment_id, type, channel, appointment_version) do nothing`,
    [n.organizationId, n.appointmentId, n.type, n.channel, n.appointmentVersion, n.recipient, n.sendAfter?.toISOString() ?? null],
  );
  return (rowCount ?? 0) > 0;
}

/** Cancels queued (unsent) notifications of the given types, e.g. old reminders after a reschedule. */
export async function cancelPendingNotifications(db: DbClient, appointmentId: string, typePattern = 'reminder_%') {
  await db.query(
    `update appointment_notifications set status = 'cancelled'
      where appointment_id = $1 and status = 'queued' and type like $2`,
    [appointmentId, typePattern],
  );
}

export { reminderType };
