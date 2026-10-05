import type { Deps } from '../../../deps';
import { recordAppointmentEvent } from '../events';
import { deliverEmailNotification, type DeliveryResult, type NotificationRow } from './email';
import { deliverSmsNotification } from './sms';

export const MAX_ATTEMPTS = 6;
/** Backoff after attempt n (1-based): 1m, 5m, 15m, 1h, 3h. */
export const BACKOFF_MINUTES = [1, 5, 15, 60, 180];

const route: Record<NotificationRow['channel'], (deps: Deps, n: NotificationRow) => Promise<DeliveryResult>> = {
  email: deliverEmailNotification,
  sms: deliverSmsNotification,
};

/**
 * Appointment notification dispatcher ("process one batch"). Claims due notifications with
 * SKIP LOCKED, routes by channel, records the real provider error and retries with backoff.
 */
export async function dispatchNotificationsBatch(
  deps: Deps,
  opts: { appointmentId?: string; limit?: number } = {},
): Promise<{ processed: number; sent: number; failed: number }> {
  const now = deps.clock.now();
  const { rows: claimed } = await deps.db.query<NotificationRow>(
    `update appointment_notifications n set status = 'sending', attempts = attempts + 1
      where n.id in (
        select id from appointment_notifications
         where ((status = 'queued' and next_attempt_at <= $1 and send_after <= $1)
                or (status = 'sending' and updated_at < $1::timestamptz - interval '10 minutes'))
           and ($2::uuid is null or appointment_id = $2)
         order by next_attempt_at
         limit $3
         for update skip locked)
      returning n.id, n.organization_id, n.appointment_id, n.type, n.channel, n.appointment_version, n.recipient, n.attempts`,
    [now.toISOString(), opts.appointmentId ?? null, opts.limit ?? 50],
  );

  let sent = 0;
  let failed = 0;
  for (const n of claimed) {
    try {
      const result = await route[n.channel](deps, n);
      if (result.status === 'sent') {
        sent++;
        await deps.db.query(
          `update appointment_notifications set status = 'sent', sent_at = $2, provider_message = $3, last_error = null where id = $1`,
          [n.id, now.toISOString(), result.providerMessage],
        );
        await recordAppointmentEvent(deps.db, {
          organizationId: n.organization_id,
          appointmentId: n.appointment_id,
          type: 'email_sent',
          actorType: 'system',
          metadata: { notificationId: n.id, type: n.type, channel: n.channel, messageId: result.providerMessage },
        });
      } else {
        await deps.db.query(`update appointment_notifications set status = 'skipped', last_error = $2 where id = $1`, [n.id, result.reason]);
        await recordAppointmentEvent(deps.db, {
          organizationId: n.organization_id,
          appointmentId: n.appointment_id,
          type: 'notification_skipped',
          actorType: 'system',
          metadata: { notificationId: n.id, type: n.type, channel: n.channel, reason: result.reason },
        });
      }
    } catch (err) {
      failed++;
      const message = (err as Error).message?.slice(0, 2000) || String(err);
      const final = n.attempts >= MAX_ATTEMPTS;
      const delay = BACKOFF_MINUTES[Math.min(n.attempts - 1, BACKOFF_MINUTES.length - 1)]!;
      await deps.db.query(
        `update appointment_notifications
            set status = $2, last_error = $3, next_attempt_at = $4::timestamptz + make_interval(mins => $5)
          where id = $1`,
        [n.id, final ? 'failed' : 'queued', message, now.toISOString(), delay],
      );
      await recordAppointmentEvent(deps.db, {
        organizationId: n.organization_id,
        appointmentId: n.appointment_id,
        type: 'email_failed',
        actorType: 'system',
        metadata: { notificationId: n.id, type: n.type, channel: n.channel, attempt: n.attempts, final, error: message },
      });
      deps.logger.error({ err, notificationId: n.id, attempt: n.attempts, final }, 'appointment notification failed');
    }
  }
  return { processed: claimed.length, sent, failed };
}

/** Sends an appointment's due notifications right away (after confirm/reschedule/cancel). */
export async function kickNotifications(deps: Deps, appointmentId: string): Promise<void> {
  await dispatchNotificationsBatch(deps, { appointmentId }).catch((err) =>
    deps.logger.error({ err, appointmentId }, 'immediate notification dispatch failed; the job will retry'),
  );
}
