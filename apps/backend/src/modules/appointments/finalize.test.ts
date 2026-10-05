import { afterAll, beforeAll, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { defaultCallPipeline } from '../../composition';
import { closeTestPool, describeDb, seedOrg, testPool, type SeededOrg } from '../../../test/helpers/db';
import { TEST_WEBHOOK_SECRET, testDeps } from '../../../test/helpers/deps';
import { FakeOpenAi, FakeVapi } from '../../../test/helpers/fakes';
import { createBookingCampaign, createCall, createLead, endOfCallReport, toolCallPayload } from '../../../test/helpers/fixtures';
import { reconcileCallsBatch } from '../calls/reconcile';
import { runPostCallSummary } from '../calls/summary';

const headers = { 'x-vapi-secret': TEST_WEBHOOK_SECRET };

describeDb('finalizing appointments after the call', () => {
  let org: SeededOrg;
  let booking: Awaited<ReturnType<typeof createBookingCampaign>>;
  beforeAll(async () => {
    org = await seedOrg(testPool());
    booking = await createBookingCampaign(testPool(), org.orgId);
  });
  afterAll(closeTestPool);

  async function bookOnCall(app: Awaited<ReturnType<typeof buildApp>>, phone: string, pick = 'slot_1') {
    const leadId = await createLead(testPool(), org.orgId, { phone_e164: phone });
    const call = await createCall(testPool(), org.orgId, { ...booking, leadId, bookingTools: true });
    await app.inject({ method: 'POST', url: '/webhooks/vapi', headers, payload: toolCallPayload(call.vapiCallId, 'check_availability', {}) });
    const r = await app.inject({
      method: 'POST', url: '/webhooks/vapi', headers,
      payload: toolCallPayload(call.vapiCallId, 'book_appointment', { slot_id: pick, attendee_name: 'Ada', attendee_email: 'ada@example.com' }),
    });
    expect(r.json().results[0].result).toMatch(/^Booked/);
    return { ...call, leadId };
  }

  it('confirms on a connected end; duplicate webhooks confirm once and queue one email', async () => {
    const app = await buildApp(testDeps());
    const { callId, vapiCallId, leadId } = await bookOnCall(app, '+12125550701');
    for (let i = 0; i < 3; i++) {
      await app.inject({ method: 'POST', url: '/webhooks/vapi', headers, payload: endOfCallReport(vapiCallId) });
    }
    const { rows } = await testPool().query(
      `select a.status, a.hold_expires_at, a.token_expires_at = a.ends_at + interval '30 days' as token_ttl_ok, c.disposition_key, l.status as lead_status,
              (select count(*)::int from appointment_events e where e.appointment_id = a.id and e.type = 'confirmed') as confirmed_events,
              (select json_agg(n.type order by n.type) from appointment_notifications n where n.appointment_id = a.id) as notifications
         from appointments a join calls c on c.id = a.call_id join leads l on l.id = a.lead_id where a.call_id = $1`,
      [callId],
    );
    expect(rows[0]).toEqual({
      status: 'confirmed', hold_expires_at: null, token_ttl_ok: true, disposition_key: 'appointment_booked',
      lead_status: 'appointment_booked', confirmed_events: 1, notifications: ['confirmation', 'host_notice'],
    });
    const cl = await testPool().query('select state from campaign_leads where lead_id = $1', [leadId]);
    expect(cl.rows[0].state).toBe('done');
  });

  it('voicemail and DNC never confirm, and release the hold', async () => {
    const app = await buildApp(testDeps());
    const vm = await bookOnCall(app, '+12125550702', 'slot_2');
    await app.inject({ method: 'POST', url: '/webhooks/vapi', headers, payload: endOfCallReport(vm.vapiCallId, { endedReason: 'voicemail' }) });
    const dnc = await bookOnCall(app, '+12125550703', 'slot_3');
    await app.inject({ method: 'POST', url: '/webhooks/vapi', headers, payload: toolCallPayload(dnc.vapiCallId, 'mark_do_not_call', {}) });
    await app.inject({ method: 'POST', url: '/webhooks/vapi', headers, payload: endOfCallReport(dnc.vapiCallId) });
    const { rows } = await testPool().query(
      `select a.call_id, a.status, c.disposition_key,
              (select count(*)::int from appointment_notifications n where n.appointment_id = a.id) as notes
         from appointments a join calls c on c.id = a.call_id where a.call_id = any($1) order by c.disposition_key`,
      [[vm.callId, dnc.callId]],
    );
    expect(rows).toEqual([
      { call_id: dnc.callId, status: 'cancelled', disposition_key: 'do_not_call', notes: 0 },
      { call_id: vm.callId, status: 'cancelled', disposition_key: 'voicemail', notes: 0 },
    ]);
  });

  it('the reconciliation path finalizes when the end-of-call webhook is lost', async () => {
    const vapi = new FakeVapi();
    const app = await buildApp(testDeps({ vapi }));
    const { callId, vapiCallId } = await bookOnCall(app, '+12125550704', 'slot_1');
    await testPool().query(`update calls set created_at = now() - interval '10 minutes' where id = $1`, [callId]);
    vapi.remoteCalls.set(vapiCallId, { id: vapiCallId, status: 'ended', endedReason: 'assistant-ended-call', startedAt: '2026-10-12T13:55:00Z', endedAt: '2026-10-12T13:59:00Z' });
    await reconcileCallsBatch(testDeps({ vapi, clock: { now: () => new Date() } }), defaultCallPipeline());
    const { rows } = await testPool().query(
      `select a.status, c.disposition_key from appointments a join calls c on c.id = a.call_id where a.call_id = $1`,
      [callId],
    );
    expect(rows[0]).toEqual({ status: 'confirmed', disposition_key: 'appointment_booked' });
  });

  it('transcript fallback creates needs_review without emailing and notifies supervisors', async () => {
    const openai = new FakeOpenAi();
    openai.next = { meeting_agreed: true, meeting_start: '2026-10-15T14:00:00-04:00', attendee_email: 'ann@example.com' };
    const deps = testDeps({ openai });
    const app = await buildApp(deps);
    const leadId = await createLead(testPool(), org.orgId, { phone_e164: '+12125550705' });
    const { callId, vapiCallId } = await createCall(testPool(), org.orgId, { ...booking, leadId, bookingTools: true });
    await app.inject({ method: 'POST', url: '/webhooks/vapi', headers, payload: endOfCallReport(vapiCallId) });
    await runPostCallSummary(deps, callId, defaultCallPipeline().summarySteps);
    const { rows } = await testPool().query(
      `select a.status, a.source, a.attendee_email, a.starts_at,
              (select count(*)::int from appointment_notifications n where n.appointment_id = a.id) as notes
         from appointments a where a.call_id = $1`,
      [callId],
    );
    expect(rows[0]).toMatchObject({ status: 'needs_review', source: 'transcript_extraction', attendee_email: 'ann@example.com', notes: 0 });
    expect(rows[0].starts_at.toISOString()).toBe('2026-10-15T18:00:00.000Z');
    const n = await testPool().query(
      `select title, permission from in_app_notifications where organization_id = $1 and type = 'appointment_needs_review'`,
      [org.orgId],
    );
    expect(n.rows[0]).toMatchObject({ permission: 'appointments.manage' });

    // Voicemail calls never produce one.
    const v = await createCall(testPool(), org.orgId, { ...booking, leadId, bookingTools: true });
    await app.inject({ method: 'POST', url: '/webhooks/vapi', headers, payload: endOfCallReport(v.vapiCallId, { endedReason: 'voicemail' }) });
    await runPostCallSummary(deps, v.callId, defaultCallPipeline().summarySteps);
    const none = await testPool().query('select count(*)::int as n from appointments where call_id = $1', [v.callId]);
    expect(none.rows[0].n).toBe(0);
  });
});
