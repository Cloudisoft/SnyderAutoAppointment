import { ACTIVE_APPOINTMENT_STATUSES, type AppointmentSettings } from '@snyder/shared';
import { DateTime } from 'luxon';
import type { DbClient } from '../../../db/pool';
import { assignHosts, generateHostSlots, pickOfferedSlots, searchBounds, type HostAvailability, type SlotRules } from './slots';
import { displaySlotLabel, spokenSlotLabel } from './spoken';

export interface AppointmentTypeRow {
  id: string;
  name: string;
  duration_minutes: number;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  location_type: string;
  location_details: string | null;
  description: string | null;
  is_active: boolean;
}

export interface OpenSlot {
  hostId: string;
  startUtc: string;
  endUtc: string;
  /** ISO in the lead's time zone. */
  startLocal: string;
  leadTimeZone: string;
  /** Cartesia-friendly: "Tuesday, October thirteenth at eleven a.m. Eastern". */
  spokenLabel: string;
  /** For screens: "Tuesday, October 13 at 11:00 AM EDT". */
  displayLabel: string;
}

export interface GetOpenSlotsInput {
  db: DbClient;
  organizationId: string;
  settings: AppointmentSettings;
  now: Date;
  leadTimeZone: string;
  limit?: number;
  from?: Date;
  to?: Date;
  preferredDay?: string;
  preferredTimeOfDay?: string;
  /** Ignore this appointment's own slot (rescheduling). */
  excludeAppointmentId?: string;
  /** Return every open slot instead of a spread selection (public reschedule page). */
  all?: boolean;
}

export interface OpenSlotsResult {
  slots: OpenSlot[];
  matchedPreference: boolean;
  appointmentType: AppointmentTypeRow | null;
}

export async function loadAppointmentType(db: DbClient, organizationId: string, id: string | null): Promise<AppointmentTypeRow | null> {
  if (!id) return null;
  const { rows } = await db.query<AppointmentTypeRow>(
    'select * from appointment_types where id = $1 and organization_id = $2',
    [id, organizationId],
  );
  return rows[0] ?? null;
}

/** Host ids eligible under the campaign's assignment strategy, in configured order. */
export function hostPool(settings: AppointmentSettings): string[] {
  const ids = settings.host_assignment.host_ids;
  return settings.host_assignment.strategy === 'specific_host' ? ids.slice(0, 1) : ids;
}

/**
 * Builds candidate slots from the host pool's weekly rules and exceptions, removes existing
 * appointments plus buffers, applies min notice / max days ahead, assigns a host per start
 * time and returns slots in UTC and the lead's zone with spoken labels.
 */
