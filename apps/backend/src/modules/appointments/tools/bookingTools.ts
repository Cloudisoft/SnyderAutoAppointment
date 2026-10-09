import { z } from 'zod';
import { isPgError, PG, withTx } from '../../../db/pool';
import type { Deps } from '../../../deps';
import { TimeoutError, withTimeout } from '../../../lib/http';
import { addCallEvent } from '../../calls/events';
import type { ToolContext, ToolDefinition } from '../../calls/tools';
import { getOpenSlots, type OpenSlot } from '../availability/service';
import { spokenEmail } from '../availability/spoken';
import { recordAppointmentEvent } from '../events';
import { findOffer, loadBookingContext, storeOffers, type BookingContext } from './context';

/** Availability lookups must answer well inside Vapi's tool timeout. */
export const AVAILABILITY_TIMEOUT_MS = 4_500;

export const BOOKING_FALLBACK =
  "I'm sorry, I'm having trouble reaching the calendar right now. Offer to have someone follow up by email to find a time, or to call them back, then wrap up politely.";

const SLOW_CALENDAR =
  "The calendar is taking too long to respond. Apologise, offer to send them an email to pick a time or to call back, and don't invent any times.";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(email: string | undefined | null): email is string {
  return !!email && EMAIL_RE.test(email.trim()) && email.length <= 254;
}

function describeOffers(ids: string[], slots: OpenSlot[]): string {
  return slots.map((s, i) => `${ids[i]}: ${s.spokenLabel}`).join('; ');
}

async function offerSlots(
  deps: Deps,
  ctx: BookingContext,
  prefs: { preferredDay?: string; preferredTimeOfDay?: string },
): Promise<{ ids: string[]; slots: OpenSlot[]; matchedPreference: boolean }> {
  const result = await withTimeout(
    getOpenSlots({
      db: deps.db,
      organizationId: ctx.call.organization_id,
      settings: ctx.settings,
      now: deps.clock.now(),
      leadTimeZone: ctx.leadTimeZone,
      limit: ctx.settings.slots_to_offer,
      ...prefs,
    }),
    AVAILABILITY_TIMEOUT_MS,
    'availability lookup',
  );
  const ids = await storeOffers(
    deps.db,
    ctx.call.id,
    result.slots.map((s) => ({ hostId: s.hostId, startUtc: s.startUtc, endUtc: s.endUtc, spokenLabel: s.spokenLabel })),
  );
  return { ids, slots: result.slots, matchedPreference: result.matchedPreference };
}

const CheckArgs = z.object({
  preferred_day: z.string().max(60).optional(),
  preferred_time_of_day: z.string().max(30).optional(),
});

export const checkAvailabilityTool: ToolDefinition = {
  name: 'check_availability',
  timeoutMs: 8_000,
  fallbackMessage: BOOKING_FALLBACK,
  async handler({ deps, call, args }: ToolContext) {
    const a = CheckArgs.parse(args);
    const ctx = await loadBookingContext(deps.db, call);
    if (!ctx.settings.booking_enabled) {
      return "Scheduling isn't available on this call. Offer to have someone follow up by email instead.";
    }
    let offered;
    try {
      offered = await offerSlots(deps, ctx, { preferredDay: a.preferred_day, preferredTimeOfDay: a.preferred_time_of_day });
    } catch (err) {
      if (err instanceof TimeoutError) {
        deps.logger.error({ err, callId: call.id }, 'VAPI TOOL SLOW: availability lookup timed out; returned fallback');
        return SLOW_CALENDAR;
      }
      throw err;
    }
    if (!offered.slots.length) {
      return `There are no open times in the next ${ctx.settings.max_days_ahead} days. Don't suggest any times. Offer to have someone email them to find a time that works.`;
    }
    const preface = offered.matchedPreference
      ? 'Open times'
      : 'Nothing is open for the requested day or time. The closest open times are';
    return `${preface}: ${describeOffers(offered.ids, offered.slots)}. Offer only these times, read exactly as written. When they choose one, read back the day, date, time and time zone, get a clear yes, then call book_appointment with that slot_id.`;
  },
};

const BookArgs = z.object({
  slot_id: z.string().min(1).max(40),
  attendee_name: z.string().max(200).optional(),
  attendee_email: z.string().max(254).optional(),
  notes: z.string().max(2_000).optional(),
});

