import { afterAll, beforeAll, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { closeTestPool, describeDb, seedOrg, testPool, type SeededOrg } from '../../../test/helpers/db';
import { testDeps } from '../../../test/helpers/deps';
import { FakeMailer } from '../../../test/helpers/fakes';
import { bookAndConfirm, createBookingCampaign } from '../../../test/helpers/fixtures';
import { fixedClock } from '../../lib/clock';
import { generateToken } from './tokens';

describeDb('public appointment page API', () => {
  let org: SeededOrg;
  let booking: Awaited<ReturnType<typeof createBookingCampaign>>;
  beforeAll(async () => {
    org = await seedOrg(testPool());
    booking = await createBookingCampaign(testPool(), org.orgId);
  });
  afterAll(closeTestPool);

  it('unknown, malformed and expired tokens all return the same 404', async () => {
    const mailer = new FakeMailer();
    const app = await buildApp(testDeps({ mailer }));
    const { token, appointmentId } = await bookAndConfirm(app, testPool(), org.orgId, booking, { phone: '+12125550901', mailer });
    const ok = await app.inject({ method: 'GET', url: `/public/appointments/${token}` });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['x-robots-tag']).toContain('noindex');

    const unknown = await app.inject({ method: 'GET', url: `/public/appointments/${generateToken()}` });
    const malformed = await app.inject({ method: 'GET', url: '/public/appointments/abc' });
    await testPool().query(`update appointment_tokens set expires_at = now() - interval '1 minute' where appointment_id = $1`, [appointmentId]);
    const expired = await app.inject({ method: 'GET', url: `/public/appointments/${token}` });
    for (const r of [unknown, malformed, expired]) {
      expect(r.statusCode).toBe(404);
      expect(r.body).toBe(unknown.body);
    }
  });

  it('shows the appointment with no lead PII beyond first name', async () => {
    const mailer = new FakeMailer();
    const app = await buildApp(testDeps({ mailer }));
    const { token } = await bookAndConfirm(app, testPool(), org.orgId, booking, { phone: '+12125550902', mailer, email: 'pii@example.com' });
    const res = await app.inject({ method: 'GET', url: `/public/appointments/${token}` });
    const body = res.json();
    expect(body).toMatchObject({ first_name: 'Ada', business_name: 'Acme Co', host_name: 'Jordan Rivera', duration_minutes: 30, time_zone: 'America/New_York', status: 'confirmed', can_modify: true });
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('Lovelace');
    expect(raw).not.toContain('pii@example.com');
    expect(raw).not.toContain('+1212555');
  });

  it('reschedules atomically to an open slot, then cancels; emails follow each change', async () => {
    const mailer = new FakeMailer();
    const app = await buildApp(testDeps({ mailer }));
    const { token, appointmentId, leadId } = await bookAndConfirm(app, testPool(), org.orgId, booking, { phone: '+12125550903', mailer, email: 'move@example.com' });
    const slots = (await app.inject({ method: 'GET', url: `/public/appointments/${token}/slots` })).json().slots;
    expect(slots.length).toBeGreaterThan(5);
    const target = slots[3];
    const moved = await app.inject({ method: 'POST', url: `/public/appointments/${token}/reschedule`, payload: { start_utc: target.start_utc, host_id: target.host_id } });
    expect(moved.statusCode).toBe(200);
    expect(moved.json()).toMatchObject({ status: 'rescheduled', starts_at: target.start_utc });

    const resched = mailer.sent.filter((m) => m.to === 'move@example.com' && m.subject.startsWith('Updated'));
    expect(resched).toHaveLength(1);
    expect(resched[0]!.icalEvent!.content).toMatch(/SEQUENCE:2/);

    // The original link still works after rescheduling.
    expect((await app.inject({ method: 'GET', url: `/public/appointments/${token}` })).statusCode).toBe(200);
    // A taken slot is refused.
    const { rows: others } = await testPool().query(`select starts_at from appointments where host_id = $1 and status in ('confirmed','pending') and id <> $2 limit 1`, [booking.hostId, appointmentId]);
    if (others[0]) {
      const clash = await app.inject({ method: 'POST', url: `/public/appointments/${token}/reschedule`, payload: { start_utc: others[0].starts_at.toISOString() } });
      expect(clash.statusCode).toBe(409);
    }

    const cancelled = await app.inject({ method: 'POST', url: `/public/appointments/${token}/cancel`, payload: { reason: 'Conflict came up' } });
    expect(cancelled.json()).toMatchObject({ status: 'cancelled', can_modify: false });
    const cancelMail = mailer.sent.filter((m) => m.to === 'move@example.com' && m.subject.startsWith('Cancelled'));
    expect(cancelMail).toHaveLength(1);
    expect(cancelMail[0]!.icalEvent!.content).toMatch(/METHOD:CANCEL/);
    const { rows } = await testPool().query(
      `select l.status, (select array_agg(type order by id) from appointment_events where appointment_id = $2) as events,
              (select state from campaign_leads where lead_id = $1) as cl_state
         from leads l where l.id = $1`,
      [leadId, appointmentId],
    );
    expect(rows[0].status).toBe('appointment_cancelled');
    expect(rows[0].events).toEqual(expect.arrayContaining(['booked', 'confirmed', 'rescheduled', 'cancelled']));
    expect(rows[0].cl_state).toBe('done'); // requeue_on_cancel is off by default
  });

  it('re-queues the lead on cancel when requeue_on_cancel is on', async () => {
    const mailer = new FakeMailer();
    const app = await buildApp(testDeps({ mailer }));
    const requeue = await createBookingCampaign(testPool(), org.orgId, { requeue_on_cancel: true });
    const { token, leadId } = await bookAndConfirm(app, testPool(), org.orgId, requeue, { phone: '+12125550904', mailer, email: 'rq@example.com' });
    await app.inject({ method: 'POST', url: `/public/appointments/${token}/cancel`, payload: {} });
    const { rows } = await testPool().query('select state from campaign_leads where lead_id = $1 and campaign_id = $2', [leadId, requeue.campaignId]);
    expect(rows[0].state).toBe('queued');
  });

  it('is read-only after the start time', async () => {
    const mailer = new FakeMailer();
    const clock = fixedClock('2026-10-12T14:00:00Z');
    const app = await buildApp(testDeps({ mailer, clock }));
    const { token, appointmentId } = await bookAndConfirm(app, testPool(), org.orgId, booking, { phone: '+12125550905', mailer, email: 'late@example.com' });
    const { rows } = await testPool().query('select starts_at from appointments where id = $1', [appointmentId]);
    clock.set(new Date(rows[0].starts_at.getTime() + 60_000));
    const view = await app.inject({ method: 'GET', url: `/public/appointments/${token}` });
    expect(view.json().can_modify).toBe(false);
    const cancel = await app.inject({ method: 'POST', url: `/public/appointments/${token}/cancel`, payload: {} });
    expect(cancel.statusCode).toBe(409);
  });
});
