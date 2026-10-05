import { afterAll, beforeAll, expect, it } from 'vitest';
import { buildApp } from '../../../app';
import { defaultCallPipeline } from '../../../composition';
import { closeTestPool, describeDb, seedOrg, testPool, type SeededOrg } from '../../../../test/helpers/db';
import { TEST_WEBHOOK_SECRET, testDeps } from '../../../../test/helpers/deps';
import { FakeVapi } from '../../../../test/helpers/fakes';
import { createBookingCampaign, createCall, createLead, createPublishedCampaign, toolCallPayload } from '../../../../test/helpers/fixtures';
import { claimForCampaign, placeCall } from '../../dialer/dialer';

const headers = { 'x-vapi-secret': TEST_WEBHOOK_SECRET };

describeDb('Vapi booking tools', () => {
  let org: SeededOrg;
  beforeAll(async () => {
    org = await seedOrg(testPool());
  });
  afterAll(closeTestPool);

  async function dial(campaign: { campaignId: string; versionId: string }, vapi: FakeVapi, phone: string) {
    const db = testPool();
    const leadId = await createLead(db, org.orgId, { phone_e164: phone, email: 'john@gmail.com' });
    await db.query('insert into campaign_leads(organization_id, campaign_id, lead_id) values ($1, $2, $3)', [org.orgId, campaign.campaignId, leadId]);
    const deps = testDeps({ vapi });
    const pipeline = defaultCallPipeline();
    const claimed = await claimForCampaign(deps, org.orgId, campaign.campaignId, campaign.versionId);
    for (const p of claimed) await placeCall(deps, pipeline, p);
    return claimed[0]!.callId;
  }

  it('adds booking tools and prompt rules only when the campaign version has booking enabled', async () => {
    const db = testPool();
    const vapi = new FakeVapi();
    const plain = await createPublishedCampaign(db, org.orgId, { calling_window: { days: [1, 2, 3, 4, 5, 6, 7], start: '00:00', end: '23:59' } });
    await dial(plain, vapi, '+12125550501');
    const booking = await createBookingCampaign(db, org.orgId);
    await dial(booking, vapi, '+12125550502');

    const [plainCall, bookingCall] = vapi.calls.slice(-2);
    const names = (c: typeof plainCall) => c!.assistant.model.tools.flatMap((t) => (t.type === 'function' ? [t.function.name] : [t.type]));
    expect(names(plainCall)).toEqual(['endCall', 'mark_do_not_call']);
    expect(plainCall!.assistant.model.messages[0]!.content).not.toContain('# Scheduling');
    expect(names(bookingCall)).toEqual(['endCall', 'mark_do_not_call', 'check_availability', 'book_appointment']);
    const prompt = bookingCall!.assistant.model.messages[0]!.content;
    expect(prompt).toContain('Offer only the times it returns');
    expect(prompt).toContain('j, o, h, n, at gmail dot com');
    expect(prompt).not.toMatch(/America\//);
    const tool = bookingCall!.assistant.model.tools.find((t) => t.type === 'function' && t.function.name === 'book_appointment');
    expect(tool).toMatchObject({ server: { url: 'https://api.example.test/webhooks/vapi', secret: TEST_WEBHOOK_SECRET } });
    expect(bookingCall!.assistant.voice).toMatchObject({ provider: 'cartesia', model: 'sonic-3' });
  });

  it('re-sends the call without booking tools when Vapi rejects the tools config', async () => {
    const db = testPool();
    const vapi = new FakeVapi();
    vapi.rejectFunctionTools = true;
    const booking = await createBookingCampaign(db, org.orgId);
    const callId = await dial(booking, vapi, '+12125550503');
    expect(vapi.calls).toHaveLength(1);
    const names = vapi.calls[0]!.assistant.model.tools.flatMap((t) => (t.type === 'function' ? [t.function.name] : []));
    expect(names).not.toContain('book_appointment');
    expect(vapi.calls[0]!.assistant.model.messages[0]!.content).not.toContain('# Scheduling');
    const { rows } = await db.query(
      `select c.booking_tools_enabled, c.vapi_call_id is not null as placed,
              (select count(*)::int from call_events e where e.call_id = c.id and e.content like 'Vapi rejected%') as logged
         from calls c where id = $1`,
      [callId],
    );
    expect(rows[0]).toEqual({ booking_tools_enabled: false, placed: true, logged: 1 });
  });

  it('check_availability returns slot ids with spoken labels; book_appointment holds the slot', async () => {
    const db = testPool();
    const app = await buildApp(testDeps());
    const booking = await createBookingCampaign(db, org.orgId);
    const leadId = await createLead(db, org.orgId);
    const { callId, vapiCallId } = await createCall(db, org.orgId, { ...booking, leadId, bookingTools: true });

    const check = await app.inject({ method: 'POST', url: '/webhooks/vapi', headers, payload: toolCallPayload(vapiCallId, 'check_availability', { preferred_day: 'tuesday' }) });
    const text: string = check.json().results[0].result;
    expect(text).toMatch(/slot_1: Tuesday, October thirteenth at nine a\.m\. Eastern/);
    expect(text).not.toMatch(/\d{1,2}:\d{2}|\/|America/);

    const bad = await app.inject({ method: 'POST', url: '/webhooks/vapi', headers, payload: toolCallPayload(vapiCallId, 'book_appointment', { slot_id: 'slot_1', attendee_name: 'Ada', attendee_email: 'ada@nowhere' }) });
    expect(bad.json().results[0].result).toMatch(/doesn't look complete/);

    const ok = await app.inject({ method: 'POST', url: '/webhooks/vapi', headers, payload: toolCallPayload(vapiCallId, 'book_appointment', { slot_id: 'slot_1', attendee_name: 'Ada Lovelace', attendee_email: 'Ada@Example.com' }) });
    expect(ok.json().results[0].result).toMatch(/^Booked: Tuesday, October thirteenth at nine a\.m\. Eastern/);
    expect(ok.json().results[0].result).toContain('a, d, a, at e, x, a, m, p, l, e dot com');

    const { rows } = await db.query(
      `select status, attendee_email, source, hold_expires_at, lead_time_zone, starts_at from appointments where call_id = $1`,
      [callId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'pending', attendee_email: 'ada@example.com', source: 'ai_tool', lead_time_zone: 'America/New_York' });
    expect(rows[0].hold_expires_at.toISOString()).toBe('2026-10-12T14:15:00.000Z'); // now + 15 min
    expect(rows[0].starts_at.toISOString()).toBe('2026-10-13T13:00:00.000Z');

    // Retrying the same booking is idempotent.
    await app.inject({ method: 'POST', url: '/webhooks/vapi', headers, payload: toolCallPayload(vapiCallId, 'book_appointment', { slot_id: 'slot_1', attendee_name: 'Ada Lovelace', attendee_email: 'ada@example.com' }) });
    const again = await db.query(`select count(*)::int as n from appointments where call_id = $1 and status = 'pending'`, [callId]);
    expect(again.rows[0].n).toBe(1);
    const ev = await db.query(`select count(*)::int as n from call_events where call_id = $1 and type = 'booking'`, [callId]);
    expect(ev.rows[0].n).toBeGreaterThanOrEqual(1);
  });

  it('10 parallel bookings for the same slot: exactly one succeeds, the rest get alternatives', async () => {
    const db = testPool();
    const app = await buildApp(testDeps());
    const booking = await createBookingCampaign(db, org.orgId);
    const calls = [];
    for (let i = 0; i < 10; i++) {
      const leadId = await createLead(db, org.orgId, { phone_e164: `+1212555061${i}` });
      calls.push(await createCall(db, org.orgId, { ...booking, leadId, bookingTools: true }));
    }
    // Every call is offered the same earliest slot.
    for (const c of calls) {
      await app.inject({ method: 'POST', url: '/webhooks/vapi', headers, payload: toolCallPayload(c.vapiCallId, 'check_availability', {}) });
    }
    const results = await Promise.all(
      calls.map((c, i) =>
        app.inject({
          method: 'POST', url: '/webhooks/vapi', headers,
          payload: toolCallPayload(c.vapiCallId, 'book_appointment', { slot_id: 'slot_1', attendee_name: `P${i}`, attendee_email: `p${i}@example.com` }),
        }),
      ),
    );
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    const texts = results.map((r) => r.json().results[0].result as string);
    expect(texts.filter((t) => t.startsWith('Booked:'))).toHaveLength(1);
    const losers = texts.filter((t) => !t.startsWith('Booked:'));
    expect(losers).toHaveLength(9);
    for (const t of losers) expect(t).toMatch(/just taken.*slot_\d+: /);
    const { rows } = await db.query(
      `select count(*)::int as n from appointments where host_id = $1 and status = 'pending'`,
      [booking.hostId],
    );
    expect(rows[0].n).toBe(1);
  });

  it('tool failures never reach Vapi: the AI gets a graceful callback/email message', async () => {
    const db = testPool();
    const app = await buildApp(testDeps());
    const booking = await createBookingCampaign(db, org.orgId);
    const leadId = await createLead(db, org.orgId);
    const { callId, vapiCallId } = await createCall(db, org.orgId, { ...booking, leadId, bookingTools: true });
    // Break the call's link to its campaign version so the handler throws.
    await db.query('update calls set campaign_version_id = null where id = $1', [callId]);
    const res = await app.inject({ method: 'POST', url: '/webhooks/vapi', headers, payload: toolCallPayload(vapiCallId, 'check_availability', {}) });
    expect(res.statusCode).toBe(200);
    expect(res.json().results[0].result).toMatch(/follow up by email.*call them back/);
    const res2 = await app.inject({ method: 'POST', url: '/webhooks/vapi', headers, payload: toolCallPayload('unknown-vapi-id', 'book_appointment', { slot_id: 'slot_1' }) });
    expect(res2.statusCode).toBe(200);
    expect(res2.json().results[0].result).toMatch(/calendar/);
  });
});
