import { withTx } from '../../db/pool';
import type { Deps } from '../../deps';
import type { GoogleEventInput, SendUpdates } from '../../integrations/google';
import { neutralize, UpstreamError } from '../../lib/http';
import { loadEmailContext, type AppointmentEmailContext } from '../appointments/email/render';
import { recordAppointmentEvent } from '../appointments/events';
import { notifyInApp } from '../org/notifications';
import { accessTokenFor, getConnection, MeetingSetupError } from './connections';

export type MeetingProvider = 'google_meet' | 'zoom';
export const MEETING_PROVIDERS: MeetingProvider[] = ['google_meet', 'zoom'];

export interface MeetingRow {
  appointment_id: string;
  provider: MeetingProvider | null;
  join_url: string | null;
  zoom_meeting_id: string | null;
  google_event_id: string | null;
  synced_version: number;
  status: 'pending' | 'synced' | 'failed' | 'deleted';
  attempts: number;
  last_error: string | null;
}

/** Retry backoff for meeting sync failures, in minutes. */
const BACKOFF_MINUTES = [1, 5, 15, 60, 180];
export const MAX_MEETING_ATTEMPTS = 8;
const ACTIVE = ['confirmed', 'rescheduled'];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const meetingTiming = { meetPollMs: 1_000 };

function attendeeName(ctx: AppointmentEmailContext): string {
  return [ctx.lead?.first_name, ctx.lead?.last_name].filter(Boolean).join(' ') || ctx.appointment.attendee_name || 'Prospect';
}

