import type { HostStrategy } from '@snyder/shared';
import { DateTime } from 'luxon';

/**
 * Pure slot generation. All inputs are explicit (no clock, no DB) so behaviour across buffers,
 * notice windows, exceptions and DST transitions is fully unit-testable.
 */

export interface Interval {
  start: Date;
  end: Date;
}

export interface HostAvailability {
  hostId: string;
  timeZone: string;
  /** Weekly hours in the host's time zone. ISO weekday 1 = Monday ... 7 = Sunday; "HH:MM". */
  rules: { weekday: number; start: string; end: string }[];
  exceptions: { startsAt: Date; endsAt: Date; type: 'blocked' | 'extra_open' }[];
  /** Existing active appointments as BUFFERED ranges (start - their before, end + their after). */
  busy: Interval[];
}

export interface SlotRules {
  now: Date;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  minNoticeMinutes: number;
  maxDaysAhead: number;
  /** Granularity of candidate start times, aligned in the host's local time. Default 30. */
  stepMinutes?: number;
  /** Optional narrower search range. */
  from?: Date;
  to?: Date;
}

export interface Slot {
  hostId: string;
  start: Date;
  end: Date;
}

const MIN = 60_000;

function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = [...list].sort((a, b) => a.start.getTime() - b.start.getTime());
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) {
      if (i.end > last.end) last.end = i.end;
    } else out.push({ start: new Date(i.start), end: new Date(i.end) });
  }
  return out;
}

function subtract(windows: Interval[], blocks: Interval[]): Interval[] {
  let result = windows;
  for (const b of blocks) {
    const next: Interval[] = [];
    for (const w of result) {
      if (!overlaps(w, b)) {
        next.push(w);
        continue;
      }
      if (b.start > w.start) next.push({ start: w.start, end: b.start });
      if (b.end < w.end) next.push({ start: b.end, end: w.end });
    }
    result = next;
  }
  return result;
}

/** Search bounds after applying min notice and max days ahead. */
export function searchBounds(r: SlotRules): Interval {
  const earliest = new Date(Math.max(r.now.getTime() + r.minNoticeMinutes * MIN, r.from?.getTime() ?? 0));
  const horizon = r.now.getTime() + r.maxDaysAhead * 24 * 60 * MIN;
  const latest = new Date(Math.min(horizon, r.to?.getTime() ?? Infinity));
  return { start: earliest, end: latest };
}

/** Opening hours for a host between two instants, built day by day in the host's zone (DST-safe). */
export function hostWindows(host: HostAvailability, range: Interval): Interval[] {
  const windows: Interval[] = [];
  let day = DateTime.fromJSDate(range.start, { zone: host.timeZone }).startOf('day').minus({ days: 1 });
  const lastDay = DateTime.fromJSDate(range.end, { zone: host.timeZone }).startOf('day').plus({ days: 1 });
  while (day <= lastDay) {
    for (const rule of host.rules) {
      if (rule.weekday !== day.weekday) continue;
      const [sh, sm] = rule.start.split(':').map(Number) as [number, number];
      const [eh, em] = rule.end.split(':').map(Number) as [number, number];
      // Luxon shifts nonexistent local times (spring-forward gap) forward, never backward.
      const start = day.set({ hour: sh, minute: sm, second: 0, millisecond: 0 });
      const end = eh === 24 ? day.plus({ days: 1 }) : day.set({ hour: eh, minute: em, second: 0, millisecond: 0 });
      if (end > start) windows.push({ start: start.toJSDate(), end: end.toJSDate() });
    }
    day = day.plus({ days: 1 });
  }
  const extra = host.exceptions.filter((e) => e.type === 'extra_open').map((e) => ({ start: e.startsAt, end: e.endsAt }));
  const blocked = host.exceptions.filter((e) => e.type === 'blocked').map((e) => ({ start: e.startsAt, end: e.endsAt }));
  return subtract(mergeIntervals([...windows, ...extra]), blocked);
}

