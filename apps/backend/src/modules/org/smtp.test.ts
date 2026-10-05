import { afterAll, beforeAll, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { closeTestPool, describeDb, seedOrg, testPool, type SeededOrg } from '../../../test/helpers/db';
import { bearerFor, testDeps } from '../../../test/helpers/deps';
import { FakeMailer } from '../../../test/helpers/fakes';

describeDb('Settings > Email (SMTP)', () => {
  let org: SeededOrg;
  beforeAll(async () => {
    org = await seedOrg(testPool());
  });
  afterAll(closeTestPool);

  const body = { host: 'smtp.acme.test', port: 587, secure: false, username: 'mailer', password: 'p@ss-word!', from_email: 'hello@acme.test', from_name: 'Acme' };

  it('stores the password only in Vault, masks it, and keeps it when omitted', async () => {
    const app = await buildApp(testDeps());
    const h = bearerFor(org.ownerId);
    const saved = await app.inject({ method: 'PUT', url: '/api/settings/smtp', headers: h, payload: body });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ configured: true, has_password: true, host: 'smtp.acme.test' });
    expect(JSON.stringify(saved.json())).not.toContain('p@ss-word!');
    const raw = await testPool().query(`select row_to_json(s)::text as j from organization_smtp_settings s where organization_id = $1`, [org.orgId]);
    expect(raw.rows[0].j).not.toContain('p@ss-word!');

    const { password: _p, ...noPassword } = body;
    await app.inject({ method: 'PUT', url: '/api/settings/smtp', headers: h, payload: { ...noPassword, from_name: 'Acme Co' } });
    const vault = await testPool().query(
      `select v.decrypted_secret from organization_smtp_settings s join vault.decrypted_secrets v on v.id = s.password_secret_id where s.organization_id = $1`,
      [org.orgId],
    );
    expect(vault.rows[0].decrypted_secret).toBe('p@ss-word!');
  });

  it('test send records the real SMTP error, and success clears it', async () => {
    const mailer = new FakeMailer();
    mailer.verifyError = new Error('535 5.7.8 Username and Password not accepted');
    const app = await buildApp(testDeps({ mailer }));
    const h = bearerFor(org.ownerId);
    await app.inject({ method: 'PUT', url: '/api/settings/smtp', headers: h, payload: body });
    const bad = await app.inject({ method: 'POST', url: '/api/settings/smtp/test', headers: h, payload: { to: 'admin@acme.test' } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().message).toContain('535 5.7.8');
    expect((await app.inject({ method: 'GET', url: '/api/settings/smtp', headers: h })).json()).toMatchObject({ last_test_ok: false, last_test_error: expect.stringContaining('535') });

    mailer.verifyError = null;
    const ok = await app.inject({ method: 'POST', url: '/api/settings/smtp/test', headers: h, payload: { to: 'admin@acme.test' } });
    expect(ok.json()).toMatchObject({ ok: true, to: 'admin@acme.test' });
    expect(mailer.sent.at(-1)).toMatchObject({ to: 'admin@acme.test', organizationId: org.orgId });
  });

  it('is limited to admins', async () => {
    const app = await buildApp(testDeps());
    const viewer = await org.addUser('viewer');
    expect((await app.inject({ method: 'GET', url: '/api/settings/smtp', headers: bearerFor(viewer) })).statusCode).toBe(403);
  });
});