export async function getOpenSlots(input: GetOpenSlotsInput): Promise<OpenSlotsResult> {
  const { db, organizationId, settings, now } = input;
  const type = await loadAppointmentType(db, organizationId, settings.appointment_type_id);
  const pool = hostPool(settings);
  if (!type || !type.is_active || !pool.length) return { slots: [], matchedPreference: false, appointmentType: type };

  const rules: SlotRules = {
    now,
    durationMinutes: type.duration_minutes,
    bufferBeforeMinutes: type.buffer_before_minutes,
    bufferAfterMinutes: type.buffer_after_minutes,
    minNoticeMinutes: settings.min_notice_minutes,
    maxDaysAhead: settings.max_days_ahead,
    from: input.from,
    to: input.to,
  };
  const bounds = searchBounds(rules);
  if (bounds.end <= bounds.start) return { slots: [], matchedPreference: false, appointmentType: type };
  // Widen the DB window by a day so buffers and zone edges are covered.
  const qFrom = new Date(bounds.start.getTime() - 86_400_000).toISOString();
  const qTo = new Date(bounds.end.getTime() + 86_400_000).toISOString();

  const [hosts, ruleRows, exceptionRows, busyRows, counts] = await Promise.all([
    db.query<{ id: string; time_zone: string; last_assigned_at: Date | null }>(
      `select id, time_zone, last_assigned_at from appointment_hosts
        where organization_id = $1 and id = any($2::uuid[]) and is_active`,
      [organizationId, pool],
    ),
    db.query<{ host_id: string; weekday: number; start_time: string; end_time: string }>(
      `select host_id, weekday, to_char(start_time, 'HH24:MI') as start_time, to_char(end_time, 'HH24:MI') as end_time
         from availability_rules where host_id = any($1::uuid[])`,
      [pool],
    ),
    db.query<{ host_id: string; starts_at: Date; ends_at: Date; type: 'blocked' | 'extra_open' }>(
      `select host_id, starts_at, ends_at, type from availability_exceptions
        where host_id = any($1::uuid[]) and ends_at > $2 and starts_at < $3`,
      [pool, qFrom, qTo],
    ),
    db.query<{ host_id: string; buffered_starts_at: Date; buffered_ends_at: Date }>(
      `select host_id, buffered_starts_at, buffered_ends_at from appointments
        where host_id = any($1::uuid[]) and status = any($2::text[])
          and buffered_ends_at > $3 and buffered_starts_at < $4
          and ($5::uuid is null or id <> $5)`,
      [pool, ACTIVE_APPOINTMENT_STATUSES, qFrom, qTo, input.excludeAppointmentId ?? null],
    ),
    db.query<{ host_id: string; n: number }>(
      `select host_id, count(*)::int as n from appointments
        where host_id = any($1::uuid[]) and status = any($2::text[]) and starts_at > $3 group by host_id`,
      [pool, ACTIVE_APPOINTMENT_STATUSES, now.toISOString()],
    ),
  ]);

  const availability: HostAvailability[] = hosts.rows.map((h) => ({
    hostId: h.id,
    timeZone: h.time_zone,
    rules: ruleRows.rows.filter((r) => r.host_id === h.id).map((r) => ({ weekday: r.weekday, start: r.start_time, end: r.end_time })),
    exceptions: exceptionRows.rows.filter((e) => e.host_id === h.id).map((e) => ({ startsAt: e.starts_at, endsAt: e.ends_at, type: e.type })),
    busy: busyRows.rows.filter((b) => b.host_id === h.id).map((b) => ({ start: b.buffered_starts_at, end: b.buffered_ends_at })),
  }));

  const perHost = availability.flatMap((h) => generateHostSlots(h, rules));
  const assigned = assignHosts(perHost, settings.host_assignment.strategy, {
    hostOrder: pool,
    lastAssignedAt: Object.fromEntries(hosts.rows.map((h) => [h.id, h.last_assigned_at])),
    upcomingCounts: Object.fromEntries(counts.rows.map((c) => [c.host_id, c.n])),
  });

  const picked = input.all
    ? { slots: assigned.slice(0, input.limit ?? assigned.length), matchedPreference: true }
    : pickOfferedSlots(assigned, {
        limit: input.limit ?? settings.slots_to_offer,
        leadTimeZone: input.leadTimeZone,
        now,
        preferredDay: input.preferredDay,
        preferredTimeOfDay: input.preferredTimeOfDay,
      });

  return {
    appointmentType: type,
    matchedPreference: picked.matchedPreference,
    slots: picked.slots.map((s) => ({
      hostId: s.hostId,
      startUtc: s.start.toISOString(),
      endUtc: s.end.toISOString(),
      startLocal: DateTime.fromJSDate(s.start, { zone: input.leadTimeZone }).toISO()!,
      leadTimeZone: input.leadTimeZone,
      spokenLabel: spokenSlotLabel(s.start, input.leadTimeZone, now),
      displayLabel: displaySlotLabel(s.start, input.leadTimeZone),
    })),
  };
}

/** True if a specific host/start is still bookable under the same rules (used before booking). */
export async function isSlotOpen(input: Omit<GetOpenSlotsInput, 'limit' | 'all'> & { hostId: string; startUtc: string }): Promise<boolean> {
  const start = new Date(input.startUtc);
  const result = await getOpenSlots({
    ...input,
    settings: { ...input.settings, host_assignment: { strategy: 'round_robin', host_ids: [input.hostId] } },
    from: new Date(start.getTime() - 60_000),
    to: new Date(start.getTime() + 60_000),
    all: true,
  });
  return result.slots.some((s) => s.hostId === input.hostId && s.startUtc === start.toISOString());
}
