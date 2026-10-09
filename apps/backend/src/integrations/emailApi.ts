import { UpstreamError } from '../lib/http';
import type { OutgoingEmail, SmtpSettings } from './mailer';

/** Email services reachable over HTTPS (port 443), for hosts that block outbound SMTP. */
export const API_TRANSPORTS = ['resend', 'sendgrid', 'postmark', 'brevo'] as const;
export type ApiTransport = (typeof API_TRANSPORTS)[number];
export const TRANSPORT_LABELS: Record<ApiTransport, string> = { resend: 'Resend', sendgrid: 'SendGrid', postmark: 'Postmark', brevo: 'Brevo' };

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

async function call(service: string, url: string, init: RequestInit): Promise<{ status: number; text: string; headers: Headers }> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  } catch (err) {
    throw new UpstreamError(service, 0, `could not connect (${(err as Error).message})`);
  }
  const text = await res.text();
  if (!res.ok) throw new UpstreamError(service, res.status, text);
  return { status: res.status, text, headers: res.headers };
}

const json = (t: string): Record<string, unknown> => {
  try {
    return JSON.parse(t) as Record<string, unknown>;
  } catch {
    return {};
  }
};

export async function sendViaApi(transport: ApiTransport, s: SmtpSettings, e: OutgoingEmail): Promise<{ messageId: string }> {
  const key = s.password ?? '';
  const fromName = e.fromName || s.fromName || s.fromEmail;
  // The organization's configured reply-to wins; otherwise the sender's suggestion (e.g. the host).
  const replyTo = s.replyTo ?? e.replyTo ?? undefined;
  const ics = e.icalEvent;
  const name = TRANSPORT_LABELS[transport];
  switch (transport) {
    case 'resend': {
      const r = await call(name, 'https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          from: `${fromName.replace(/[<>"]/g, '')} <${s.fromEmail}>`,
          to: [e.to],
          subject: e.subject,
          html: e.html,
          text: e.text,
          ...(replyTo ? { reply_to: replyTo } : {}),
          ...(e.headers ? { headers: e.headers } : {}),
          ...(ics ? { attachments: [{ filename: ics.filename, content: b64(ics.content), content_type: `text/calendar; method=${ics.method}` }] } : {}),
        }),
      });
      return { messageId: String(json(r.text).id ?? 'resend') };
    }
    case 'sendgrid': {
      const r = await call(name, 'https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: e.to }] }],
          from: { email: s.fromEmail, name: fromName },
          ...(replyTo ? { reply_to: { email: replyTo } } : {}),
          subject: e.subject,
          content: [
            { type: 'text/plain', value: e.text },
            { type: 'text/html', value: e.html },
          ],
          ...(e.headers ? { headers: e.headers } : {}),
          ...(ics ? { attachments: [{ content: b64(ics.content), filename: ics.filename, type: `text/calendar; method=${ics.method}`, disposition: 'attachment' }] } : {}),
        }),
      });
      return { messageId: r.headers.get('x-message-id') ?? 'sendgrid' };
    }
    case 'postmark': {
      const r = await call(name, 'https://api.postmarkapp.com/email', {
        method: 'POST',
        headers: { 'x-postmark-server-token': key, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          From: `${fromName.replace(/[<>"]/g, '')} <${s.fromEmail}>`,
          To: e.to,
          Subject: e.subject,
          HtmlBody: e.html,
          TextBody: e.text,
          MessageStream: 'outbound',
          ...(replyTo ? { ReplyTo: replyTo } : {}),
          ...(e.headers ? { Headers: Object.entries(e.headers).map(([Name, Value]) => ({ Name, Value })) } : {}),
          ...(ics ? { Attachments: [{ Name: ics.filename, Content: b64(ics.content), ContentType: `text/calendar; method=${ics.method}` }] } : {}),
        }),
      });
      return { messageId: String(json(r.text).MessageID ?? 'postmark') };
    }
    case 'brevo': {
      const r = await call(name, 'https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': key, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          sender: { name: fromName, email: s.fromEmail },
          to: [{ email: e.to }],
          subject: e.subject,
          htmlContent: e.html,
          textContent: e.text,
          ...(replyTo ? { replyTo: { email: replyTo } } : {}),
          ...(e.headers ? { headers: e.headers } : {}),
          ...(ics ? { attachment: [{ name: ics.filename, content: b64(ics.content) }] } : {}),
        }),
      });
      return { messageId: String(json(r.text).messageId ?? 'brevo') };
    }
  }
}

/** Checks the API key without sending anything. */
export async function verifyApi(transport: ApiTransport, s: SmtpSettings): Promise<void> {
  const key = s.password ?? '';
  if (!key) throw new Error(`Enter your ${TRANSPORT_LABELS[transport]} API key`);
  const name = TRANSPORT_LABELS[transport];
  if (transport === 'resend') await call(name, 'https://api.resend.com/domains', { headers: { authorization: `Bearer ${key}` } });
  if (transport === 'sendgrid') await call(name, 'https://api.sendgrid.com/v3/scopes', { headers: { authorization: `Bearer ${key}` } });
  if (transport === 'postmark') await call(name, 'https://api.postmarkapp.com/server', { headers: { 'x-postmark-server-token': key, accept: 'application/json' } });
  if (transport === 'brevo') await call(name, 'https://api.brevo.com/v3/account', { headers: { 'api-key': key, accept: 'application/json' } });
}
