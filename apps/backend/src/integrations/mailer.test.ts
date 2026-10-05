import nodemailer from 'nodemailer';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { closeTestPool, describeDb, seedOrg, testPool, type SeededOrg } from '../../test/helpers/db';
import { testConfig } from '../../test/helpers/deps';
import { createSmtpMailer, SmtpNotConfiguredError, type SmtpSettings } from './mailer';

describeDb('per-organization SMTP mailer', () => {
  let org: SeededOrg;
  let other: SeededOrg;
  const built: SmtpSettings[] = [];
  const factory = (s: SmtpSettings) => {
    built.push(s);
    return nodemailer.createTransport({ jsonTransport: true });
  };
  beforeAll(async () => {
    org = await seedOrg(testPool());
    other = await seedOrg(testPool());
    await testPool().query(
      `insert into organization_smtp_settings(organization_id, host, port, secure, username, password_secret_id, from_email, from_name)
       values ($1, 'smtp.acme.test', 465, true, 'mailer', vault.create_secret('s3cret'), 'hello@acme.test', 'Acme')`,
      [org.orgId],
    );
  });
  afterAll(closeTestPool);

  it('sends with the organization’s settings and password from Vault', async () => {
    const mailer = createSmtpMailer(testConfig(), testPool(), factory);
    const res = await mailer.send({ organizationId: org.orgId, to: 'p@example.com', subject: 'Hi', text: 't', html: '<p>t</p>' });
    expect(res.messageId).toBeTruthy();
    expect(built.at(-1)).toMatchObject({ host: 'smtp.acme.test', port: 465, secure: true, username: 'mailer', password: 's3cret', fromEmail: 'hello@acme.test' });
    const before = built.length;
    await mailer.send({ organizationId: org.orgId, to: 'p@example.com', subject: 'Hi', text: 't', html: 't' });
    expect(built.length).toBe(before); // transport cached

    await testPool().query(`update organization_smtp_settings set host = 'smtp2.acme.test' where organization_id = $1`, [org.orgId]);
    await mailer.send({ organizationId: org.orgId, to: 'p@example.com', subject: 'Hi', text: 't', html: 't' });
    expect(built.at(-1)!.host).toBe('smtp2.acme.test'); // refreshed after a change
  });

  it('falls back to platform env settings, and errors clearly when neither exists', async () => {
    const withEnv = createSmtpMailer(testConfig({ SMTP_HOST: 'smtp.platform.test', SMTP_FROM_EMAIL: 'noreply@platform.test' }), testPool(), factory);
    expect((await withEnv.settingsFor(other.orgId))?.host).toBe('smtp.platform.test');
    const none = createSmtpMailer(testConfig(), testPool(), factory);
    await expect(none.send({ organizationId: other.orgId, to: 'x@example.com', subject: 's', text: 't', html: 't' })).rejects.toBeInstanceOf(SmtpNotConfiguredError);
  });
});
