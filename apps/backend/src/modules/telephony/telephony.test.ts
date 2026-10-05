import { afterAll, beforeAll, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { closeTestPool, describeDb, seedOrg, testPool, type SeededOrg } from '../../../test/helpers/db';
import { bearerFor, testDeps } from '../../../test/helpers/deps';
import { FakeVapi } from '../../../test/helpers/fakes';

describeDb('telephony', () => {
  let org: SeededOrg;
  beforeAll(async () => {
    org = await seedOrg(testPool());
  });
  afterAll(closeTestPool);

  it('stores the Twilio auth token in Vault, not in the table, and imports numbers into Vapi', async () => {
    const vapi = new FakeVapi();
    const app = await buildApp(testDeps({ vapi }));
    const token = 'super-secret-auth-token-123456';
    const acct = await app.inject({
      method: 'POST',
      url: '/api/twilio-accounts',
      headers: bearerFor(org.ownerId),
      payload: { label: 'Main', account_sid: 'AC' + 'a'.repeat(32), auth_token: token },
    });
    expect(acct.statusCode).toBe(201);
    const { rows } = await testPool().query('select row_to_json(t)::text as j from twilio_accounts t where id = $1', [acct.json().id]);
    expect(rows[0].j).not.toContain(token);

    const num = await app.inject({
      method: 'POST',
      url: '/api/phone-numbers',
      headers: bearerFor(org.ownerId),
      payload: { twilio_account_id: acct.json().id, number: '(212) 555-0100' },
    });
    expect(num.statusCode).toBe(201);
    expect(num.json().e164).toBe('+12125550100');
    expect(vapi.importedNumbers).toEqual([{ number: '+12125550100' }]);
  });
});