function eventDescription(ctx: AppointmentEmailContext, joinUrl: string | null): string {
  const email = ctx.appointment.attendee_email ?? ctx.lead?.email;
  return [
    `${ctx.type.name} booked by ${ctx.businessName}.`,
    joinUrl ? `Join: ${joinUrl}` : null,
    `Prospect: ${attendeeName(ctx)}`,
    ctx.lead?.phone_e164 ? `Phone: ${ctx.lead.phone_e164}` : null,
    email ? `Email: ${email}` : null,
    ctx.lead?.company ? `Company: ${ctx.lead.company}` : null,
    ctx.appointment.notes ? `Notes: ${ctx.appointment.notes}` : null,
    ctx.callSummary ? `Call summary: ${ctx.callSummary}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Creates, updates or removes the Google Calendar event (with Meet link) and/or Zoom meeting for one
 * appointment so they match its current time and status. Idempotent and safe to call repeatedly;
 * serialised per appointment so concurrent callers never create duplicate meetings.
 */
export async function syncAppointmentMeeting(deps: Deps, appointmentId: string): Promise<MeetingRow | null> {
  return withTx(deps.db, async (tx) => {
    await tx.query('select pg_advisory_xact_lock(hashtext($1))', [`meeting:${appointmentId}`]);
    const ctx = await loadEmailContext(tx, appointmentId);
    const appt = ctx.appointment;
    const org = appt.organization_id;
    const provider = (MEETING_PROVIDERS as string[]).includes(ctx.type.location_type) ? (ctx.type.location_type as MeetingProvider) : null;
    const google = await getConnection(tx, org, 'google');
    const existing = (await tx.query<MeetingRow>('select * from appointment_meetings where appointment_id = $1', [appointmentId])).rows[0] ?? null;

    if (!provider && !google && !existing) return null; // nothing to create
    // A person can fix these; the email goes out without a link meanwhile.
    if (provider === 'google_meet' && !google) throw new MeetingSetupError('Google Meet appointments need Google connected. An admin can connect it in Settings → Integrations.');
    const smtp = await deps.mailer.settingsFor(org);
    // We email the prospect ourselves; only let Google email them when our email can't.
    const sendUpdates: SendUpdates = smtp ? 'none' : 'all';

    if (appt.status === 'cancelled') {
      if (!existing || existing.status === 'deleted') return existing;
      if (existing.zoom_meeting_id) await deps.zoom.deleteMeeting(await accessTokenFor(deps, org, 'zoom'), existing.zoom_meeting_id);
      if (existing.google_event_id && google) await deps.google.deleteEvent(await accessTokenFor(deps, org, 'google'), existing.google_event_id, sendUpdates);
      const { rows } = await tx.query<MeetingRow>(
        `update appointment_meetings set status = 'deleted', last_error = null where appointment_id = $1 returning *`,
        [appointmentId],
      );
      return rows[0]!;
    }
    if (!ACTIVE.includes(appt.status)) return existing; // not booked yet
    if (existing?.status === 'synced' && existing.synced_version >= appt.version) return existing;

    // Ids are saved outside this transaction the moment a meeting/event exists, so a failure later
    // in the sync (and the rollback) never leads a retry to create a duplicate.
    const persistIds = (ids: { zoomId: string | null; googleId: string | null; joinUrl: string | null }) =>
      deps.db.query(
        `insert into appointment_meetings(appointment_id, organization_id, provider, zoom_meeting_id, google_event_id, join_url)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (appointment_id) do update set provider = excluded.provider,
           zoom_meeting_id = coalesce(excluded.zoom_meeting_id, appointment_meetings.zoom_meeting_id),
           google_event_id = coalesce(excluded.google_event_id, appointment_meetings.google_event_id),
           join_url = coalesce(excluded.join_url, appointment_meetings.join_url)`,
        [appointmentId, org, provider, ids.zoomId, ids.googleId, ids.joinUrl],
      );
    let joinUrl = existing?.join_url ?? null;
    let zoomId = existing?.zoom_meeting_id ?? null;
    let googleId = existing?.google_event_id ?? null;
    const title = `${ctx.type.name} with ${provider ? ctx.host.display_name : attendeeName(ctx)}`.slice(0, 200);

    if (provider === 'zoom') {
      const token = await accessTokenFor(deps, org, 'zoom');
      const input = {
        topic: `${ctx.type.name}: ${ctx.businessName} and ${attendeeName(ctx)}`,
        agenda: ctx.type.description ?? '',
        start: appt.starts_at,
        durationMinutes: Math.round((appt.ends_at.getTime() - appt.starts_at.getTime()) / 60_000),
        timeZone: ctx.host.time_zone,
      };
      if (zoomId) await deps.zoom.updateMeeting(token, zoomId, input);
      else {
        ({ id: zoomId, joinUrl } = await deps.zoom.createMeeting(token, input));
        await persistIds({ zoomId, googleId: null, joinUrl });
      }
    }

    if (google) {
      const token = await accessTokenFor(deps, org, 'google');
      const attendees: GoogleEventInput['attendees'] = [];
      const invitee = ctx.appointment.attendee_email ?? ctx.lead?.email;
      if (invitee) attendees.push({ email: invitee, displayName: attendeeName(ctx) });
      if (ctx.host.email && ctx.host.email.toLowerCase() !== google.account_email?.toLowerCase()) {
        attendees.push({ email: ctx.host.email, displayName: ctx.host.display_name });
      }
      const input: GoogleEventInput = {
        summary: title,
        description: eventDescription(ctx, provider === 'zoom' ? joinUrl : null),
        location: provider === 'zoom' && joinUrl ? joinUrl : ctx.type.location_details ?? undefined,
        start: appt.starts_at,
        end: appt.ends_at,
        timeZone: ctx.host.time_zone,
        attendees,
        meetRequestId: provider === 'google_meet' ? `appt-${appointmentId}` : undefined,
      };
      let event = googleId ? await deps.google.patchEvent(token, googleId, input, sendUpdates) : await deps.google.insertEvent(token, input, sendUpdates);
      if (!googleId) await persistIds({ zoomId, googleId: event.id, joinUrl: provider === 'zoom' ? joinUrl : null });
      googleId = event.id;
      if (provider === 'google_meet') {
        for (let i = 0; i < 3 && !event.meetUrl && event.meetPending; i++) {
          await sleep(meetingTiming.meetPollMs);
          event = await deps.google.getEvent(token, event.id);
        }
        if (!event.meetUrl) throw new Error('Google is still creating the Meet link');
        joinUrl = event.meetUrl;
      }
    }

    const { rows } = await tx.query<MeetingRow>(
      `insert into appointment_meetings(appointment_id, organization_id, provider, join_url, zoom_meeting_id, google_event_id, synced_version, status, attempts, last_error)
       values ($1, $2, $3, $4, $5, $6, $7, 'synced', 0, null)
       on conflict (appointment_id) do update set provider = excluded.provider, join_url = excluded.join_url, zoom_meeting_id = excluded.zoom_meeting_id,
         google_event_id = excluded.google_event_id, synced_version = excluded.synced_version, status = 'synced', attempts = 0, last_error = null
       returning *`,
      [appointmentId, org, provider, provider ? joinUrl : null, zoomId, googleId, appt.version],
    );
    await recordAppointmentEvent(tx, {
      organizationId: org,
      appointmentId,
      type: existing?.status === 'synced' ? 'meeting_updated' : 'meeting_created',
      actorType: 'system',
      metadata: { provider, calendar: !!googleId, joinUrl },
    });
    return rows[0]!;
  });
}

/** Records a failed sync for the retry job and tells admins when a person needs to act. */
export async function recordMeetingFailure(deps: Deps, appointmentId: string, err: unknown): Promise<void> {
  const message = neutralize(err instanceof UpstreamError ? err.userMessage : (err as Error)?.message || String(err)).slice(0, 1000);
  const setup = err instanceof MeetingSetupError;
  const { rows } = await deps.db.query<{ organization_id: string; attempts: number }>(
    `insert into appointment_meetings(appointment_id, organization_id, status, attempts, last_error, next_attempt_at)
     select a.id, a.organization_id, 'failed', 1, $2, now() + make_interval(mins => $3) from appointments a where a.id = $1
     on conflict (appointment_id) do update set status = 'failed', attempts = appointment_meetings.attempts + 1, last_error = $2,
       next_attempt_at = now() + make_interval(mins => (array[1,5,15,60,180])[least(appointment_meetings.attempts + 1, 5)])
     returning organization_id, attempts`,
    [appointmentId, message, setup ? 60 : BACKOFF_MINUTES[0]],
  );
  const r = rows[0];
  if (!r) return;
  await recordAppointmentEvent(deps.db, { organizationId: r.organization_id, appointmentId, type: 'meeting_failed', actorType: 'system', metadata: { error: message, attempt: r.attempts } });
  if (setup && r.attempts === 1) {
    await notifyInApp(deps.db, {
      organizationId: r.organization_id,
      permission: 'settings.manage',
      type: 'meeting_setup',
      title: 'Meeting link could not be created',
      body: message,
      link: '/settings/integrations',
      metadata: { appointmentId },
    });
  }
}

/** Best-effort sync used right after booking/rescheduling/cancelling; failures go to the retry job. */
export async function syncMeetingSafe(deps: Deps, appointmentId: string): Promise<MeetingRow | null> {
  try {
    return await syncAppointmentMeeting(deps, appointmentId);
  } catch (err) {
    deps.logger.warn({ err, appointmentId }, 'meeting sync failed; will retry');
    await recordMeetingFailure(deps, appointmentId, err).catch((e) => deps.logger.error({ err: e }, 'could not record meeting failure'));
    return null;
  }
}

/** Retries failed or pending meeting syncs (job). */
export async function meetingSyncBatch(deps: Deps, limit = 25): Promise<{ processed: number }> {
  const { rows } = await deps.db.query<{ appointment_id: string }>(
    `select m.appointment_id from appointment_meetings m join appointments a on a.id = m.appointment_id
      where m.status in ('pending', 'failed') and m.attempts < $2 and m.next_attempt_at <= now() and a.ends_at > now()
      order by m.next_attempt_at limit $1`,
    [limit, MAX_MEETING_ATTEMPTS],
  );
  for (const r of rows) await syncMeetingSafe(deps, r.appointment_id);
  return { processed: rows.length };
}
