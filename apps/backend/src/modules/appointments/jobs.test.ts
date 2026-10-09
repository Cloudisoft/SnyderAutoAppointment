import { parseAppointmentSettings } from '@snyder/shared';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { closeTestPool, describeDb, seedOrg, testPool, type SeededOrg } from '../../../test/helpers/db';
import { TEST_WEBHOOK_SECRET, testDeps } from '../../../test/helpers/deps';
import { FakeMailer } from '../../../test/helpers/fakes';
import { createBookingCampaign, createCall, createLead, endOfCallReport, toolCallPayload } from '../../../test/helpers/fixtures';
import { fixedClock } from '../../lib/clock';
import { isSlotOpen } from './availability/service';
import { holdExpiryBatch, noShowBatch, reminderSchedulerBatch } from './jobs';
import { dispatchNotificationsBatch } from './notifications/dispatcher';
import { twilioSignature } from './notifications/smsWebhook';

const headers = { 'x-vapi-secret': TEST_WEBHOOK_SECRET };

describeDb('appointment background jobs', () => {
  let org: SeededOrg;
  let booking: Awaited<ReturnType<typeof createBookingCampaign>>;
  beforeAll(async () => {
    org = await seedOrg(testPool());
    booking = await createBookingCampaign(testPool(), org.orgId);
  });
  afterAll(closeTestPool);

  async function book(deps: ReturnType<typeof testDeps>, phone: string, slot = 'slot_1', email = 'ada@example.com', prefs: Record<string, string> = {}) {
    const app = await buildApp(deps);
    const leadId = await createLead(testPool(), org.orgId, { phone_e164: phone });
    const call = await createCall(testPool(), org.orgId, { ...booking, leadId, bookingTools: true });
    await app.inject({ method: 'POST', url: '/webhooks/vapi', headers, payload: toolCallPayload(call.vapiCallId, 'check_availability', prefs) });
    const r = await app.inject({ method: 'POST', url: '/webhooks/vapi', headers, payload: toolCallPayload(call.vapiCallId, 'book_appointment', { slot_id: slot, attendee_name: 'Ada', attendee_email: email }) });
    expect(r.json().results[0].result).toMatch(/^Booked/);
    const { rows } = await testPool().query<{ id: string; starts_at: Date; host_id: string }>('select id, starts_at, host_id from appointments where call_id = $1', [call.callId]);
    return { app, ...call, appt: rows[0]! };
  }

  it('hold expiry releases the slot', async () => {
    const clock = fixedClock('2026-10-12T14:00:00Z');
    const deps = testDeps({ clock });
    const { appt } = await book(deps, '+12125550801');
    const settings = parseAppointmentSettings({ booking_enabled: true, appointment_type_id: booking.typeId, host_assignment: { strategy: 'round_robin', host_ids: [booking.hostId] } });
    const slot = { db: testPool(), organizationId: org.orgId, settings, now: clock.now(), leadTimeZone: 'America/New_York', hostId: appt.host_id, startUtc: appt.starts_at.toISOString() };
    expect(await isSlotOpen(slot)).toBe(false);
    expect((await holdExpiryBatch(deps)).processed).toBe(0); // still within the hold
    clock.advance(16 * 60_000);
    expect((await holdExpiryBatch(deps)).processed).toBeGreaterThanOrEqual(1);
    const { rows } = await testPool().query(`select status, (select count(*)::int from appointment_events e where e.appointment_id = a.id and e.type = 'hold_released') as ev from appointments a where id = $1`, [appt.id]);
    expect(rows[0]).toEqual({ status: 'cancelled', ev: 1 });
    expect(await isSlotOpen(slot)).toBe(true);
  });

  it('duplicate end-of-call webhooks confirm once and send exactly one confirmation email', async () => {
    const mailer = new FakeMailer();
    const deps = testDeps({ mailer });
    const { app, vapiCallId, appt } = await book(deps, '+12125550802', 'slot_2', 'one@example.com');
    await Promise.all([1, 2, 3].map(() => app.inject({ method: 'POST', url: '/webhooks/vapi', headers, payload: endOfCallReport(vapiCallId) })));
    await dispatchNotificationsBatch(deps);
    await dispatchNotificationsBatch(deps);
    const toProspect = mailer.sent.filter((m) => m.to === 'one@example.com');
    expect(toProspect).toHaveLength(1);
    expect(toProspect[0]!.subject).toMatch(/^✓ Confirmed: /);
    expect(toProspect[0]!.text).toMatch(/https:\/\/book\.example\.test\/a\/[A-Za-z0-9_-]{43}/);
    expect(mailer.sent.filter((m) => m.to === 'jordan@acme.test' && m.headers?.['X-Snyder-Appointment'] === appt.id)).toHaveLength(1);
    // Only the hash is stored.
    const token = toProspect[0]!.text.match(/\/a\/([A-Za-z0-9_-]{43})/)![1]!;
    const { rows } = await testPool().query(
      `select (select count(*)::int from appointment_tokens t where t.appointment_id = a.id and t.token_hash = encode(sha256(convert_to($2, 'UTF8')), 'hex')) as hashed,
              (select count(*)::int from appointment_tokens t where t.token_hash = $2) as raw
         from appointments a where a.id = $1`,
      [appt.id, token],
    );
    expect(rows[0]).toEqual({ hashed: 1, raw: 0 });
  });

  it('records the real SMTP error, retries with backoff, then sends', async () => {
    const mailer = new FakeMailer();
    mailer.failuresFor['retry@example.com'] = [new Error('535 5.7.8 Authentication failed')];
    const clock = fixedClock('2026-10-12T14:00:00Z');
    const deps = testDeps({ mailer, clock });
    const { app, vapiCallId, appt } = await book(deps, '+12125550803', 'slot_3', 'retry@example.com');
    await app.inject({ method: 'POST', url: '/webhooks/vapi', headers, payload: endOfCallReport(vapiCallId) });
    const { rows } = await testPool().query(
      `select status, attempts, last_error, next_attempt_at from appointment_notifications where appointment_id = $1 and type = 'confirmation'`,
      [appt.id],
    );
    expect(rows[0]).toMatchObject({ status: 'queued', attempts: 1, last_error: '535 5.7.8 Authentication failed' });
    expect(rows[0].next_attempt_at.toISOString()).toBe('2026-10-12T14:01:00.000Z');
    const ev = await testPool().query(`select metadata->>'error' as e from appointment_events where appointment_id = $1 and type = 'email_failed'`, [appt.id]);
    expect(ev.rows[0].e).toBe('535 5.7.8 Authentication failed');
    clock.advance(61_000);
    await dispatchNotificationsBatch(deps);
    expect(mailer.sent.filter((m) => m.to === 'retry@example.com')).toHaveLength(1);
  });

  it('never emails suppressed addresses', async () => {
    const mailer = new FakeMailer();
    const deps = testDeps({ mailer });
    await testPool().query(`insert into email_suppressions(organization_id, email) values ($1, 'NoMail@example.com')`, [org.orgId]);
    const { app, vapiCallId, appt } = await book(deps, '+12125550804', 'slot_1', 'nomail@example.com');
    await app.inject({ method: 'POST', url: '/webhooks/vapi', headers, payload: endOfCallReport(vapiCallId) });
    expect(mailer.sent.filter((m) => m.to === 'nomail@example.com')).toHaveLength(0);
    const { rows } = await testPool().query(`select status, last_error from appointment_notifications where appointment_id = $1 and type = 'confirmation'`, [appt.id]);
    expect(rows[0]).toEqual({ status: 'skipped', last_error: 'email suppressed' });
  });

  it('schedules each reminder once and sends it at the offset', async () => {
    const mailer = new FakeMailer();
    const clock = fixedClock('2026-10-12T14:00:00Z');
    const deps = testDeps({ mailer, clock });
    const { app, vapiCallId, appt } = await book(deps, '+12125550805', 'slot_1', 'remind@example.com', { preferred_day: 'friday' });
    await app.inject({ method: 'POST', url: '/webhooks/vapi', headers, payload: endOfCallReport(vapiCallId) });
    await reminderSchedulerBatch(deps);
    await reminderSchedulerBatch(deps);
    const { rows } = await testPool().query(
      `select type, send_after from appointment_notifications where appointment_id = $1 and type like 'reminder_%' order by send_after`,
      [appt.id],
    );
    expect(rows.map((r) => r.type)).toEqual(['reminder_24h', 'reminder_1h']);
    expect(rows[0].send_after.getTime()).toBe(appt.starts_at.getTime() - 24 * 3_600_000);

    await dispatchNotificationsBatch(deps);
    expect(mailer.sent.filter((m) => m.to === 'remind@example.com' && m.subject.includes('Reminder'))).toHaveLength(0);
    clock.set(new Date(appt.starts_at.getTime() - 24 * 3_600_000 + 1000));
    await dispatchNotificationsBatch(deps);
    clock.set(new Date(appt.starts_at.getTime() - 3_600_000 + 1000));
    await reminderSchedulerBatch(deps);
    await dispatchNotificationsBatch(deps);
    await dispatchNotificationsBatch(deps);
    const reminders = mailer.sent.filter((m) => m.to === 'remind@example.com' && m.subject.includes('Reminder'));
    expect(reminders).toHaveLength(2);
  });

  it('marks confirmed appointments 2h past their end as no-show', async () => {
    const clock = fixedClock('2026-10-12T14:00:00Z');
    const deps = testDeps({ clock });
    const { app, vapiCallId, appt } = await book(deps, '+12125550806', 'slot_3');
    await app.inject({ method: 'POST', url: '/webhooks/vapi', headers, payload: endOfCallReport(vapiCallId) });
    clock.set(new Date(appt.starts_at.getTime() + 2 * 3_600_000));
    await noShowBatch(deps);
    expect((await testPool().query('select status from appointments where id = $1', [appt.id])).rows[0].status).toBe('confirmed');
    clock.set(new Date(appt.starts_at.getTime() + 3 * 3_600_000));
    await noShowBatch(deps);
    expect((await testPool().query('select status from appointments where id = $1', [appt.id])).rows[0].status).toBe('no_show');
  });

  it('Twilio STOP webhook requires a valid signature and records the opt-out', async () => {
    const deps = testDeps();
    const app = await buildApp(deps);
    const { rows } = await testPool().query<{ e164: string; token: string }>(
      `select p.e164, s.secret as token from phone_numbers p join twilio_accounts t on t.id = p.twilio_account_id
         join vault.secrets s on s.id = t.auth_token_secret_id where p.organization_id = $1 limit 1`,
      [org.orgId],
    );
    const params = { From: '+12125550999', To: rows[0]!.e164, Body: 'STOP' };
    const url = 'https://api.example.test/webhooks/twilio/sms';
    const body = new URLSearchParams(params).toString();
    const bad = await app.inject({ method: 'POST', url: '/webhooks/twilio/sms', payload: body, headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': 'nope' } });
    expect(bad.statusCode).toBe(403);
    const ok = await app.inject({
      method: 'POST', url: '/webhooks/twilio/sms', payload: body,
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': twilioSignature(rows[0]!.token, url, params) },
    });
    expect(ok.statusCode).toBe(200);
    const opt = await testPool().query('select count(*)::int as n from sms_opt_outs where organization_id = $1 and phone_e164 = $2', [org.orgId, '+12125550999']);
    expect(opt.rows[0].n).toBe(1);
  });
});
