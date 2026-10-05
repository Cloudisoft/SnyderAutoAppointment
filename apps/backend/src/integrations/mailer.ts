import nodemailer from 'nodemailer';
import type { Config } from '../config';

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  fromName?: string;
  replyTo?: string;
  headers?: Record<string, string>;
  /** Calendar invite sent as a text/calendar alternative and .ics attachment. */
  icalEvent?: { method: 'REQUEST' | 'CANCEL'; filename: string; content: string };
}

export interface Mailer {
  readonly configured: boolean;
  send(email: OutgoingEmail): Promise<{ messageId: string }>;
}

export function createSmtpMailer(config: Config): Mailer {
  const configured = !!(config.SMTP_HOST && config.SMTP_FROM_EMAIL);
  const transport = configured
    ? nodemailer.createTransport({
        host: config.SMTP_HOST,
        port: config.SMTP_PORT,
        secure: config.SMTP_PORT === 465,
        auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } : undefined,
        connectionTimeout: 15_000,
        socketTimeout: 30_000,
      })
    : null;
  return {
    configured,
    async send(email) {
      if (!transport) throw new Error('SMTP is not configured (SMTP_HOST / SMTP_FROM_EMAIL)');
      const info = await transport.sendMail({
        from: { name: email.fromName || config.SMTP_FROM_NAME || config.SMTP_FROM_EMAIL, address: config.SMTP_FROM_EMAIL },
        to: email.to,
        replyTo: email.replyTo,
        subject: email.subject,
        html: email.html,
        text: email.text,
        headers: email.headers,
        ...(email.icalEvent
          ? {
              icalEvent: { method: email.icalEvent.method, filename: email.icalEvent.filename, content: email.icalEvent.content },
            }
          : {}),
      });
      return { messageId: info.messageId };
    },
  };
}