export const bookAppointmentTool: ToolDefinition = {
  name: 'book_appointment',
  timeoutMs: 9_000,
  fallbackMessage: BOOKING_FALLBACK,
  async handler({ deps, call, args }: ToolContext) {
    const a = BookArgs.parse(args);
    const ctx = await loadBookingContext(deps.db, call);
    if (!ctx.settings.booking_enabled) {
      return "Scheduling isn't available on this call. Offer to have someone follow up by email instead.";
    }
    const email = a.attendee_email?.trim().toLowerCase().replace(/\s+/g, '') || null;
    if (email && !isValidEmail(email)) {
      return `That email address doesn't look complete (${spokenEmail(email)}). Ask them to say it again, spell it back to confirm, then call book_appointment again.`;
    }
    if (!email && ctx.settings.require_email) {
      return 'An email address is required to send the confirmation. Ask for their email, spell it back to confirm, then call book_appointment again.';
    }
    const offer = await findOffer(deps.db, call.id, a.slot_id);
    if (!offer) {
      return "That time isn't one of the offered options. Call check_availability again and offer only the times it returns.";
    }
    const now = deps.clock.now();
    if (new Date(offer.startUtc).getTime() < now.getTime() + 5 * 60_000) {
      return 'That time has already passed or is too soon. Call check_availability again for fresh options.';
    }
    const { rows: typeRows } = await deps.db.query<{ buffer_before_minutes: number; buffer_after_minutes: number; location_type: string }>(
      'select buffer_before_minutes, buffer_after_minutes, location_type from appointment_types where id = $1',
      [ctx.settings.appointment_type_id],
    );
    const type = typeRows[0];
    if (!type) throw new Error('appointment type missing for booking');
    const attendeeName = a.attendee_name?.trim() || [ctx.lead?.first_name, ctx.lead?.last_name].filter(Boolean).join(' ') || null;
    const holdUntil = new Date(now.getTime() + ctx.settings.hold_minutes * 60_000);

    try {
      const booked = await withTx(deps.db, async (client) => {
        // Serialize booking attempts within this call (e.g. the AI retrying).
        await client.query('select id from calls where id = $1 for update', [call.id]);
        const existing = await client.query<{ id: string; host_id: string; starts_at: Date }>(
          `select id, host_id, starts_at from appointments where call_id = $1 and status = 'pending'`,
          [call.id],
        );
        const same = existing.rows.find((r) => r.host_id === offer.hostId && r.starts_at.toISOString() === offer.startUtc);
        if (same) {
          await client.query('update appointments set attendee_email = coalesce($2, attendee_email), notes = coalesce($3, notes) where id = $1', [
            same.id,
            email,
            a.notes ?? null,
          ]);
          return { id: same.id, reused: true };
        }
        // The prospect changed their mind during the call: release the earlier hold.
        for (const old of existing.rows) {
          await client.query(`update appointments set status = 'cancelled', cancelled_at = now(), cancel_reason = 'replaced during call' where id = $1`, [old.id]);
          await recordAppointmentEvent(client, { organizationId: call.organization_id, appointmentId: old.id, type: 'cancelled', actorType: 'ai', metadata: { reason: 'replaced during call' } });
        }
        const { rows } = await client.query<{ id: string }>(
          `insert into appointments(organization_id, campaign_id, campaign_version_id, lead_id, call_id, appointment_type_id, host_id,
                                    starts_at, ends_at, lead_time_zone, status, hold_expires_at, attendee_name, attendee_email, notes,
                                    source, buffer_before_minutes, buffer_after_minutes)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11,$12,$13,$14,'ai_tool',$15,$16) returning id`,
          [
            call.organization_id, call.campaign_id, call.campaign_version_id, call.lead_id, call.id, ctx.settings.appointment_type_id,
            offer.hostId, offer.startUtc, offer.endUtc, ctx.leadTimeZone, holdUntil.toISOString(), attendeeName, email,
            a.notes?.trim() || null, type.buffer_before_minutes, type.buffer_after_minutes,
          ],
        );
        await client.query('update appointment_hosts set last_assigned_at = now() where id = $1', [offer.hostId]);
        await recordAppointmentEvent(client, {
          organizationId: call.organization_id,
          appointmentId: rows[0]!.id,
          type: 'booked',
          actorType: 'ai',
          metadata: { callId: call.id, holdUntil: holdUntil.toISOString() },
        });
        return { id: rows[0]!.id, reused: false };
      });

      const { rows: hostRows } = await deps.db.query<{ display_name: string }>('select display_name from appointment_hosts where id = $1', [offer.hostId]);
      const hostName = hostRows[0]?.display_name.split(' ')[0] ?? 'our team';
      await addCallEvent(deps.db, {
        organizationId: call.organization_id,
        callId: call.id,
        type: 'booking',
        content: `Appointment held for ${offer.spokenLabel} with ${hostRows[0]?.display_name ?? 'host'} (confirmed when the call ends)`,
        metadata: { appointmentId: booked.id, startUtc: offer.startUtc },
      });
      const emailPart = email ? ` to ${spokenEmail(email)}` : '';
      const video = type.location_type === 'zoom' ? 'the Zoom link' : type.location_type === 'google_meet' ? 'the Google Meet link' : null;
      const what = video ? `A confirmation email with ${video} and a link to reschedule or cancel` : 'A confirmation email with a link to reschedule or cancel';
      return `Booked: ${offer.spokenLabel} with ${hostName}. Tell them: "You're all set for ${offer.spokenLabel}. ${what} is on its way${emailPart}." Then thank them, say goodbye and end the call.`;
    } catch (err) {
      if (!isPgError(err, PG.exclusionViolation)) throw err;
      // Someone else took the slot a moment ago: offer fresh alternatives instead of failing.
      let fresh;
      try {
        fresh = await offerSlots(deps, ctx, {});
      } catch (inner) {
        if (inner instanceof TimeoutError) return SLOW_CALENDAR;
        throw inner;
      }
      await addCallEvent(deps.db, {
        organizationId: call.organization_id,
        callId: call.id,
        type: 'booking',
        content: `Slot ${offer.spokenLabel} was just taken; offered alternatives`,
      });
      if (!fresh.slots.length) {
        return "That time was just taken and there are no other open times right now. Apologise and offer to have someone email them to find a time.";
      }
      return `That time was just taken by someone else. Apologise and offer these instead: ${describeOffers(fresh.ids, fresh.slots)}. Read back their choice and get a clear yes before calling book_appointment again.`;
    }
  },
};

export const bookingTools: ToolDefinition[] = [checkAvailabilityTool, bookAppointmentTool];
