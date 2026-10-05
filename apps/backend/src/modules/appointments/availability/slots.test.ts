import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { assignHosts, generateHostSlots, parsePreferredDay, pickOfferedSlots, type HostAvailability, type SlotRules } from './slots';

const NY = 'America/New_York';
const weekdays = (start = '09:00', end = '17:00') => [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start, end }));
const host = (over: Partial<HostAvailability> = {}): HostAvailability => ({
  hostId: 'h1',
  timeZone: NY,
  rules: weekdays(),
  exceptions: [],
  busy: [],
  ...over,
});
// Monday 2026-10-12 10:00 New York (EDT, UTC-4).
const rules = (over: Partial<SlotRules> = {}): SlotRules => ({
  now: new Date('2026-10-12T14:00:00Z'),
  durationMinutes: 30,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  minNoticeMinutes: 120,
  maxDaysAhead: 14,
  ...over,
});
const localTimes = (slots: { start: Date }[], zone = NY) => slots.map((s) => DateTime.fromJSDate(s.start, { zone }).toFormat('ccc HH:mm'));

describe('slot generation', () => {
  it('respects minimum notice and working hours', () => {
    const slots = generateHostSlots(host(), rules());
    expect(localTimes(slots).slice(0, 3)).toEqual(['Mon 12:00', 'Mon 12:30', 'Mon 13:00']);
    // Last slot of the day must end by 17:00.
    const firstMonday = slots.filter((x) => DateTime.fromJSDate(x.start, { zone: NY }).toISODate() === '2026-10-12');
    expect(localTimes(firstMonday).pop()).toBe('Mon 16:30');
  });

  it('respects max days ahead', () => {
    const slots = generateHostSlots(host(), rules({ maxDaysAhead: 2 }));
    const last = slots[slots.length - 1]!;
    expect(last.start.getTime()).toBeLessThanOrEqual(new Date('2026-10-14T14:00:00Z').getTime());
    expect(localTimes(slots).some((t) => t.startsWith('Thu'))).toBe(false);
  });

  it('removes existing appointments plus buffers on both sides', () => {
    // Existing 13:00–13:30 NY with its own 10/15 buffers => busy 12:50–13:45.
    const busy = [{ start: new Date('2026-10-12T16:50:00Z'), end: new Date('2026-10-12T17:45:00Z') }];
    const slots = generateHostSlots(host({ busy }), rules({ bufferBeforeMinutes: 10, bufferAfterMinutes: 15 }));
    const monday = localTimes(slots.filter((x) => DateTime.fromJSDate(x.start, { zone: NY }).toISODate() === '2026-10-12'));
    expect(monday.slice(0, 2)).toEqual(['Mon 12:00', 'Mon 14:00']);
  });

  it('applies blocked and extra-open exceptions', () => {
    const exceptions = [
      { startsAt: new Date('2026-10-13T13:00:00Z'), endsAt: new Date('2026-10-14T04:00:00Z'), type: 'blocked' as const }, // all Tuesday
      { startsAt: new Date('2026-10-17T14:00:00Z'), endsAt: new Date('2026-10-17T15:00:00Z'), type: 'extra_open' as const }, // Sat 10–11
    ];
    const slots = generateHostSlots(host({ exceptions }), rules()).map((x) => DateTime.fromJSDate(x.start, { zone: NY }).toFormat('yyyy-MM-dd HH:mm'));
    expect(slots.some((t) => t.startsWith('2026-10-13'))).toBe(false);
    expect(slots.some((t) => t.startsWith('2026-10-20'))).toBe(true);
    expect(slots.filter((t) => t.startsWith('2026-10-17'))).toEqual(['2026-10-17 10:00', '2026-10-17 10:30']);
  });

  it('keeps local wall-clock hours across the autumn DST change', () => {
    const slots = generateHostSlots(host(), rules({ maxDaysAhead: 30 }));
    const before = slots.find((s) => DateTime.fromJSDate(s.start, { zone: NY }).toISODate() === '2026-10-26')!;
    const after = slots.find((s) => DateTime.fromJSDate(s.start, { zone: NY }).toISODate() === '2026-11-02')!;
    expect(before.start.toISOString()).toBe('2026-10-26T13:00:00.000Z'); // 09:00 EDT
    expect(after.start.toISOString()).toBe('2026-11-02T14:00:00.000Z'); // 09:00 EST
  });

  it('skips the nonexistent hour on the spring-forward day', () => {
    const h = host({ rules: [{ weekday: 7, start: '01:00', end: '04:00' }] });
    const slots = generateHostSlots(h, rules({ now: new Date('2026-03-01T12:00:00Z'), minNoticeMinutes: 0, from: new Date('2026-03-08T00:00:00Z'), to: new Date('2026-03-09T00:00:00Z') }));
    expect(slots.map((s) => DateTime.fromJSDate(s.start, { zone: NY }).toFormat('HH:mm'))).toEqual(['01:00', '01:30', '03:00', '03:30']);
  });

  it('produces distinct instants through the repeated hour on the fall-back day', () => {
    const h = host({ rules: [{ weekday: 7, start: '00:00', end: '03:00' }] });
    const slots = generateHostSlots(h, rules({ now: new Date('2026-10-25T12:00:00Z'), minNoticeMinutes: 0, from: new Date('2026-11-01T00:00:00Z'), to: new Date('2026-11-02T00:00:00Z') }));
    const utc = slots.map((s) => s.start.toISOString());
    expect(new Set(utc).size).toBe(utc.length);
    expect(utc[0]).toBe('2026-11-01T04:00:00.000Z');
    expect(utc[utc.length - 1]).toBe('2026-11-01T07:30:00.000Z');
  });

  it('builds hours in the host zone and presents them in the lead zone', () => {
    const la = host({ timeZone: 'America/Los_Angeles' });
    const slots = generateHostSlots(la, rules({ minNoticeMinutes: 0 }));
    // 09:00 Pacific on Tuesday = 12:00 Eastern.
    const tue = slots.find((s) => DateTime.fromJSDate(s.start, { zone: 'America/Los_Angeles' }).toFormat('ccc HH:mm') === 'Tue 09:00')!;
    expect(DateTime.fromJSDate(tue.start, { zone: NY }).toFormat('HH:mm')).toBe('12:00');
  });
});

