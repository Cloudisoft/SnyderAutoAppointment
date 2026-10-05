import { afterAll, beforeAll, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { closeTestPool, describeDb, seedOrg, testPool, type SeededOrg } from '../../../test/helpers/db';
import { TEST_WEBHOOK_SECRET, testDeps } from '../../../test/helpers/deps';
import { FakeVapi } from '../../../test/helpers/fakes';
import { createCall, createLead, createPublishedCampaign, endOfCallReport } from '../../../test/helpers/fixtures';
import { createCallPipeline } from './pipeline';
import { reconcileCallsBatch } from './reconcile';

const secret = { 'x-vapi-secret': TEST_WEBHOOK_SECRET };

describeDb('Vapi webhook and end-of-call pipeline', () => {
  let org: SeededOrg;
  let campaign: Awaited<ReturnType<typeof createPublishedCampaign>>;
  beforeAll(async () => {
    org = await seedOrg(testPool());
    campaign = await createPublishedCampaign(testPool(), org.orgId);
  });
  afterAll(closeTestPool);

  it('rejects requests without a valid VAPI_WEBHOOK_SECRET', async () => {
    const app = await buildApp(testDeps());
    const payload = { message: { type: 'tool-calls', toolCallList: [] } };
    expect((await app.inject({ method: 'POST', url: '/webhooks/vapi', payload })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: 'POST', url: '/webhooks/vapi', payload, headers: { 'x-vapi-secret': 'wrong-secret-wrong-secret' } })).statusCode,
    ).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/webhooks/vapi', payload, headers: secret })).statusCode).toBe(200);
    expect(
      (await app.inject({ method: 'POST', url: '/webhooks/vapi', payload, headers: { authorization: `Bearer ${TEST_WEBHOOK_SECRET}` } })).statusCode,
    ).toBe(200);
  });

  it('a throwing tool or unknown tool never errors back to Vapi', async () => {
    const pipeline = createCallPipeline({
      tools: [{ name: 'explode', timeoutMs: 1000, fallbackMessage: 'Let me have someone follow up.', handler: async () => { throw new Error('db down'); } },
              { name: 'slow', timeoutMs: 50, fallbackMessage: 'Slow fallback.', handler: () => new Promise((r) => setTimeout(() => r('late'), 500)) }],
    });
    const app = await buildApp(testDeps(), pipeline);
    const leadId = await createLead(testPool(), org.orgId);
    const { vapiCallId } = await createCall(testPool(), org.orgId, { ...campaign, leadId });
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/vapi',
      headers: secret,
      payload: {
        message: {
          type: 'tool-calls',
          call: { id: vapiCallId },
          toolCallList: [
            { id: 't1', function: { name: 'explode', arguments: '{}' } },
            { id: 't2', function: { name: 'nope', arguments: {} } },
            { id: 't3', function: { name: 'slow', arguments: {} } },
          ],
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const results = res.json().results;
    expect(results[0]).toEqual({ toolCallId: 't1', result: 'Let me have someone follow up.' });
    expect(results[1].result).toMatch(/follow up/);
    expect(results[2]).toEqual({ toolCallId: 't3', result: 'Slow fallback.' });
  });

  it('mark_do_not_call records DNC and the DNC disposition wins', async () => {
    const app = await buildApp(testDeps());
    const leadId = await createLead(testPool(), org.orgId, { phone_e164: '+12125550177' });
    const { callId, vapiCallId } = await createCall(testPool(), org.orgId, { ...campaign, leadId });
    await testPool().query(`update calls set to_number = '+12125550177' where id = $1`, [callId]);
    await app.inject({
      method: 'POST', url: '/webhooks/vapi', headers: secret,
      payload: { message: { type: 'tool-calls', call: { id: vapiCallId }, toolCallList: [{ id: 'x', function: { name: 'mark_do_not_call', arguments: { reason: 'stop calling' } } }] } },
    });
    await app.inject({ method: 'POST', url: '/webhooks/vapi', headers: secret, payload: endOfCallReport(vapiCallId) });
    const { rows } = await testPool().query(
      `select c.disposition_key, l.status, (select count(*)::int from dnc_numbers d where d.organization_id = c.organization_id and d.phone_e164 = '+12125550177') as dnc
         from calls c join leads l on l.id = c.lead_id where c.id = $1`,
      [callId],
    );
    expect(rows[0]).toEqual({ disposition_key: 'do_not_call', status: 'do_not_call', dnc: 1 });
  });

  it('a live transfer is shown immediately and stays flagged after the end-of-call report', async () => {
    const app = await buildApp(testDeps());
    const leadId = await createLead(testPool(), org.orgId, { phone_e164: '+12125550177' });
    const { callId, vapiCallId } = await createCall(testPool(), org.orgId, { ...campaign, leadId });
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/vapi',
      headers: secret,
      payload: { message: { type: 'transfer-update', call: { id: vapiCallId }, destination: { type: 'number', number: '+13125550100' } } },
    });
    expect(res.statusCode).toBe(200);
    const ev = await testPool().query("select content from call_events where call_id = $1 and type = 'status'", [callId]);
    expect(ev.rows.map((r) => r.content)).toContain('transferring to +13125550100');
    await app.inject({ method: 'POST', url: '/webhooks/vapi', headers: secret, payload: endOfCallReport(vapiCallId) });
    const { rows } = await testPool().query('select transferred from calls where id = $1', [callId]);
    expect(rows[0].transferred).toBe(true);
  });

  it('processes an end-of-call report once; duplicates are ignored', async () => {
    const app = await buildApp(testDeps());
    const leadId = await createLead(testPool(), org.orgId);
    const { callId, vapiCallId, campaignLeadId } = await createCall(testPool(), org.orgId, { ...campaign, leadId });
    const first = await app.inject({ method: 'POST', url: '/webhooks/vapi', headers: secret, payload: endOfCallReport(vapiCallId) });
    const second = await app.inject({ method: 'POST', url: '/webhooks/vapi', headers: secret, payload: endOfCallReport(vapiCallId) });
    expect(first.json().status).toBe('processed');
    expect(second.json().status).toBe('duplicate');
    const { rows } = await testPool().query(
      `select c.status, c.connected, c.disposition_key, c.duration_seconds, l.status as lead_status, cl.state,
              (select count(*)::int from call_events e where e.call_id = c.id and e.type = 'status' and e.content = 'ended') as ended_events
         from calls c join leads l on l.id = c.lead_id join campaign_leads cl on cl.id = $2 where c.id = $1`,
      [callId, campaignLeadId],
    );
    expect(rows[0]).toEqual({ status: 'ended', connected: true, disposition_key: 'call_connected', duration_seconds: 240, lead_status: 'contacted', state: 'done', ended_events: 1 });
  });

  it('voicemail goes to retry and never marks the lead contacted', async () => {
    const app = await buildApp(testDeps());
    const leadId = await createLead(testPool(), org.orgId);
    const { callId, vapiCallId } = await createCall(testPool(), org.orgId, { ...campaign, leadId });
    await app.inject({ method: 'POST', url: '/webhooks/vapi', headers: secret, payload: endOfCallReport(vapiCallId, { endedReason: 'voicemail' }) });
    const { rows } = await testPool().query(
      `select c.disposition_key, l.status, cl.state from calls c join leads l on l.id = c.lead_id join campaign_leads cl on cl.id = c.campaign_lead_id where c.id = $1`,
      [callId],
    );
    expect(rows[0]).toEqual({ disposition_key: 'voicemail', status: 'new', state: 'retry_wait' });
  });

  it('reconciliation finalizes a call whose end-of-call webhook was lost', async () => {
    const vapi = new FakeVapi();
    const deps = testDeps({ vapi });
    const leadId = await createLead(testPool(), org.orgId);
    const { callId, vapiCallId } = await createCall(testPool(), org.orgId, { ...campaign, leadId, createdAt: '2026-10-12T13:00:00Z' });
    vapi.remoteCalls.set(vapiCallId, {
      id: vapiCallId, status: 'ended', endedReason: 'customer-ended-call',
      startedAt: '2026-10-12T13:00:10Z', endedAt: '2026-10-12T13:03:10Z', artifact: { transcript: 'hello' },
    });
    const r = await reconcileCallsBatch(deps, createCallPipeline());
    expect(r.processed).toBeGreaterThanOrEqual(1);
    const { rows } = await testPool().query('select status, disposition_key, end_processed_at is not null as done from calls where id = $1', [callId]);
    expect(rows[0]).toEqual({ status: 'ended', disposition_key: 'call_connected', done: true });
  });
});
