import type { DbClient } from '../../../db/pool';
import type { Deps } from '../../../deps';
import { SmtpNotConfiguredError } from '../../../integrations/mailer';
import { recordAppointmentEvent } from '../events';
import { syncMeetingSafe } from '../../meetings/sync';
import { deliverEmailNotification, type DeliveryResult, type NotificationRow } from './email';
import { deliverSmsNotification } from './sms';

export const MAX_ATTEMPTS = 6;
/** Backoff after attempt n (1-based): 1m, 5m, 15m, 1h, 3h. */
export const BACKOFF_MINUTES = [1, 5, 15, 60, 180];
/** How often to re-check emails that are waiting for the organization to set up SMTP. */
export const WAITING_FOR_SMTP_MINUTES = 15;

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
  opts: { appointmentId?: string; organizationId?: string; limit?: number } = {},
): Promise<{ processed: number; sent: number; failed: number }> {
  const now = deps.clock.now();
  const { rows: claimed } = await deps.db.query<NotificationRow>(
    `update appointment_notifications n set status = 'sending', attempts = attempts + 1
      where n.id in (
        select id from appointment_notifications
         where ((status = 'queued' and next_attempt_at <= $1 and send_after <= $1)
                or (status = 'sending' and updated_at < $1::timestamptz - interval '10 minutes'))
           and ($2::uuid is null or appointment_id = $2)
           and ($4::uuid is null or organization_id = $4)
         order by next_attempt_at
         limit $3
         for update skip locked)
      returning n.id, n.organization_id, n.appointment_id, n.type, n.channel, n.appointment_version, n.recipient, n.attempts, n.last_error`,
    [now.toISOString(), opts.appointmentId ?? null, opts.limit ?? 50, opts.organizationId ?? null],
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
      if (err instanceof SmtpNotConfiguredError) {
        // Waiting for email to be set up is not a delivery failure: keep it queued without using
        // up attempts, and send automatically once SMTP works.
        await deps.db.query(
          `update appointment_notifications set status = 'queued', attempts = greatest(attempts - 1, 0), last_error = $2,
                  next_attempt_at = $3::timestamptz + make_interval(mins => $4)
            where id = $1`,
          [n.id, err.message, now.toISOString(), WAITING_FOR_SMTP_MINUTES],
        );
        if (n.last_error !== err.message) {
          await recordAppointmentEvent(deps.db, {
            organizationId: n.organization_id,
            appointmentId: n.appointment_id,
            type: 'email_failed',
            actorType: 'system',
            metadata: { notificationId: n.id, type: n.type, channel: n.channel, waitingForSmtp: true, error: err.message },
          });
        }
        continue;
      }
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

/**
 * Puts an organization's failed notifications (for appointments that haven't ended) back in the
 * queue with fresh attempts. Used after SMTP is fixed and by the bulk "Retry failed emails" action.
 */
export async function requeueFailedNotifications(db: DbClient, organizationId: string, now: Date): Promise<number> {
  const { rowCount } = await db.query(
    `update appointment_notifications n
        set status = 'queued', attempts = 0, next_attempt_at = $2, last_error = null
       from appointments a
      where a.id = n.appointment_id and n.organization_id = $1 and n.status = 'failed' and a.ends_at > $2`,
    [organizationId, now.toISOString()],
  );
  // Emails parked while waiting for SMTP become due immediately too.
  const { rowCount: waiting } = await db.query(
    `update appointment_notifications set next_attempt_at = $2
      where organization_id = $1 and status = 'queued' and next_attempt_at > $2 and send_after <= $2
        and last_error is not null`,
    [organizationId, now.toISOString()],
  );
  return (rowCount ?? 0) + (waiting ?? 0);
}

/** Sends everything due for an organization right away (after its SMTP settings start working). */
export async function kickOrganizationNotifications(deps: Deps, organizationId: string): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const r = await dispatchNotificationsBatch(deps, { organizationId, limit: 50 }).catch((err) => {
      deps.logger.error({ err, organizationId }, 'organization notification dispatch failed; the job will retry');
      return { processed: 0 };
    });
    if (r.processed < 50) break;
  }
}

/** Sends an appointment's due notifications right away (after confirm/reschedule/cancel). */
export async function kickNotifications(deps: Deps, appointmentId: string): Promise<void> {
  // Create/update/remove the calendar event and video meeting first so emails carry the link.
  await syncMeetingSafe(deps, appointmentId);
  await dispatchNotificationsBatch(deps, { appointmentId }).catch((err) =>
    deps.logger.error({ err, appointmentId }, 'immediate notification dispatch failed; the job will retry'),
  );
}
