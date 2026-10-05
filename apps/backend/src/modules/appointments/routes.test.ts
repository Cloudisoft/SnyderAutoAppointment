import { afterAll, beforeAll, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { closeTestPool, describeDb, seedOrg, testPool, type SeededOrg } from '../../../test/helpers/db';
import { bearerFor, testDeps } from '../../../test/helpers/deps';
import { FakeMailer } from '../../../test/helpers/fakes';
import { fixedClock } from '../../lib/clock';
import { bookAndConfirm, createBookingCampaign, createCall, createLead } from '../../../test/helpers/fixtures';

describeDb('appointments app API', () => {
  let org: SeededOrg;
  let booking: Awaited<ReturnType<typeof createBookingCampaign>>;
  const mailer = new FakeMailer();
  let app: Awaited<ReturnType<typeof buildApp>>;
  let confirmed: Awaited<ReturnType<typeof bookAndConfirm>>;
  beforeAll(async () => {
    org = await seedOrg(testPool());
    booking = await createBookingCampaign(testPool(), org.orgId);
    app = await buildApp(testDeps({ mailer }));
    confirmed = await bookAndConfirm(app, testPool(), org.orgId, booking, { phone: '+13125550123', mailer, email: 'list@example.com' });
  });
  afterAll(closeTestPool);

  it('lists with filters and digits-only phone search; enforces permissions', async () => {
    const h = bearerFor(org.ownerId);
    const byPhone = await app.inject({ method: 'GET', url: '/api/appointments?q=(312) 555-0123', headers: h });
    expect(byPhone.json().rows.map((r: { id: string }) => r.id)).toEqual([confirmed.appointmentId]);
    const byStatus = await app.inject({ method: 'GET', url: `/api/appointments?status=cancelled&host_id=${booking.hostId}`, headers: h });
    expect(byStatus.json().rows.map((r: { id: string }) => r.id)).not.toContain(confirmed.appointmentId);

    const viewer = await org.addUser('viewer');
    expect((await app.inject({ method: 'GET', url: '/api/appointments', headers: bearerFor(viewer) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/api/appointments/${confirmed.appointmentId}/cancel`, headers: bearerFor(viewer), payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/appointment-types', headers: bearerFor(viewer), payload: {} })).statusCode).toBe(403);
    const other = await seedOrg(testPool());
    expect((await app.inject({ method: 'GET', url: `/api/appointments/${confirmed.appointmentId}`, headers: bearerFor(other.ownerId) })).statusCode).toBe(404);
  });

  it('call records show the booked appointment', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/calls/${confirmed.callId}`, headers: bearerFor(org.ownerId) });
    expect(res.json().appointment).toMatchObject({ id: confirmed.appointmentId, status: 'confirmed' });
    const list = await app.inject({ method: 'GET', url: '/api/calls?q=3125550123', headers: bearerFor(org.ownerId) });
    expect(list.json().rows[0].appointment.id).toBe(confirmed.appointmentId);
    expect(res.json().events.some((e: { type: string; content: string }) => e.type === 'booking' && e.content.startsWith('Appointment confirmed'))).toBe(true);
  });

  it('supervisor confirms a needs_review appointment, which sends the email', async () => {
    const leadId = await createLead(testPool(), org.orgId, { phone_e164: '+13125550124' });
    const { callId } = await createCall(testPool(), org.orgId, { ...booking, leadId });
    const { rows } = await testPool().query<{ id: string }>(
      `insert into appointments(organization_id, campaign_id, campaign_version_id, lead_id, call_id, appointment_type_id, host_id, starts_at, ends_at,
                                lead_time_zone, status, source, attendee_email)
       values ($1,$2,$3,$4,$5,$6,$7,'2026-10-20T18:00:00Z','2026-10-20T18:30:00Z','America/New_York','needs_review','transcript_extraction','review@example.com')
       returning id`,
      [org.orgId, booking.campaignId, booking.versionId, leadId, callId, booking.typeId, booking.hostId],
    );
    expect(mailer.sent.filter((m) => m.to === 'review@example.com')).toHaveLength(0);
    const res = await app.inject({ method: 'POST', url: `/api/appointments/${rows[0]!.id}/confirm`, headers: bearerFor(org.ownerId), payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('confirmed');
    expect(mailer.sent.filter((m) => m.to === 'review@example.com' && m.subject.startsWith('Confirmed'))).toHaveLength(1);
    const lead = await testPool().query('select status from leads where id = $1', [leadId]);
    expect(lead.rows[0].status).toBe('appointment_booked');
  });

  it('marks completed, resends confirmation and exports CSV/XLSX', async () => {
    const h = bearerFor(org.ownerId);
    const before = mailer.sent.filter((m) => m.to === 'list@example.com').length;
    expect((await app.inject({ method: 'POST', url: `/api/appointments/${confirmed.appointmentId}/resend-confirmation`, headers: h, payload: {} })).statusCode).toBe(200);
    expect(mailer.sent.filter((m) => m.to === 'list@example.com').length).toBe(before + 1);

    const csv = await app.inject({ method: 'GET', url: '/api/appointments/export?format=csv', headers: h });
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body.split('\r\n')[0]).toContain('Start (prospect time)');
    expect(csv.body).toContain(confirmed.appointmentId);
    const xlsx = await app.inject({ method: 'GET', url: '/api/appointments/export?format=xlsx', headers: h });
    expect(xlsx.rawPayload.subarray(0, 2).toString()).toBe('PK');

    const done = await app.inject({ method: 'POST', url: `/api/appointments/${confirmed.appointmentId}/status`, headers: h, payload: { status: 'completed' } });
    expect(done.json().status).toBe('completed');
  });

  it('dashboard reports appointments booked, show rate and booked per 100 connected', async () => {
    const later = await buildApp(testDeps({ mailer, clock: fixedClock('2026-10-25T00:00:00Z') }));
    const res = await later.inject({ method: 'GET', url: '/api/dashboard?days=30', headers: bearerFor(org.ownerId) });
    const k = res.json().kpis;
    expect(k.appointments_booked).toBeGreaterThanOrEqual(1);
    expect(k.show_rate).toBe(1);
    expect(k.booked_per_100_connected).toBeGreaterThan(0);
  });

  it('settings: types, hosts, weekly availability, exceptions, template preview and test email', async () => {
    const h = bearerFor(org.ownerId);
    const type = await app.inject({ method: 'POST', url: '/api/appointment-types', headers: h, payload: { name: 'Demo', duration_minutes: 45, location_type: 'phone' } });
    expect(type.statusCode).toBe(201);
    const host = await app.inject({ method: 'POST', url: '/api/appointment-hosts', headers: h, payload: { display_name: 'Sam Lee', email: 'sam@acme.test', time_zone: 'America/Denver' } });
    const hostId = host.json().id;
    const av = await app.inject({ method: 'PUT', url: `/api/appointment-hosts/${hostId}/availability`, headers: h, payload: { rules: [{ weekday: 1, start_time: '09:00', end_time: '12:00' }, { weekday: 1, start_time: '13:00', end_time: '17:00' }] } });
    expect(av.statusCode).toBe(200);
    const ex = await app.inject({ method: 'POST', url: `/api/appointment-hosts/${hostId}/exceptions`, headers: h, payload: { starts_at: '2026-10-19T15:00:00Z', ends_at: '2026-10-19T23:00:00Z', type: 'blocked', reason: 'Offsite' } });
    expect(ex.statusCode).toBe(201);
    const hosts = (await app.inject({ method: 'GET', url: '/api/appointment-hosts', headers: h })).json();
    const sam = hosts.find((x: { id: string }) => x.id === hostId);
    expect(sam.rules).toHaveLength(2);
    expect(sam.exceptions).toHaveLength(1);

    const preview = await app.inject({ method: 'POST', url: '/api/appointment-email-templates/preview', headers: h, payload: { kind: 'confirmation', subject: 'Hi {{first_name}} {{nope}}', body: 'See you {{appointment_date}}.' } });
    expect(preview.json().subject).toBe('Hi Alex');
    const test = await app.inject({ method: 'POST', url: '/api/appointment-email-templates/test', headers: h, payload: { kind: 'reminder', subject: 'Reminder', body: 'Hi', to: 'admin@acme.test' } });
    expect(test.json()).toMatchObject({ ok: true, to: 'admin@acme.test' });
    expect(mailer.sent.some((m) => m.to === 'admin@acme.test' && m.subject === '[Test] Reminder')).toBe(true);
  });
});
