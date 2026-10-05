import type { Deps } from '../../../deps';
import type { DeliveryResult, NotificationRow } from './email';

/**
 * Future Twilio Messaging channel for SMS confirmations and reminders. Stubbed behind the
 * SMS_APPOINTMENTS_ENABLED feature flag (off by default) and the per-campaign sms_enabled switch.
 * Opt-outs (STOP) are honoured before anything is sent.
 */
export async function deliverSmsNotification(deps: Deps, n: NotificationRow): Promise<DeliveryResult> {
  if (!deps.config.SMS_APPOINTMENTS_ENABLED) return { status: 'skipped', reason: 'SMS channel disabled (SMS_APPOINTMENTS_ENABLED=false)' };
  const { rows } = await deps.db.query<{ phone_e164: string | null }>(
    `select l.phone_e164 from appointments a left join leads l on l.id = a.lead_id where a.id = $1`,
    [n.appointment_id],
  );
  const phone = rows[0]?.phone_e164;
  if (!phone) return { status: 'skipped', reason: 'no phone number' };
  const optedOut = await deps.db.query('select 1 from sms_opt_outs where organization_id = $1 and phone_e164 = $2', [n.organization_id, phone]);
  if (optedOut.rowCount) return { status: 'skipped', reason: 'recipient opted out (STOP)' };
  deps.logger.warn({ notificationId: n.id }, 'SMS sender is stubbed; enable the Twilio Messaging implementation before turning SMS on');
  return { status: 'skipped', reason: 'SMS sender not implemented yet' };
}

const STOP_WORDS = ['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit', 'optout', 'revoke'];
const START_WORDS = ['start', 'unstop', 'yes'];

export function classifyInboundSms(body: string): 'stop' | 'start' | null {
  const word = body.trim().toLowerCase().replace(/[^a-z]/g, '');
  if (STOP_WORDS.includes(word)) return 'stop';
  if (START_WORDS.includes(word)) return 'start';
  return null;
}