/** All bookable slots for one host. */
export function generateHostSlots(host: HostAvailability, r: SlotRules): Slot[] {
  const step = r.stepMinutes ?? 30;
  const bounds = searchBounds(r);
  if (bounds.end <= bounds.start) return [];
  const slots: Slot[] = [];
  for (const w of hostWindows(host, bounds)) {
    // First candidate: aligned to the step in host-local time, at or after the window start.
    const local = DateTime.fromJSDate(w.start, { zone: host.timeZone });
    const minutesIntoDay = local.hour * 60 + local.minute + (local.second || local.millisecond ? 1 : 0);
    const aligned = Math.ceil(minutesIntoDay / step) * step;
    // Wall-clock set (not duration math) so DST days don't shift the grid by an hour.
    const day0 = local.startOf('day');
    let t = (aligned >= 1440
      ? day0.plus({ days: 1 })
      : day0.set({ hour: Math.floor(aligned / 60), minute: aligned % 60 })
    ).toJSDate();
    // Guard against DST making startOf('day')+minutes land before the window.
    if (t < w.start) t = w.start;
    for (; t.getTime() + r.durationMinutes * MIN <= w.end.getTime(); t = new Date(t.getTime() + step * MIN)) {
      if (t < bounds.start || t > bounds.end) continue;
      const end = new Date(t.getTime() + r.durationMinutes * MIN);
      const buffered = {
        start: new Date(t.getTime() - r.bufferBeforeMinutes * MIN),
        end: new Date(end.getTime() + r.bufferAfterMinutes * MIN),
      };
      if (host.busy.some((b) => overlaps(buffered, b))) continue;
      slots.push({ hostId: host.hostId, start: t, end });
    }
  }
  return slots;
}

export interface AssignmentState {
  /** Host pool in configured order (tie-breaker). */
  hostOrder: string[];
  lastAssignedAt: Record<string, Date | null>;
  upcomingCounts: Record<string, number>;
}

/** Collapses per-host slots to one slot per start time, choosing the host by strategy. */
export function assignHosts(slots: Slot[], strategy: HostStrategy, state: AssignmentState): Slot[] {
  const pool = strategy === 'specific_host' ? state.hostOrder.slice(0, 1) : state.hostOrder;
  const rank = (hostId: string): [number, number, number] => {
    const order = pool.indexOf(hostId);
    const last = state.lastAssignedAt[hostId]?.getTime() ?? -Infinity;
    const count = state.upcomingCounts[hostId] ?? 0;
    if (strategy === 'least_booked') return [count, last, order];
    return [last, 0, order];
  };
  const better = (a: string, b: string) => {
    const ra = rank(a);
    const rb = rank(b);
    for (let i = 0; i < 3; i++) if (ra[i] !== rb[i]) return ra[i]! < rb[i]!;
    return false;
  };
  const byStart = new Map<number, Slot>();
  for (const s of slots) {
    if (!pool.includes(s.hostId)) continue;
    const key = s.start.getTime();
    const current = byStart.get(key);
    if (!current || better(s.hostId, current.hostId)) byStart.set(key, s);
  }
  return [...byStart.values()].sort((a, b) => a.start.getTime() - b.start.getTime());
}

export type TimeOfDay = 'morning' | 'afternoon' | 'evening';
const TIME_OF_DAY: Record<TimeOfDay, [number, number]> = { morning: [5, 12], afternoon: [12, 17], evening: [17, 23] };
const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

