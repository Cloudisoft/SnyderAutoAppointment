import nodemailer, { type Transporter } from 'nodemailer';
import type { Config } from '../config';
import type { DbClient } from '../db/pool';
import { readSecret } from './vault';

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
  /** Send through this organization's SMTP settings (falls back to the platform SMTP_* env vars). */
  organizationId?: string;
}

export interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  username: string | null;
  password: string | null;
  fromEmail: string;
  fromName: string | null;
  replyTo: string | null;
}

export interface Mailer {
  send(email: OutgoingEmail): Promise<{ messageId: string }>;
  /** Connects and authenticates without sending (used by "Send test email"). */
  verify(settings: SmtpSettings): Promise<void>;
  /** The settings that would be used for an organization, or null if email isn't set up. */
  settingsFor(organizationId?: string): Promise<SmtpSettings | null>;
}

export class SmtpNotConfiguredError extends Error {
  constructor() {
    super('SMTP is not configured. An admin can set it up in Settings → Email (SMTP).');
  }
}

type TransportFactory = (settings: SmtpSettings) => Transporter;

export const smtpTransport: TransportFactory = (s) =>
  nodemailer.createTransport({
    host: s.host,
    port: s.port,
    secure: s.secure,
    auth: s.username ? { user: s.username, pass: s.password ?? '' } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });

export function envSmtpSettings(config: Config): SmtpSettings | null {
  if (!config.SMTP_HOST || !config.SMTP_FROM_EMAIL) return null;
  return {
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_PORT === 465,
    username: config.SMTP_USER || null,
    password: config.SMTP_PASSWORD || null,
    fromEmail: config.SMTP_FROM_EMAIL,
    fromName: config.SMTP_FROM_NAME || null,
    replyTo: null,
  };
}

export async function loadOrgSmtpSettings(db: DbClient, organizationId: string): Promise<(SmtpSettings & { updatedAt: Date }) | null> {
  const { rows } = await db.query<{
    host: string;
    port: number;
    secure: boolean;
    username: string | null;
    password_secret_id: string | null;
    from_email: string;
    from_name: string | null;
    reply_to: string | null;
    updated_at: Date;
  }>('select * from organization_smtp_settings where organization_id = $1', [organizationId]);
  const r = rows[0];
  if (!r) return null;
  return {
    host: r.host,
    port: r.port,
    secure: r.secure,
    username: r.username,
    password: r.password_secret_id ? await readSecret(db, r.password_secret_id) : null,
    fromEmail: r.from_email,
    fromName: r.from_name,
    replyTo: r.reply_to,
    updatedAt: r.updated_at,
  };
}

/**
 * SMTP via Nodemailer. Each organization's own settings are used when present (transports are
 * cached until the settings change); otherwise the platform SMTP_* env vars, if set.
 */
export function createSmtpMailer(config: Config, db: DbClient, makeTransport: TransportFactory = smtpTransport): Mailer {
  const env = envSmtpSettings(config);
  const envTransport = env ? makeTransport(env) : null;
  const cache = new Map<string, { stamp: number; transport: Transporter; settings: SmtpSettings }>();

  async function resolve(organizationId?: string): Promise<{ settings: SmtpSettings; transport: Transporter } | null> {
    if (organizationId) {
      const { rows } = await db.query<{ updated_at: Date }>(
        'select updated_at from organization_smtp_settings where organization_id = $1',
        [organizationId],
      );
      const stamp = rows[0]?.updated_at.getTime();
      if (stamp !== undefined) {
        const hit = cache.get(organizationId);
        if (hit && hit.stamp === stamp) return hit;
        const settings = await loadOrgSmtpSettings(db, organizationId);
        if (settings) {
          hit?.transport.close();
          const entry = { stamp, settings, transport: makeTransport(settings) };
          cache.set(organizationId, entry);
          return entry;
        }
      }
    }
    return env && envTransport ? { settings: env, transport: envTransport } : null;
  }

  return {
    async settingsFor(organizationId) {
      return (await resolve(organizationId))?.settings ?? null;
    },
    async verify(settings) {
      const t = makeTransport(settings);
      try {
        await t.verify();
      } finally {
        t.close();
      }
    },
    async send(email) {
      const r = await resolve(email.organizationId);
      if (!r) throw new SmtpNotConfiguredError();
      const { settings, transport } = r;
      const info = await transport.sendMail({
        from: { name: email.fromName || settings.fromName || settings.fromEmail, address: settings.fromEmail },
        to: email.to,
        replyTo: email.replyTo ?? settings.replyTo ?? undefined,
        subject: email.subject,
        html: email.html,
        text: email.text,
        headers: email.headers,
        ...(email.icalEvent
          ? { icalEvent: { method: email.icalEvent.method, filename: email.icalEvent.filename, content: email.icalEvent.content } }
          : {}),
      });
      return { messageId: info.messageId };
    },
  };
}
