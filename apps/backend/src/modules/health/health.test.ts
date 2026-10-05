import { afterAll, beforeAll, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { UpstreamError } from '../../lib/http';
import { closeTestPool, describeDb, seedOrg, testPool, type SeededOrg } from '../../../test/helpers/db';
import { bearerFor, testDeps } from '../../../test/helpers/deps';
import { FakeVapi } from '../../../test/helpers/fakes';
import { createPublishedCampaign } from '../../../test/helpers/fixtures';

describeDb('integration health and config test', () => {
  let org: SeededOrg;
  beforeAll(async () => {
    org = await seedOrg(testPool());
  });
  afterAll(closeTestPool);

  it('reports each service, with readable upstream errors', async () => {
    const vapi = new FakeVapi();
    vapi.pingError = new UpstreamError('Vapi', 401, '{"message":"Invalid Key"}');
    const app = await buildApp(testDeps({ vapi }));
    const res = await app.inject({ method: 'GET', url: '/api/integrations/health', headers: bearerFor(org.ownerId) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.vapi).toEqual({ ok: false, message: 'Vapi rejected the API key (401). Check the Vapi credentials.' });
    expect(body.cartesia.ok).toBe(true);
    expect(body.twilio[0].ok).toBe(false);
    expect(body.email.ok).toBe(false);
  });

  it('validates a campaign config with Vapi (Claude Haiku 4.5 + Cartesia + recording) and deletes the test assistant', async () => {
    const db = testPool();
    const { campaignId, agentId } = await createPublishedCampaign(db, org.orgId);
    await db.query("update agents set model = 'claude-haiku-4-5-20251001' where id = $1", [agentId]);
    const vapi = new FakeVapi();
    const app = await buildApp(testDeps({ vapi }));
    const res = await app.inject({ method: 'POST', url: `/api/campaigns/${campaignId}/test-config`, headers: bearerFor(org.ownerId) });
    expect(res.json()).toMatchObject({ ok: true, model: 'anthropic · claude-haiku-4-5-20251001', recording: true });
    expect(res.json().voice).toContain('cartesia · sonic-3');
    expect(vapi.createdAssistants).toHaveLength(1);
    expect(vapi.deletedAssistants).toHaveLength(1);

    vapi.rejectAssistant = 'model.model must be one of the following values';
    const bad = await app.inject({ method: 'POST', url: `/api/campaigns/${campaignId}/test-config`, headers: bearerFor(org.ownerId) });
    expect(bad.json().ok).toBe(false);
    expect(bad.json().errors[0]).toContain('model.model must be one of');
  });
});
