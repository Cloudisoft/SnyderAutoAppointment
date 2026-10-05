import { afterAll, beforeAll, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { PG, isPgError } from '../../db/pool';
import { asUser, closeTestPool, describeDb, seedOrg, testPool, type SeededOrg } from '../../../test/helpers/db';
import { bearerFor, testDeps } from '../../../test/helpers/deps';
import { createAgent, createAppointmentType, createHost, createPhoneNumber, insertAppointment } from '../../../test/helpers/fixtures';

describeDb('appointments data model', () => {
  let a: SeededOrg;
  let b: SeededOrg;
  beforeAll(async () => {
    a = await seedOrg(testPool(), 'Org A');
    b = await seedOrg(testPool(), 'Org B');
  });
  afterAll(closeTestPool);

  it('the exclusion constraint prevents double-booking a host, buffers included', async () => {
    const db = testPool();
    const typeId = await createAppointmentType(db, a.orgId, { before: 10, after: 15 });
    const hostId = await createHost(db, a.orgId);
    await insertAppointment(db, a.orgId, { typeId, hostId, startsAt: '2026-10-20T15:00:00Z', endsAt: '2026-10-20T15:30:00Z', before: 10, after: 15 });

    // Overlaps the after-buffer (15:30–15:45) with its own before-buffer.
    const err = await insertAppointment(db, a.orgId, {
      typeId, hostId, startsAt: '2026-10-20T15:50:00Z', endsAt: '2026-10-20T16:20:00Z', before: 10, after: 15,
    }).catch((e) => e);
    expect(isPgError(err, PG.exclusionViolation)).toBe(true);

    // Far enough away: 15:45 (end + after) <= 15:55 (start - before).
    await insertAppointment(db, a.orgId, { typeId, hostId, startsAt: '2026-10-20T16:05:00Z', endsAt: '2026-10-20T16:35:00Z', before: 10, after: 15 });

    // Cancelled appointments don't hold the slot; another host is unaffected.
    await insertAppointment(db, a.orgId, { typeId, hostId, startsAt: '2026-10-21T15:00:00Z', endsAt: '2026-10-21T15:30:00Z', status: 'cancelled' });
    await insertAppointment(db, a.orgId, { typeId, hostId, startsAt: '2026-10-21T15:00:00Z', endsAt: '2026-10-21T15:30:00Z' });
    const otherHost = await createHost(db, a.orgId, { email: 'sam@acme.test' });
    await insertAppointment(db, a.orgId, { typeId, hostId: otherHost, startsAt: '2026-10-21T15:00:00Z', endsAt: '2026-10-21T15:30:00Z' });
  });

  it('RLS: an organization cannot read another organization’s appointments', async () => {
    const db = testPool();
    const typeId = await createAppointmentType(db, b.orgId);
    const hostId = await createHost(db, b.orgId);
    const apptB = await insertAppointment(db, b.orgId, { typeId, hostId, startsAt: '2026-10-22T15:00:00Z', endsAt: '2026-10-22T15:30:00Z' });

    const seenByA = await asUser(db, a.ownerId, async (c) => (await c.query('select id, organization_id from appointments')).rows);
    expect(seenByA.every((r) => r.organization_id === a.orgId)).toBe(true);
    expect(seenByA.map((r) => r.id)).not.toContain(apptB);
    const seenByB = await asUser(db, b.ownerId, async (c) => (await c.query('select id from appointments')).rows.map((r) => r.id));
    expect(seenByB).toContain(apptB);
    const events = await asUser(db, a.ownerId, async (c) =>
      (await c.query('select count(*)::int as n from appointment_events where appointment_id = $1', [apptB])).rows[0].n,
    );
    expect(events).toBe(0);
    const tokens = await asUser(db, b.ownerId, async (c) => (await c.query('select count(*)::int as n from appointment_tokens')).rows[0].n);
    expect(tokens).toBe(0); // backend-only table
  });

  it('seeds "Appointment booked" between Voicemail and Call connected, and grants permissions', async () => {
    const { rows } = await testPool().query(
      `select key, retry, lead_status from dispositions where organization_id = $1 order by priority`,
      [a.orgId],
    );
    const keys = rows.map((r) => r.key);
    expect(keys.indexOf('voicemail')).toBeLessThan(keys.indexOf('appointment_booked'));
    expect(keys.indexOf('do_not_call')).toBeLessThan(keys.indexOf('appointment_booked'));
    expect(keys.indexOf('appointment_booked')).toBeLessThan(keys.indexOf('call_connected'));
    expect(rows.find((r) => r.key === 'appointment_booked')).toMatchObject({ retry: false, lead_status: 'appointment_booked' });

    const perms = await testPool().query(
      `select r.key, array_agg(rp.permission_key order by rp.permission_key) filter (where rp.permission_key like 'appointments.%') as p
         from roles r join role_permissions rp on rp.role_id = r.id where r.organization_id = $1 group by r.key`,
      [a.orgId],
    );
    const byRole = Object.fromEntries(perms.rows.map((r) => [r.key, r.p]));
    expect(byRole.owner).toEqual(['appointments.manage', 'appointments.settings', 'appointments.view']);
    expect(byRole.viewer).toEqual(['appointments.view']);
  });

  it('publish validates booking settings and warns when no host has availability', async () => {
    const db = testPool();
    const app = await buildApp(testDeps());
    const h = bearerFor(a.ownerId);
    const agentId = await createAgent(db, a.orgId);
    const numberId = await createPhoneNumber(db, a.orgId);
    const typeId = await createAppointmentType(db, a.orgId);
    const { rows } = await db.query<{ id: string }>(
      `insert into appointment_hosts(organization_id, display_name, email, time_zone) values ($1, 'No Hours', 'n@x.test', 'UTC') returning id`,
      [a.orgId],
    );
    const created = await app.inject({ method: 'POST', url: '/api/campaigns', headers: h, payload: { name: 'Booking' } });
    const id = created.json().id;
    const base = { ...created.json().draft, agent_id: agentId, phone_number_ids: [numberId] };

    const missing = await app.inject({
      method: 'POST', url: `/api/campaigns/${id}/publish`, headers: h,
      payload: { config: { ...base, appointments: { booking_enabled: true } } },
    });
    expect(missing.statusCode).toBe(422);
    expect(missing.json().errors.join(' ')).toMatch(/appointment type/);

    const check = await app.inject({
      method: 'PUT', url: `/api/campaigns/${id}/draft`, headers: h,
      payload: { config: { ...base, appointments: { booking_enabled: true, appointment_type_id: typeId, host_assignment: { strategy: 'round_robin', host_ids: [rows[0]!.id] } } } },
    });
    expect(check.statusCode).toBe(200);
    const res = await app.inject({ method: 'GET', url: `/api/campaigns/${id}/publish-check`, headers: h });
    expect(res.json().errors).toEqual([]);
    expect(res.json().warnings.join(' ')).toMatch(/no active host .* availability/);

    const published = await app.inject({ method: 'POST', url: `/api/campaigns/${id}/publish`, headers: h, payload: {} });
    expect(published.statusCode).toBe(200);
    const snap = await db.query('select snapshot from campaign_versions where id = $1', [published.json().versionId]);
    expect(snap.rows[0].snapshot.appointments).toMatchObject({ booking_enabled: true, slots_to_offer: 3, hold_minutes: 15 });
  });

  it('campaigns without booking get booking disabled in the snapshot', async () => {
    const db = testPool();
    const { createPublishedCampaign } = await import('../../../test/helpers/fixtures');
    const { versionId } = await createPublishedCampaign(db, a.orgId);
    const snap = await db.query('select snapshot from campaign_versions where id = $1', [versionId]);
    expect(snap.rows[0].snapshot.appointments.booking_enabled).toBe(false);
  });
});
