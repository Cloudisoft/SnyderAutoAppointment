import type { Deps } from '../../../deps';
import { isEmailSuppressed } from '../../leads/routes';
import { appointmentLink, loadEmailContext, renderAppointmentEmail, resolveTemplate, type EmailKind } from '../email/render';
import { mintAppointmentToken } from '../tokens';

export interface NotificationRow {
  id: string;
  organization_id: string;
  appointment_id: string;
  type: string;
  channel: 'email' | 'sms';
  appointment_version: number;
  recipient: string | null;
  attempts: number;
}

export type DeliveryResult =
  | { status: 'sent'; providerMessage: string }
  | { status: 'skipped'; reason: string };

export function emailKindFor(type: string): EmailKind {
  if (type.startsWith('reminder_')) return 'reminder';
  return type as EmailKind;
}

const PROSPECT_LINK_KINDS: EmailKind[] = ['confirmation', 'reschedule', 'reminder'];
const ACTIVE = ['confirmed', 'rescheduled'];

/** Renders and sends one email notification. Throws on SMTP failure (the dispatcher retries). */
export async function deliverEmailNotification(deps: Deps, n: NotificationRow): Promise<DeliveryResult> {
  const ctx = await loadEmailContext(deps.db, n.appointment_id);
  const kind = emailKindFor(n.type);
  const appt = ctx.appointment;

  // Stale or no-longer-relevant notifications are skipped, never sent.
  if (kind !== 'cancellation' && !ACTIVE.includes(appt.status)) return { status: 'skipped', reason: `appointment is ${appt.status}` };
  if (kind === 'cancellation' && appt.status !== 'cancelled') return { status: 'skipped', reason: 'appointment is no longer cancelled' };
  if (kind !== 'cancellation' && n.appointment_version < appt.version) return { status: 'skipped', reason: 'superseded by a newer version' };
  if (kind === 'reminder' && appt.starts_at.getTime() <= deps.clock.now().getTime()) return { status: 'skipped', reason: 'appointment already started' };

  const to = n.recipient?.trim();
  if (!to) return { status: 'skipped', reason: 'no email address' };
  if (await isEmailSuppressed(deps.db, n.organization_id, to)) return { status: 'skipped', reason: 'email suppressed' };

  let link: string | null = null;
  if (PROSPECT_LINK_KINDS.includes(kind)) {
    const token = await mintAppointmentToken(deps.db, { id: appt.id, organization_id: appt.organization_id, ends_at: appt.ends_at });
    link = appointmentLink(deps.config.APPOINTMENTS_PUBLIC_URL, token);
  }
  const template = await resolveTemplate(deps.db, n.organization_id, kind, ctx.settings);
  // The organization's sender address is also the calendar invite organizer.
  const smtp = await deps.mailer.settingsFor(n.organization_id);
  const config = { ...deps.config, SMTP_FROM_EMAIL: smtp?.fromEmail ?? deps.config.SMTP_FROM_EMAIL };
  const email = renderAppointmentEmail(ctx, { kind, template, link, config, now: deps.clock.now() });
  const res = await deps.mailer.send({
    ...email,
    to,
    organizationId: n.organization_id,
    headers: { 'X-Snyder-Appointment': appt.id, 'X-Snyder-Notification': n.id },
  });
  return { status: 'sent', providerMessage: res.messageId };
}
