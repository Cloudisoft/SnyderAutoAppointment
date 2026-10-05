import { afterAll, beforeAll, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { closeTestPool, describeDb, seedOrg, testPool, type SeededOrg } from '../../../test/helpers/db';
import { bearerFor, testDeps } from '../../../test/helpers/deps';
import { createAgent, createPhoneNumber } from '../../../test/helpers/fixtures';

describeDb('campaigns: Save & publish', () => {
  let org: SeededOrg;
  beforeAll(async () => {
    org = await seedOrg(testPool());
  });
  afterAll(closeTestPool);

  it('refuses to publish without an agent and numbers, then publishes immutable versions', async () => {
    const app = await buildApp(testDeps());
    const h = bearerFor(org.ownerId);
    const created = await app.inject({ method: 'POST', url: '/api/campaigns', headers: h, payload: { name: 'Q4' } });
    const id = created.json().id;

    const bad = await app.inject({ method: 'POST', url: `/api/campaigns/${id}/publish`, headers: h, payload: {} });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().errors).toContain('Choose an agent.');

    const agentId = await createAgent(testPool(), org.orgId);
    const numberId = await createPhoneNumber(testPool(), org.orgId);
    const config = { ...created.json().draft, agent_id: agentId, phone_number_ids: [numberId] };
    const ok = await app.inject({ method: 'POST', url: `/api/campaigns/${id}/publish`, headers: h, payload: { config } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().version).toBe(1);

    const again = await app.inject({ method: 'POST', url: `/api/campaigns/${id}/publish`, headers: h, payload: {} });
    expect(again.json().version).toBe(2);

    const { rows } = await testPool().query('select snapshot from campaign_versions where id = $1', [ok.json().versionId]);
    expect(rows[0].snapshot.agent.voice.name).toBe('Katie');
    expect(rows[0].snapshot.phone_numbers).toHaveLength(1);
    await expect(
      testPool().query(`update campaign_versions set version = 99 where id = $1`, [ok.json().versionId]),
    ).rejects.toThrow(/immutable/);
  });
});
