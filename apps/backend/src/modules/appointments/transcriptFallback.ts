import type { Deps } from '../../deps';
import type { CallExtraction } from '../../integrations/openai';
import { resolveLeadTimeZone } from '../../lib/timezone';
import type { SummaryStep } from '../calls/summary';
import { loadVersionSnapshot } from '../campaigns/service';
import { notifyInApp } from '../org/notifications';
import { hostPool } from './availability/service';
import { displaySlotLabel } from './availability/spoken';
import { recordAppointmentEvent } from './events';
import { appointmentSettingsOf } from './settings';
import type pg from 'pg';

/**
 * Transcript fallback: when a connected call produced no appointment but the post-call summary
 * found an agreed meeting time, create the appointment as needs_review (source
 * transcript_extraction). The prospect is NOT emailed; supervisors are notified in-app and can
 * confirm it from the UI, which then sends the confirmation.
 */
export const transcriptFallbackStep: SummaryStep = {
  name: 'appointments-transcript-fallback',
  async run(client: pg.PoolClient, deps: Deps, callId: string, extraction: CallExtraction) {
    if (!extraction.meeting_agreed || !extraction.meeting_start) return;
    const start = new Date(extraction.meeting_start);
    if (Number.isNaN(start.getTime()) || start.getTime() < deps.clock.now().getTime()) return;

    const { rows } = await client.query<{
      organization_id: string;
      campaign_id: string | null;
      campaign_version_id: string | null;
      lead_id: string | null;
      to_number: string;
      connected: boolean;
      dnc_requested: boolean;
      voicemail: boolean;
      first_name: string | null;
      last_name: string | null;
      email: string | null;
      lead_tz: string | null;
    }>(
      `select c.organization_id, c.campaign_id, c.campaign_version_id, c.lead_id, c.to_number, c.connected, c.dnc_requested,
              c.voicemail, l.first_name, l.last_name, l.email, l.time_zone as lead_tz
         from calls c left join leads l on l.id = c.lead_id where c.id = $1`,
      [callId],
    );
    const call = rows[0];
    if (!call || !call.connected || call.voicemail || call.dnc_requested || !call.campaign_version_id) return;
    const existing = await client.query('select 1 from appointments where call_id = $1 limit 1', [callId]);
    if (existing.rowCount) return;

    const snapshot = await loadVersionSnapshot(client, call.campaign_version_id);
    const settings = appointmentSettingsOf(snapshot);
    const typeId = settings.appointment_type_id;
    const pool = hostPool(settings);
    const leadTz = resolveLeadTimeZone({ leadTimeZone: call.lead_tz, phoneE164: call.to_number, campaignTimeZone: snapshot.time_zone }).timeZone;
    const leadName = [call.first_name, call.last_name].filter(Boolean).join(' ') || call.to_number;

    if (!typeId || !pool.length) {
      await notifyInApp(client, {
        organizationId: call.organization_id,
        permission: 'appointments.manage',
        type: 'appointment_needs_review',
        title: `Possible meeting agreed with ${leadName}`,
        body: `The call transcript mentions ${displaySlotLabel(start, leadTz)}, but this campaign has no appointment type or hosts set up. Follow up manually.`,
        link: `/calls?call=${callId}`,
      });
      return;
    }
    const { rows: type } = await client.query<{ duration_minutes: number; buffer_before_minutes: number; buffer_after_minutes: number }>(
      'select duration_minutes, buffer_before_minutes, buffer_after_minutes from appointment_types where id = $1',
      [typeId],
    );
    if (!type[0]) return;
    const end = new Date(start.getTime() + type[0].duration_minutes * 60_000);
    const { rows: inserted } = await client.query<{ id: string }>(
      `insert into appointments(organization_id, campaign_id, campaign_version_id, lead_id, call_id, appointment_type_id, host_id,
                                starts_at, ends_at, lead_time_zone, status, attendee_name, attendee_email, notes, source,
                                buffer_before_minutes, buffer_after_minutes)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'needs_review',$11,$12,$13,'transcript_extraction',$14,$15) returning id`,
      [
        call.organization_id, call.campaign_id, call.campaign_version_id, call.lead_id, callId, typeId, pool[0],
        start.toISOString(), end.toISOString(), leadTz, leadName, extraction.attendee_email ?? call.email, extraction.notes,
        type[0].buffer_before_minutes, type[0].buffer_after_minutes,
      ],
    );
    const id = inserted[0]!.id;
    await recordAppointmentEvent(client, {
      organizationId: call.organization_id,
      appointmentId: id,
      type: 'needs_review',
      actorType: 'system',
      metadata: { callId, extractedStart: extraction.meeting_start },
    });
    await notifyInApp(client, {
      organizationId: call.organization_id,
      permission: 'appointments.manage',
      type: 'appointment_needs_review',
      title: `Review appointment with ${leadName}`,
      body: `Detected in the call transcript: ${displaySlotLabel(start, leadTz)}. Confirm it to email the prospect.`,
      link: `/appointments?id=${id}`,
      metadata: { appointmentId: id },
    });
  },
};
