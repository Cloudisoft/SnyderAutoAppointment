import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { withTx } from '../../db/pool';
import { publishCampaign } from '../campaigns/service';
import { closeTestPool, describeDb, seedOrg, testPool, type SeededOrg } from '../../../test/helpers/db';
import { bearerFor, TEST_WEBHOOK_SECRET, testDeps } from '../../../test/helpers/deps';
import { FakeVapi } from '../../../test/helpers/fakes';
import { createCall, createLead, createPublishedCampaign, endOfCallReport } from '../../../test/helpers/fixtures';
import { liveControlTiming } from './liveControl';

const secret = { 'x-vapi-secret': TEST_WEBHOOK_SECRET };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let n = 0;
const phone = () => `+1312555${String(2000 + ++n).slice(-4)}`;

describeDb('live call control', () => {
  let org: SeededOrg;
  let campaign: Awaited<ReturnType<typeof createPublishedCampaign>>;
  beforeAll(async () => {
    org = await seedOrg(testPool());
    campaign = await createPublishedCampaign(testPool(), org.orgId);
    await testPool().query(`update agents set transfer_number = '+13125550100' where id = $1`, [campaign.agentId]);
    const republished = await withTx(testPool(), (c) => publishCampaign(c, org.orgId, campaign.campaignId, null));
    campaign = { ...campaign, versionId: republished.versionId! };
    liveControlTiming.transferMs = 20;
    liveControlTiming.goodbyeMs = 60;
  });
  afterAll(closeTestPool);

  let vapi: FakeVapi;
  beforeEach(() => {
    vapi = new FakeVapi();
  });

  async function liveCall() {
    const leadId = await createLead(testPool(), org.orgId, { phone_e164: phone() });
    const c = await createCall(testPool(), org.orgId, { ...campaign, leadId });
    await testPool().query(
      `insert into call_monitors(call_id, organization_id, listen_url, control_url) values ($1, $2, 'wss://listen.test/x', 'https://control.test/x')`,
      [c.callId, org.orgId],
    );
    return c;
  }
  const say = (app: Awaited<ReturnType<typeof buildApp>>, vapiCallId: string, role: string, transcript: string) =>
    app.inject({ method: 'POST', url: '/webhooks/vapi', headers: secret, payload: { message: { type: 'transcript', transcriptType: 'final', role, transcript, call: { id: vapiCallId } } } });

  it('completes a transfer the assistant announced but did not perform, exactly once', async () => {
    const app = await buildApp(testDeps({ vapi }));
    const { callId, vapiCallId } = await liveCall();
    await say(app, vapiCallId, 'assistant', 'Sure, let me transfer your call.');
    await say(app, vapiCallId, 'assistant', "I'm going to connect you now.");
    await wait(120);
    expect(vapi.controls.map((c) => c.command)).toEqual([{ type: 'transfer', destination: { type: 'number', number: '+13125550100' } }]);
    const { rows } = await testPool().query('select transferred from calls where id = $1', [callId]);
    expect(rows[0].transferred).toBe(true);
  });

  it('does not double-transfer when the transfer tool already ran', async () => {
    const app = await buildApp(testDeps({ vapi }));
    const { vapiCallId } = await liveCall();
    await app.inject({ method: 'POST', url: '/webhooks/vapi', headers: secret, payload: { message: { type: 'transfer-update', call: { id: vapiCallId }, destination: { number: '+13125550100' } } } });
    await say(app, vapiCallId, 'assistant', 'Let me transfer your call.');
    await wait(120);
    expect(vapi.controls).toHaveLength(0);
  });

  it('hangs up after a goodbye unless the person keeps talking', async () => {
    const app = await buildApp(testDeps({ vapi }));
    const a = await liveCall();
    await say(app, a.vapiCallId, 'assistant', 'Thanks for your time, goodbye.');
    const b = await liveCall();
    await say(app, b.vapiCallId, 'assistant', 'Have a great day!');
    await wait(15);
    await say(app, b.vapiCallId, 'user', 'Oh wait, one more question');
    await wait(150);
    expect(vapi.controls).toEqual([{ url: 'https://control.test/x', command: { type: 'end-call' } }]);
  });

  it('never controls a call that already ended', async () => {
    const app = await buildApp(testDeps({ vapi }));
    const { vapiCallId } = await liveCall();
    await say(app, vapiCallId, 'assistant', 'Goodbye.');
    await app.inject({ method: 'POST', url: '/webhooks/vapi', headers: secret, payload: endOfCallReport(vapiCallId) });
    await wait(150);
    expect(vapi.controls).toHaveLength(0);
  });

  it('lets supervisors listen, speak, transfer and end; viewers cannot', async () => {
    const app = await buildApp(testDeps({ vapi }));
    const { callId } = await liveCall();
    const h = bearerFor(org.ownerId);
    const listen = await app.inject({ method: 'GET', url: `/api/monitor/calls/${callId}/listen`, headers: h });
    expect(listen.json()).toEqual({ listenUrl: 'wss://listen.test/x' });
    const live = await app.inject({ method: 'GET', url: '/api/monitor/live', headers: h });
    expect(live.json().find((c: { id: string }) => c.id === callId)).toMatchObject({ can_listen: true, can_control: true, transfer_number: '+13125550100' });

    const post = (payload: object, headers = h) => app.inject({ method: 'POST', url: `/api/monitor/calls/${callId}/control`, headers, payload });
    expect((await post({ action: 'say', content: 'A colleague is joining.' })).statusCode).toBe(200);
    expect((await post({ action: 'transfer', number: '(212) 555-0199' })).statusCode).toBe(200);
    expect((await post({ action: 'transfer', number: 'abc' })).statusCode).toBe(400);
    expect((await post({ action: 'end' })).statusCode).toBe(200);
    expect(vapi.controls.map((c) => c.command.type)).toEqual(['say', 'transfer', 'end-call']);
    expect(vapi.controls[1]!.command).toMatchObject({ destination: { number: '+12125550199' } });

    const viewer = await org.addUser('viewer');
    expect((await post({ action: 'end' }, bearerFor(viewer))).statusCode).toBe(403);
  });
});
