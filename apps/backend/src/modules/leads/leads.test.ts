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

  it('imports real-world spreadsheets: semicolons, "Mobile Phone" headers, Excel numbers, full names', async () => {
    const app = await buildApp(testDeps());
    const csv = [
      'Name;Mobile Phone;Work Phone;E-mail;Business',
      'Grace Brewster Hopper;2.125550143E+09;;grace@example.com;Navy',
      "Alan Turing;'2125550144;;;",
      'Linus Pauling;;212.555.0145;;',
      'Nope Person;12345;;;',
      'Empty Person;;;;',
    ].join('\r\n');
    const res = await app.inject({ method: 'POST', url: '/api/leads/import', headers: bearerFor(org.ownerId), payload: { csv } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ inserted: 3, skipped: 2 });
    expect(body.errors).toEqual([
      { row: 5, error: '"12345" is not a valid phone number' },
      { row: 6, error: 'No phone number in this row' },
    ]);
    const { rows } = await testPool().query(
      `select first_name, last_name, email, company, phone_e164 from leads where organization_id = $1 and phone_e164 in ('+12125550143','+12125550144','+12125550145') order by phone_e164`,
      [org.orgId],
    );
    expect(rows).toEqual([
      { first_name: 'Grace', last_name: 'Brewster Hopper', email: 'grace@example.com', company: 'Navy', phone_e164: '+12125550143' },
      { first_name: 'Alan', last_name: 'Turing', email: null, company: null, phone_e164: '+12125550144' },
      { first_name: 'Linus', last_name: 'Pauling', email: null, company: null, phone_e164: '+12125550145' },
    ]);
  });

  it('explains a file with no phone column instead of skipping every row', async () => {
    const app = await buildApp(testDeps());
    const res = await app.inject({ method: 'POST', url: '/api/leads/import', headers: bearerFor(org.ownerId), payload: { csv: 'Name,Email\nAda,ada@example.com\n' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain('No phone column found');
  });

  it('does not leak leads across organizations', async () => {
    const app = await buildApp(testDeps());
    const res = await app.inject({ method: 'GET', url: '/api/leads', headers: bearerFor(other.ownerId) });
    expect(res.json().total).toBe(0);
  });
});
