import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTx } from '../../db/pool';
import type { Deps } from '../../deps';
import { loadOrgSmtpSettings, type SmtpSettings } from '../../integrations/mailer';
import { deleteSecret, storeSecret } from '../../integrations/vault';
import { badRequest, notFound } from '../../lib/errors';
import { authenticate, authOf, requirePermission } from '../../plugins/auth';

const SmtpInput = z.object({
  host: z.string().trim().min(1).max(253).regex(/^[A-Za-z0-9.-]+$/, 'Enter a host name such as smtp.example.com'),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  username: z.string().trim().max(320).nullable().optional(),
  /** Omit to keep the saved password; empty string clears it. */
  password: z.string().max(1000).optional(),
  from_email: z.string().trim().email(),
  from_name: z.string().trim().max(120).nullable().optional(),
  reply_to: z.string().trim().email().nullable().optional().or(z.literal('')),
});

type SmtpRow = {
  host: string;
  port: number;
  secure: boolean;
  username: string | null;
  password_secret_id: string | null;
  from_email: string;
  from_name: string | null;
  reply_to: string | null;
  last_tested_at: Date | null;
  last_test_ok: boolean | null;
  last_test_error: string | null;
  updated_at: Date;
};

/** Never returns the password, only whether one is saved. */
function publicView(r: SmtpRow | undefined, platformFallback: boolean) {
  if (!r) return { configured: false, platform_fallback: platformFallback };
  const { password_secret_id, ...rest } = r;
  return { configured: true, platform_fallback: platformFallback, ...rest, has_password: !!password_secret_id };
}

/** Settings > Email (SMTP): each organization sends appointment emails through its own SMTP server. */
export async function registerSmtpRoutes(app: FastifyInstance, deps: Deps) {
  const { db } = deps;
  const manage = [authenticate(deps), requirePermission('settings.manage')];
  const platformFallback = !!(deps.config.SMTP_HOST && deps.config.SMTP_FROM_EMAIL);

  app.get('/api/settings/smtp', { preHandler: manage }, async (req) => {
    const { organizationId } = authOf(req);
    const { rows } = await db.query<SmtpRow>('select * from organization_smtp_settings where organization_id = $1', [organizationId]);
    return publicView(rows[0], platformFallback);
  });

  app.put('/api/settings/smtp', { preHandler: manage }, async (req) => {
    const { organizationId, userId } = authOf(req);
    const b = SmtpInput.parse(req.body);
    const row = await withTx(db, async (c) => {
      const { rows: existing } = await c.query<{ password_secret_id: string | null }>(
        'select password_secret_id from organization_smtp_settings where organization_id = $1 for update',
        [organizationId],
      );
      let secretId = existing[0]?.password_secret_id ?? null;
      if (b.password !== undefined) {
        if (secretId) await deleteSecret(c, secretId);
        secretId = b.password ? await storeSecret(c, b.password, `smtp:${organizationId}:${Date.now()}`) : null;
      }
      const { rows } = await c.query<SmtpRow>(
        `insert into organization_smtp_settings(organization_id, host, port, secure, username, password_secret_id, from_email, from_name, reply_to, updated_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         on conflict (organization_id) do update set host = excluded.host, port = excluded.port, secure = excluded.secure,
           username = excluded.username, password_secret_id = excluded.password_secret_id, from_email = excluded.from_email,
           from_name = excluded.from_name, reply_to = excluded.reply_to, updated_by = excluded.updated_by,
           last_tested_at = null, last_test_ok = null, last_test_error = null
         returning *`,
        [organizationId, b.host, b.port, b.secure, b.username || null, secretId, b.from_email, b.from_name || null, b.reply_to || null, userId],
      );
      return rows[0];
    });
    return publicView(row, platformFallback);
  });

  app.delete('/api/settings/smtp', { preHandler: manage }, async (req) => {
    const { organizationId } = authOf(req);
    await withTx(db, async (c) => {
      const { rows } = await c.query<{ password_secret_id: string | null }>(
        'delete from organization_smtp_settings where organization_id = $1 returning password_secret_id',
        [organizationId],
      );
      if (rows[0]?.password_secret_id) await deleteSecret(c, rows[0].password_secret_id);
    });
    return { ok: true };
  });

  // Connects, authenticates and sends a test email; records the result (with the real SMTP error).
  app.post('/api/settings/smtp/test', { preHandler: manage }, async (req) => {
    const { organizationId, email: userEmail } = authOf(req);
    const { to } = z.object({ to: z.string().trim().email().optional() }).parse(req.body ?? {});
    const recipient = to ?? userEmail;
    if (!recipient) throw badRequest('Enter an address to send the test to');
    const saved = await loadOrgSmtpSettings(db, organizationId);
    if (!saved) throw notFound('Save your SMTP settings first');
    const settings: SmtpSettings = saved;
    const { rows: org } = await db.query<{ name: string }>('select name from organizations where id = $1', [organizationId]);
    try {
      await deps.mailer.verify(settings);
      const res = await deps.mailer.send({
        organizationId,
        to: recipient,
        subject: `Test email from ${org[0]?.name ?? 'Snyder'}`,
        text: `Your SMTP settings work. Appointment emails will be sent from ${settings.fromEmail}.`,
        html: `<p>Your SMTP settings work.</p><p>Appointment emails will be sent from <strong>${settings.fromEmail.replace(/[<>&"]/g, '')}</strong>.</p>`,
      });
      await db.query(
        `update organization_smtp_settings set last_tested_at = now(), last_test_ok = true, last_test_error = null where organization_id = $1`,
        [organizationId],
      );
      return { ok: true, to: recipient, messageId: res.messageId };
    } catch (err) {
      const message = (err as Error).message?.slice(0, 1000) || String(err);
      await db.query(
        `update organization_smtp_settings set last_tested_at = now(), last_test_ok = false, last_test_error = $2 where organization_id = $1`,
        [organizationId, message],
      );
      throw badRequest(`SMTP error: ${message}`, 'smtp_error');
    }
  });
}