/** Interprets a spoken day preference in the lead's zone. Returns a local date range or null. */
export function parsePreferredDay(input: string | undefined, now: Date, zone: string): { start: DateTime; end: DateTime } | null {
  if (!input) return null;
  const s = input.trim().toLowerCase();
  const today = DateTime.fromJSDate(now, { zone }).startOf('day');
  if (!s || s === 'any' || s === 'anytime') return null;
  if (s === 'today') return { start: today, end: today.plus({ days: 1 }) };
  if (s === 'tomorrow') return { start: today.plus({ days: 1 }), end: today.plus({ days: 2 }) };
  if (s.includes('next week')) {
    const start = today.startOf('week').plus({ weeks: 1 });
    return { start, end: start.plus({ weeks: 1 }) };
  }
  if (s.includes('this week')) return { start: today, end: today.startOf('week').plus({ weeks: 1 }) };
  const iso = DateTime.fromISO(s, { zone });
  if (iso.isValid && /^\d{4}-\d{2}-\d{2}/.test(s)) return { start: iso.startOf('day'), end: iso.startOf('day').plus({ days: 1 }) };
  const idx = WEEKDAYS.findIndex((d) => s.includes(d));
  if (idx >= 0) {
    const weekday = idx + 1;
    let delta = (weekday - today.weekday + 7) % 7;
    if (s.includes('next') && delta === 0) delta = 7;
    const start = today.plus({ days: delta });
    return { start, end: start.plus({ days: 1 }) };
  }
  return null;
}

export function parseTimeOfDay(input: string | undefined): TimeOfDay | null {
  const s = (input ?? '').toLowerCase();
  if (s.includes('morning') || s === 'am') return 'morning';
  if (s.includes('afternoon') || s.includes('lunch') || s.includes('midday')) return 'afternoon';
  if (s.includes('evening') || s.includes('night') || s === 'pm' || s.includes('after work')) return 'evening';
  return null;
}

export interface PickOptions {
  limit: number;
  leadTimeZone: string;
  now: Date;
  preferredDay?: string;
  preferredTimeOfDay?: string;
}

/**
 * Chooses which slots to offer: honours the stated preference when possible (falling back
 * gracefully), and spreads offers across days and times instead of three back-to-back slots.
 */
export function pickOfferedSlots(slots: Slot[], o: PickOptions): { slots: Slot[]; matchedPreference: boolean } {
  const day = parsePreferredDay(o.preferredDay, o.now, o.leadTimeZone);
  const tod = parseTimeOfDay(o.preferredTimeOfDay);
  const local = (s: Slot) => DateTime.fromJSDate(s.start, { zone: o.leadTimeZone });
  const inDay = (s: Slot) => !day || (local(s) >= day.start && local(s) < day.end);
  const inTod = (s: Slot) => {
    if (!tod) return true;
    const [a, b] = TIME_OF_DAY[tod];
    return local(s).hour >= a && local(s).hour < b;
  };
  const tiers = [slots.filter((s) => inDay(s) && inTod(s)), slots.filter(inDay), slots.filter(inTod), slots];
  const wanted = !!(day || tod);
  let pool = slots;
  let matched = !wanted;
  for (const [i, tier] of tiers.entries()) {
    if (tier.length) {
      pool = tier;
      matched = !wanted || i === 0;
      break;
    }
  }

  const chosen: Slot[] = [];
  const seenDays = new Set<string>();
  // 1) Earliest slot on each distinct day.
  for (const s of pool) {
    if (chosen.length >= o.limit) break;
    const d = local(s).toISODate()!;
    if (!seenDays.has(d)) {
      seenDays.add(d);
      chosen.push(s);
    }
  }
  // 2) Then more slots at least two hours from anything already chosen that day.
  for (const s of pool) {
    if (chosen.length >= o.limit) break;
    if (chosen.includes(s)) continue;
    const far = chosen.every((c) => Math.abs(c.start.getTime() - s.start.getTime()) >= 2 * 60 * MIN);
    if (far) chosen.push(s);
  }
  // 3) Then anything.
  for (const s of pool) {
    if (chosen.length >= o.limit) break;
    if (!chosen.includes(s)) chosen.push(s);
  }
  return { slots: chosen.sort((a, b) => a.start.getTime() - b.start.getTime()), matchedPreference: matched };
}