describe('host assignment', () => {
  const s = (hostId: string, iso: string) => ({ hostId, start: new Date(iso), end: new Date(new Date(iso).getTime() + 1_800_000) });
  const slots = [s('a', '2026-10-13T14:00:00Z'), s('b', '2026-10-13T14:00:00Z'), s('b', '2026-10-13T15:00:00Z')];

  it('round robin prefers the host assigned least recently', () => {
    const out = assignHosts(slots, 'round_robin', { hostOrder: ['a', 'b'], lastAssignedAt: { a: new Date('2026-10-12'), b: null }, upcomingCounts: {} });
    expect(out.map((x) => x.hostId)).toEqual(['b', 'b']);
  });
  it('least booked prefers the host with fewer upcoming appointments', () => {
    const out = assignHosts(slots, 'least_booked', { hostOrder: ['a', 'b'], lastAssignedAt: {}, upcomingCounts: { a: 1, b: 5 } });
    expect(out[0]!.hostId).toBe('a');
  });
  it('specific host only offers that host', () => {
    const out = assignHosts(slots, 'specific_host', { hostOrder: ['a', 'b'], lastAssignedAt: {}, upcomingCounts: {} });
    expect(out.map((x) => x.hostId)).toEqual(['a']);
  });
});

describe('offered slot selection', () => {
  const all = generateHostSlots(host(), rules());
  const now = new Date('2026-10-12T14:00:00Z');

  it('spreads offers across days', () => {
    const { slots } = pickOfferedSlots(all, { limit: 3, leadTimeZone: NY, now });
    expect(localTimes(slots)).toEqual(['Mon 12:00', 'Tue 09:00', 'Wed 09:00']);
  });
  it('honours day and time-of-day preferences', () => {
    const r = pickOfferedSlots(all, { limit: 3, leadTimeZone: NY, now, preferredDay: 'Thursday', preferredTimeOfDay: 'afternoon' });
    expect(r.matchedPreference).toBe(true);
    expect(localTimes(r.slots).every((t) => t.startsWith('Thu') && Number(t.slice(4, 6)) >= 12)).toBe(true);
    expect(r.slots).toHaveLength(3);
  });
  it('falls back gracefully when the preference has no openings', () => {
    const r = pickOfferedSlots(all, { limit: 3, leadTimeZone: NY, now, preferredDay: 'Saturday' });
    expect(r.matchedPreference).toBe(false);
    expect(r.slots).toHaveLength(3);
  });
  it('parses relative days in the lead zone', () => {
    expect(parsePreferredDay('tomorrow', now, NY)!.start.toISODate()).toBe('2026-10-13');
    expect(parsePreferredDay('next Monday', now, NY)!.start.toISODate()).toBe('2026-10-19');
    expect(parsePreferredDay('next week', now, NY)!.start.toISODate()).toBe('2026-10-19');
    expect(parsePreferredDay('whenever', now, NY)).toBeNull();
  });
});
