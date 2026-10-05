import { afterAll, beforeAll, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { asUser, closeTestPool, describeDb, seedOrg, testPool, type SeededOrg } from '../../../test/helpers/db';
import { bearerFor, testDeps } from '../../../test/helpers/deps';

describeDb('organizations, roles and RLS', () => {
  let a: SeededOrg;
  let b: SeededOrg;
  beforeAll(async () => {
    a = await seedOrg(testPool(), 'Org A');
    b = await seedOrg(testPool(), 'Org B');
  });
  afterAll(closeTestPool);

  it('seeds system roles with default permissions for new organizations', async () => {
    const { rows } = await testPool().query(
      `select r.key, count(rp.*)::int as n from roles r left join role_permissions rp on rp.role_id = r.id
        where r.organization_id = $1 group by r.key order by r.key`,
      [a.orgId],
    );
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.n]));
    expect(Object.keys(byKey).sort()).toEqual(['admin', 'owner', 'supervisor', 'viewer']);
    expect(byKey.owner).toBeGreaterThan(byKey.viewer);
  });

  it('a member only sees their own organization through RLS', async () => {
    const visible = await asUser(testPool(), a.ownerId, async (c) =>
      (await c.query('select id from organizations')).rows.map((r) => r.id),
    );
    expect(visible).toEqual([a.orgId]);
    const memberships = await asUser(testPool(), a.ownerId, async (c) =>
      (await c.query('select organization_id from memberships')).rows.map((r) => r.organization_id),
    );
    expect(new Set(memberships)).toEqual(new Set([a.orgId]));
  });

  it('a viewer cannot change roles through RLS', async () => {
    const viewer = await a.addUser('viewer');
    const updated = await asUser(testPool(), viewer, async (c) =>
      (await c.query(`update roles set name = 'hacked' where organization_id = $1`, [a.orgId])).rowCount,
    );
    expect(updated).toBe(0);
  });

  it('GET /api/me returns memberships and permissions', async () => {
    const app = await buildApp(testDeps());
    const res = await app.inject({ method: 'GET', url: '/api/me', headers: bearerFor(b.ownerId) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.organizations).toHaveLength(1);
    expect(body.organizations[0].id).toBe(b.orgId);
    expect(body.organizations[0].permissions).toContain('users.manage');
  });

  it('rejects requests without a valid token and enforces permissions', async () => {
    const app = await buildApp(testDeps());
    expect((await app.inject({ method: 'GET', url: '/api/organization/users' })).statusCode).toBe(401);
    const viewer = await a.addUser('viewer');
    const res = await app.inject({ method: 'GET', url: '/api/organization/users', headers: bearerFor(viewer) });
    expect(res.statusCode).toBe(403);
    const ok = await app.inject({ method: 'GET', url: '/api/organization/users', headers: bearerFor(a.ownerId) });
    expect(ok.statusCode).toBe(200);
  });
});
