import { afterEach, describe, expect, it, vi } from 'vitest';
import { testConfig } from '../../test/helpers/deps';
import { sendViaApi } from './emailApi';
import { createSmtpMailer, envSmtpSettings, explainSmtpError, type SmtpSettings } from './mailer';

const settings = (transport: SmtpSettings['transport']): SmtpSettings => ({
  transport, host: '', port: 0, secure: true, username: null, password: 'key-123', fromEmail: 'noreply@snyder.test', fromName: 'Snyder', replyTo: null,
});
const email = {
  to: 'ada@example.com', subject: 'Confirmed', html: '<p>Hi</p>', text: 'Hi', fromName: 'Acme Co', replyTo: 'host@acme.test',
  icalEvent: { method: 'REQUEST' as const, filename: 'invite.ics', content: 'BEGIN:VCALENDAR' },
};

describe('email API transports', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ['resend', 'https://api.resend.com/emails', 'authorization', 'Bearer key-123'],
    ['sendgrid', 'https://api.sendgrid.com/v3/mail/send', 'authorization', 'Bearer key-123'],
    ['postmark', 'https://api.postmarkapp.com/email', 'x-postmark-server-token', 'key-123'],
    ['brevo', 'https://api.brevo.com/v3/smtp/email', 'api-key', 'key-123'],
  ] as const)('%s: posts over HTTPS with the key, reply-to and the calendar invite', async (transport, url, header, value) => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', async (u: string, init: RequestInit) => {
      calls.push({ url: u, init });
      return new Response(JSON.stringify({ id: 'm1', MessageID: 'm1', messageId: 'm1' }), { status: 200, headers: { 'x-message-id': 'm1' } });
    });
    const r = await sendViaApi(transport, settings(transport), email);
    expect(r.messageId).toBe('m1');
    expect(calls[0]!.url).toBe(url);
    expect((calls[0]!.init.headers as Record<string, string>)[header]).toBe(value);
    const body = String(calls[0]!.init.body);
    expect(body).toContain('host@acme.test');
    expect(body).toContain(Buffer.from('BEGIN:VCALENDAR').toString('base64'));
    expect(body).toContain('Acme Co');
  });

  it('surfaces the provider error', async () => {
    vi.stubGlobal('fetch', async () => new Response('{"message":"The from address is not verified"}', { status: 403 }));
    await expect(sendViaApi('resend', settings('resend'), email)).rejects.toThrow('not verified');
  });
});

describe('platform email', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('organizations without their own email send through the platform email API', async () => {
    const config = testConfig({ PLATFORM_EMAIL_TRANSPORT: 'resend', PLATFORM_EMAIL_API_KEY: 'pk', PLATFORM_EMAIL_FROM: 'appointments@snyder.test' });
    expect(envSmtpSettings(config)).toMatchObject({ transport: 'resend', fromEmail: 'appointments@snyder.test' });
    const sent: string[] = [];
    vi.stubGlobal('fetch', async (u: string) => {
      sent.push(u);
      return new Response('{"id":"x"}', { status: 200 });
    });
    const db = { query: async () => ({ rows: [], rowCount: 0 }) } as never;
    const mailer = createSmtpMailer(config, db, () => {
      throw new Error('SMTP must not be used');
    });
    await mailer.send({ ...email, organizationId: '00000000-0000-4000-8000-000000000000' });
    expect(sent).toEqual(['https://api.resend.com/emails']);
  });

  it('explains SMTP timeouts as a blocked port with the fix', () => {
    expect(explainSmtpError(Object.assign(new Error('Connection timeout'), { code: 'ETIMEDOUT' }))).toContain('blocks outgoing SMTP ports');
    expect(explainSmtpError(new Error('Invalid login'))).toBe('Invalid login');
  });
});
