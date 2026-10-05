import type { AppointmentSettings } from '@snyder/shared';
import type pg from 'pg';
import type { DbClient } from '../../db/pool';
import type { Deps } from '../../deps';
import type { CallEndStep } from '../calls/endOfCall';
import type { CallOutcome } from '../calls/outcome';
import type { CallRow } from '../calls/types';
import { loadVersionSnapshot } from '../campaigns/service';
import { recordAppointmentEvent } from './events';
import { enqueueNotification, prospectChannels } from './notifications/queue';
import { appointmentSettingsOf } from './settings';

export const TOKEN_TTL_DAYS_AFTER_END = 30;

export interface AppointmentRow {
  id: string;
  organization_id: string;
  campaign_id: string | null;
  campaign_version_id: string | null;
  lead_id: string | null;
  call_id: string | null;
  host_id: string;
  appointment_type_id: string;
  starts_at: Date;
  ends_at: Date;
  status: string;
  attendee_email: string | null;
  attendee_name: string | null;
  lead_time_zone: string;
  version: number;
  source: string;
}

export async function settingsForAppointment(db: DbClient, appt: Pick<AppointmentRow, 'campaign_version_id'>): Promise<AppointmentSettings | null> {
  if (!appt.campaign_version_id) return null;
  return appointmentSettingsOf(await loadVersionSnapshot(db, appt.campaign_version_id));
}

/**
 * Confirms one appointment (pending from the AI, or needs_review approved by a supervisor):
 * status, token expiry (ends_at + 30 days), audit event, lead status, and the confirmation +
 * host notice notifications. Safe to call twice: only pending/needs_review rows are touched.
 * The access token itself is minted when the confirmation email is sent; only its hash is stored.
 */
export async function confirmAppointment(
  client: pg.PoolClient,
  deps: Deps,
  appointmentId: string,
  actor: { type: 'system' | 'user'; id?: string | null },
): Promise<AppointmentRow | null> {
  const { rows } = await client.query<AppointmentRow>(
    `update appointments set status = 'confirmed', confirmed_at = now(), hold_expires_at = null,
            token_expires_at = ends_at + make_interval(days => $2)
      where id = $1 and status in ('pending', 'needs_review')
      returning *`,
    [appointmentId, TOKEN_TTL_DAYS_AFTER_END],
  );
  const appt = rows[0];
  if (!appt) return null;
  await recordAppointmentEvent(client, {
    organizationId: appt.organization_id,
    appointmentId: appt.id,
    type: 'confirmed',
    actorType: actor.type,
    actorId: actor.id ?? null,
    metadata: { source: appt.source, callId: appt.call_id },
  });
  if (appt.lead_id) {
    await client.query(`update leads set status = 'appointment_booked' where id = $1 and status <> 'do_not_call'`, [appt.lead_id]);
    // Never dial a booked lead again.
    await client.query(
      `update campaign_leads set state = 'done' where lead_id = $1 and state in ('queued', 'retry_wait')`,
      [appt.lead_id],
    );
  }
  const settings = await settingsForAppointment(client, appt);
  for (const channel of prospectChannels(settings, deps.config.SMS_APPOINTMENTS_ENABLED)) {
    await enqueueNotification(client, {
      organizationId: appt.organization_id,
      appointmentId: appt.id,
      type: 'confirmation',
      channel,
      appointmentVersion: appt.version,
      recipient: channel === 'email' ? appt.attendee_email : null,
    });
  }
  const { rows: host } = await client.query<{ email: string }>('select email from appointment_hosts where id = $1', [appt.host_id]);
  await enqueueNotification(client, {
    organizationId: appt.organization_id,
    appointmentId: appt.id,
    type: 'host_notice',
    channel: 'email',
    appointmentVersion: appt.version,
    recipient: host[0]?.email ?? null,
  });
  return appt;
}

/** Releases holds that will never be confirmed (non-connected outcome, DNC, or expired hold). */
export async function releaseHolds(client: DbClient, where: { callId?: string; appointmentIds?: string[] }, reason: string) {
  const { rows } = await client.query<{ id: string; organization_id: string }>(
    `update appointments set status = 'cancelled', cancelled_at = now(), cancel_reason = $3, hold_expires_at = null
      where status = 'pending' and (($1::uuid is not null and call_id = $1) or ($2::uuid[] is not null and id = any($2)))
      returning id, organization_id`,
    [where.callId ?? null, where.appointmentIds ?? null, reason],
  );
  for (const r of rows) {
    await recordAppointmentEvent(client, { organizationId: r.organization_id, appointmentId: r.id, type: 'hold_released', actorType: 'system', metadata: { reason } });
  }
  return rows.map((r) => r.id);
}

/**
 * End-of-call step (webhook and reconciliation): a connected call confirms its pending holds;
 * voicemail, DNC, no answer and other non-connected outcomes never confirm and release them.
 */
export const appointmentsEndStep: CallEndStep = {
  name: 'appointments',
  async run(client, deps, call: CallRow, outcome: CallOutcome) {
    const { rows: pending } = await client.query<{ id: string }>(
      `select id from appointments where call_id = $1 and status = 'pending' order by created_at for update`,
      [call.id],
    );
    if (!pending.length) return { appointmentBooked: false };
    if (!outcome.connected || outcome.dncRequested) {
      const reason = outcome.dncRequested ? 'do not call requested' : `call not connected (${outcome.endedReason ?? 'unknown'})`;
      await releaseHolds(client, { callId: call.id }, reason);
      return { appointmentBooked: false };
    }
    let confirmed = 0;
    for (const p of pending) if (await confirmAppointment(client, deps, p.id, { type: 'system' })) confirmed++;
    return { appointmentBooked: confirmed > 0 };
  },
};
