import { afterAll, beforeAll, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { closeTestPool, describeDb, seedOrg, testPool, type SeededOrg } from '../../../test/helpers/db';
import { bearerFor, testDeps } from '../../../test/helpers/deps';

describeDb('leads', () => {
  let org: SeededOrg;
  let other: SeededOrg;
  beforeAll(async () => {
    org = await seedOrg(testPool());
    other = await seedOrg(testPool());
  });
  afterAll(closeTestPool);

  it('imports CSV, normalizes phones, stores custom fields and reports bad rows', async () => {
    const app = await buildApp(testDeps());
    const csv = 'First Name,Last Name,Email,Phone,Plan Tier\nAda,Lovelace,ada@example.com,(212) 555-0142,gold\nBad,Row,,,x\n';
    const res = await app.inject({
      method: 'POST',
      url: '/api/leads/import',
      headers: bearerFor(org.ownerId),
      payload: { csv, lead_list_name: 'October' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ inserted: 1, skipped: 1 });
    const list = await app.inject({ method: 'GET', url: '/api/leads?q=555-0142', headers: bearerFor(org.ownerId) });
    const rows = list.json().rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ phone_e164: '+12125550142', custom_fields: { plan_tier: 'gold' } });
  });

  it('does not leak leads across organizations', async () => {
    const app = await buildApp(testDeps());
    const res = await app.inject({ method: 'GET', url: '/api/leads', headers: bearerFor(other.ownerId) });
    expect(res.json().total).toBe(0);
  });
});
