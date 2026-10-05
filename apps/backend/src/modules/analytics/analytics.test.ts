import { afterAll, beforeAll, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { closeTestPool, describeDb, seedOrg, testPool, type SeededOrg } from '../../../test/helpers/db';
import { bearerFor, testDeps } from '../../../test/helpers/deps';
import { fixedClock } from '../../lib/clock';

describeDb('dashboard', () => {
  let org: SeededOrg;
  beforeAll(async () => {
    org = await seedOrg(testPool());
    for (const [connected, dur] of [[true, 120], [true, 60], [false, 0]] as const) {
      await testPool().query(
        `insert into calls(organization_id, to_number, status, connected, duration_seconds, created_at, end_processed_at)
         values ($1, '+12125550100', 'ended', $2, $3, '2026-10-10T15:00:00Z', now())`,
        [org.orgId, connected, dur],
      );
    }
  });
  afterAll(closeTestPool);

  it('rolls up calls into KPIs', async () => {
    const app = await buildApp(testDeps({ clock: fixedClock('2026-10-12T14:00:00Z') }));
    const res = await app.inject({ method: 'GET', url: '/api/dashboard?days=7', headers: bearerFor(org.ownerId) });
    expect(res.statusCode).toBe(200);
    expect(res.json().kpis).toMatchObject({ calls: 3, connected: 2, avg_talk_seconds: 90 });
    expect(res.json().daily).toEqual([expect.objectContaining({ day: '2026-10-10', calls: 3 })]);
  });
});
