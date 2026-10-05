import { parseAppointmentSettings } from '@snyder/shared';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { closeTestPool, describeDb, seedOrg, testPool, type SeededOrg } from '../../../../test/helpers/db';
import { createAppointmentType, createHost, insertAppointment } from '../../../../test/helpers/fixtures';
import { getOpenSlots, isSlotOpen } from './service';

describeDb('getOpenSlots', () => {
  let org: SeededOrg;
  let typeId: string;
  let hostId: string;
  beforeAll(async () => {
    org = await seedOrg(testPool());
    typeId = await createAppointmentType(testPool(), org.orgId, { before: 0, after: 15 });
    hostId = await createHost(testPool(), org.orgId);
  });
  afterAll(closeTestPool);

  const now = new Date('2026-10-12T14:00:00Z'); // Mon 10:00 NY

  it('returns spread slots with UTC, lead-local times and spoken labels', async () => {
    const settings = parseAppointmentSettings({ booking_enabled: true, appointment_type_id: typeId, host_assignment: { strategy: 'round_robin', host_ids: [hostId] } });
    const r = await getOpenSlots({ db: testPool(), organizationId: org.orgId, settings, now, leadTimeZone: 'America/Chicago' });
    expect(r.slots).toHaveLength(3);
    expect(r.slots[0]).toMatchObject({
      hostId,
      startUtc: '2026-10-12T16:00:00.000Z',
      startLocal: '2026-10-12T11:00:00.000-05:00',
      spokenLabel: 'Monday, October twelfth at eleven a.m. Central',
    });
  });

  it('removes booked slots (with buffers) and can ignore an appointment being rescheduled', async () => {
    const settings = parseAppointmentSettings({ booking_enabled: true, appointment_type_id: typeId, host_assignment: { strategy: 'specific_host', host_ids: [hostId] } });
    const apptId = await insertAppointment(testPool(), org.orgId, { typeId, hostId, startsAt: '2026-10-12T16:00:00Z', endsAt: '2026-10-12T16:30:00Z', after: 15 });
    const base = { db: testPool(), organizationId: org.orgId, settings, now, leadTimeZone: 'America/New_York' };
    expect(await isSlotOpen({ ...base, hostId, startUtc: '2026-10-12T16:00:00Z' })).toBe(false);
    expect(await isSlotOpen({ ...base, hostId, startUtc: '2026-10-12T16:30:00Z' })).toBe(false); // inside the 15-min after-buffer
    expect(await isSlotOpen({ ...base, hostId, startUtc: '2026-10-12T17:00:00Z' })).toBe(true);
    expect(await isSlotOpen({ ...base, hostId, startUtc: '2026-10-12T16:00:00Z', excludeAppointmentId: apptId })).toBe(true);
  });

  it('returns nothing when booking has no type or hosts', async () => {
    const r = await getOpenSlots({ db: testPool(), organizationId: org.orgId, settings: parseAppointmentSettings({}), now, leadTimeZone: 'UTC' });
    expect(r.slots).toEqual([]);
  });
});
