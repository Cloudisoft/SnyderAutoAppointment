import { afterAll, beforeAll, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { closeTestPool, describeDb, seedOrg, testPool, type SeededOrg } from '../../../test/helpers/db';
import { bearerFor, testDeps } from '../../../test/helpers/deps';
import { FakeMailer } from '../../../test/helpers/fakes';
import { createBookingCampaign, createCall, createLead, endOfCallReport, toolCallPayload } from '../../../test/helpers/fixtures';
import { SmtpNotConfiguredError } from '../../integrations/mailer';
import { fixedClock } from '../../lib/clock';
import { dispatchNotificationsBatch, MAX_ATTEMPTS } from './notifications/dispatcher';

const headers = { 'x-vapi-secret': 'test-vapi-webhook-secret-0123456789' };

describeDb('email recovery without per-appointment resends', () => {
  let org: SeededOrg;
  let booking: Awaited<ReturnType<typeof createBookingCampaign>>;
  beforeAll(async () => {
    org = await seedOrg(testPool());
    booking = await createBookingCampaign(testPool(), org.orgId);
  });
  afterAll(closeTestPool);

  /** Mailer that has no SMTP until `configured` is flipped on. */
  class UnconfiguredMailer extends FakeMailer {
    smtpReady = false;
    override async send(email: Parameters<FakeMailer['send']>[0]) {
      if (!this.smtpReady) throw new SmtpNotConfiguredError();
      return super.send(email);
    }
  }

  async function bookMany(app: Awaited<ReturnType<typeof buildApp>>, n: number) {
    for (let i = 0; i < n; i++) {
      const leadId = await createLead(testPool(), org.orgId, { phone_e164: `+1312555${String(1000 + i)}`, email: `p${i}@example.com` });
      const call = await createCall(testPool(), org.orgId, { ...booking, leadId, bookingTools: true });
      await app.inject({ method: 'POST', url: '/webhooks/vapi', headers, payload: toolCallPayload(call.vapiCallId, 'check_availability', {}) });
      await app.inject({ method: 'POST', url: '/webhooks/vapi', headers, payload: toolCallPayload(call.vapiCallId, 'book_appointment', { slot_id: 'slot_1', attendee_name: `P${i}`, attendee_email: `p${i}@example.com` }) });
      await app.inject({ method: 'POST', url: '/webhooks/vapi', headers, payload: endOfCallReport(call.vapiCallId) });
    }
  }

  it('confirmations wait (without burning attempts) until SMTP is set up, then all go out on save', async () => {
    const mailer = new UnconfiguredMailer();
    const clock = fixedClock('2026-10-12T14:00:00Z');
    const deps = testDeps({ mailer, clock });
    const app = await buildApp(deps);
    await bookMany(app, 3);

    // Many dispatcher runs over hours: nothing is marked failed, nothing sent.
    for (let i = 0; i < MAX_ATTEMPTS + 3; i++) {
      clock.advance(16 * 60_000);
      await dispatchNotificationsBatch(deps);
    }
    const waiting = await testPool().query(
      `select status, attempts, last_error from appointment_notifications where organization_id = $1 and type = 'confirmation'`,
      [org.orgId],
    );
    expect(waiting.rows).toHaveLength(3);
    for (const r of waiting.rows) expect(r).toMatchObject({ status: 'queued', attempts: 0, last_error: expect.stringContaining('SMTP is not configured') });
    const summary = await app.inject({ method: 'GET', url: '/api/appointment-notifications/summary', headers: bearerFor(org.ownerId) });
    expect(summary.json().waiting).toBeGreaterThanOrEqual(3);

    // Admin saves SMTP settings: the backlog is released and sent without any resend clicks.
    mailer.smtpReady = true;
    const saved = await app.inject({
      method: 'PUT', url: '/api/settings/smtp', headers: bearerFor(org.ownerId),
      payload: { host: 'smtp.acme.test', port: 587, secure: false, from_email: 'hello@acme.test' },
    });
    expect(saved.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 200));
    for (let i = 0; i < 3; i++) expect(mailer.sent.filter((m) => m.to === `p${i}@example.com` && m.subject.includes('Confirmed'))).toHaveLength(1);
  });

  it('one bulk action retries every failed email for upcoming appointments', async () => {
    const mailer = new FakeMailer();
    const clock = fixedClock('2026-10-12T14:00:00Z');
    const deps = testDeps({ mailer, clock });
    const app = await buildApp(deps);
    await testPool().query(`update appointment_notifications set status = 'failed', attempts = $2, last_error = 'Connection timeout' where organization_id = $1`, [org.orgId, MAX_ATTEMPTS]);
    const before = mailer.sent.length;
    const res = await app.inject({ method: 'POST', url: '/api/appointment-notifications/retry-failed', headers: bearerFor(org.ownerId), payload: {} });
    expect(res.json().requeued).toBeGreaterThanOrEqual(3);
    expect(mailer.sent.length - before).toBeGreaterThanOrEqual(3);
    const { rows } = await testPool().query(`select count(*)::int as n from appointment_notifications where organization_id = $1 and status = 'failed'`, [org.orgId]);
    expect(rows[0].n).toBe(0);
  });
});
