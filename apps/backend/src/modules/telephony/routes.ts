import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTx } from '../../db/pool';
import type { Deps } from '../../deps';
import { deleteSecret, readSecret, storeSecret } from '../../integrations/vault';
import { badRequest, notFound } from '../../lib/errors';
import { toE164 } from '../../lib/phone';
import { authenticate, authOf, requirePermission } from '../../plugins/auth';

export async function registerTelephonyRoutes(app: FastifyInstance, deps: Deps) {
  const { db } = deps;
  const auth = authenticate(deps);
  const manage = [auth, requirePermission('settings.manage')];

  // --- Cartesia voices ------------------------------------------------------
  app.get('/api/voices', { preHandler: [auth] }, async (req) => {
    const { organizationId } = authOf(req);
    const { rows } = await db.query(
      'select * from voices where organization_id = $1 order by name',
      [organizationId],
    );
    return rows;
  });

  // Lists voices available in the Cartesia account so an admin can pick which to add.
  app.get('/api/voices/cartesia', { preHandler: manage }, async () => deps.cartesia.listVoices());

  app.post('/api/voices', { preHandler: manage }, async (req, reply) => {
    const { organizationId } = authOf(req);
    const body = z
      .object({
        voice_id: z.string().min(1),
        name: z.string().trim().min(1).max(60),
        language: z.string().default('en'),
        model: z.string().default('sonic-3'),
      })
      .parse(req.body);
    const { rows } = await db.query(
      `insert into voices(organization_id, voice_id, name, language, model) values ($1, $2, $3, $4, $5)
       on conflict (organization_id, provider, voice_id) do update set name = excluded.name, language = excluded.language,
         model = excluded.model, is_active = true
       returning *`,
      [organizationId, body.voice_id, body.name, body.language, body.model],
    );
    return reply.status(201).send(rows[0]);
  });

  app.patch('/api/voices/:id', { preHandler: manage }, async (req) => {
    const { organizationId } = authOf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ name: z.string().trim().min(1).max(60).optional(), is_active: z.boolean().optional() }).parse(req.body);
    const { rows } = await db.query(
      `update voices set name = coalesce($3, name), is_active = coalesce($4, is_active)
        where id = $1 and organization_id = $2 returning *`,
      [id, organizationId, body.name ?? null, body.is_active ?? null],
    );
    if (!rows[0]) throw notFound();
    return rows[0];
  });

  // Bulk activate / deactivate / delete. Voices still used by an agent are deactivated-only.
  app.post('/api/voices/bulk', { preHandler: manage }, async (req) => {
    const { organizationId } = authOf(req);
    const body = z
      .object({ ids: z.array(z.string().uuid()).min(1).max(500), action: z.enum(['activate', 'deactivate', 'delete']) })
      .parse(req.body);
    if (body.action !== 'delete') {
      const { rowCount } = await db.query('update voices set is_active = $3 where organization_id = $1 and id = any($2::uuid[])', [
        organizationId,
        body.ids,
        body.action === 'activate',
      ]);
      const n = rowCount ?? 0;
      return { affected: n, skipped: body.ids.length - n, message: `${body.action === 'activate' ? 'Activated' : 'Deactivated'} ${n} voice${n === 1 ? '' : 's'}` };
    }
    const { rowCount } = await db.query(
      `delete from voices v where v.organization_id = $1 and v.id = any($2::uuid[])
          and not exists (select 1 from agents a where a.voice_id = v.id)`,
      [organizationId, body.ids],
    );
    const n = rowCount ?? 0;
    const kept = body.ids.length - n;
    return {
      affected: n,
      skipped: kept,
      message: `Deleted ${n} voice${n === 1 ? '' : 's'}${kept ? `; ${kept} used by an agent were kept (deactivate them or change the agent first)` : ''}`,
    };
  });

  // --- Twilio accounts ------------------------------------------------------
  app.get('/api/twilio-accounts', { preHandler: manage }, async (req) => {
    const { organizationId } = authOf(req);
    const { rows } = await db.query(
      'select id, label, account_sid, created_at from twilio_accounts where organization_id = $1 order by created_at',
      [organizationId],
    );
    return rows;
  });

  app.post('/api/twilio-accounts', { preHandler: manage }, async (req, reply) => {
    const { organizationId } = authOf(req);
    const body = z
      .object({
        label: z.string().trim().min(1).max(100),
        account_sid: z.string().regex(/^AC[a-zA-Z0-9]{32}$/, 'Account SID starts with AC followed by 32 characters'),
        auth_token: z.string().min(16),
      })
      .parse(req.body);
    await deps.twilio.verifyCredentials(body.account_sid, body.auth_token).catch((err) => {
      throw badRequest(`Twilio rejected these credentials: ${(err as Error).message}`);
    });
    const row = await withTx(db, async (c) => {
      const secretId = await storeSecret(c, body.auth_token, `twilio:${organizationId}:${body.account_sid}`);
      const { rows } = await c.query(
        `insert into twilio_accounts(organization_id, label, account_sid, auth_token_secret_id)
         values ($1, $2, $3, $4) returning id, label, account_sid, created_at`,
        [organizationId, body.label, body.account_sid, secretId],
      );
      return rows[0];
    });
    return reply.status(201).send(row);
  });

  app.delete('/api/twilio-accounts/:id', { preHandler: manage }, async (req) => {
    const { organizationId } = authOf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await withTx(db, async (c) => {
      const { rows } = await c.query<{ auth_token_secret_id: string }>(
        'delete from twilio_accounts where id = $1 and organization_id = $2 returning auth_token_secret_id',
        [id, organizationId],
      );
      if (!rows[0]) throw notFound();
      await deleteSecret(c, rows[0].auth_token_secret_id);
    });
    return { ok: true };
  });

  app.get('/api/twilio-accounts/:id/numbers', { preHandler: manage }, async (req) => {
    const { organizationId } = authOf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const acct = await loadTwilioCredentials(deps, organizationId, id);
    return deps.twilio.listIncomingNumbers(acct.accountSid, acct.authToken);
  });

  // --- Phone numbers (Twilio numbers imported into Vapi) ----------------------
  app.get('/api/phone-numbers', { preHandler: [auth] }, async (req) => {
    const { organizationId } = authOf(req);
    const { rows } = await db.query(
      `select p.id, p.e164, p.label, p.is_active, p.vapi_phone_number_id, p.created_at, t.label as twilio_account_label
         from phone_numbers p join twilio_accounts t on t.id = p.twilio_account_id
        where p.organization_id = $1 order by p.created_at`,
      [organizationId],
    );
    return rows;
  });

  app.post('/api/phone-numbers', { preHandler: manage }, async (req, reply) => {
    const { organizationId } = authOf(req);
    const body = z
      .object({ twilio_account_id: z.string().uuid(), number: z.string(), label: z.string().trim().max(100).optional() })
      .parse(req.body);
    const e164 = toE164(body.number);
    if (!e164) throw badRequest('Invalid phone number');
    const acct = await loadTwilioCredentials(deps, organizationId, body.twilio_account_id);
    const imported = await deps.vapi.importTwilioNumber({
      number: e164,
      twilioAccountSid: acct.accountSid,
      twilioAuthToken: acct.authToken,
      name: body.label ?? e164,
      serverUrl: `${deps.config.BACKEND_PUBLIC_URL}/webhooks/vapi`,
      serverSecret: deps.config.VAPI_WEBHOOK_SECRET,
    });
    const { rows } = await db.query(
      `insert into phone_numbers(organization_id, twilio_account_id, e164, label, vapi_phone_number_id)
       values ($1, $2, $3, $4, $5)
       on conflict (organization_id, e164) do update set vapi_phone_number_id = excluded.vapi_phone_number_id,
         twilio_account_id = excluded.twilio_account_id, label = excluded.label, is_active = true
       returning id, e164, label, is_active, vapi_phone_number_id`,
      [organizationId, body.twilio_account_id, e164, body.label ?? null, imported.id],
    );
    return reply.status(201).send(rows[0]);
  });

  app.patch('/api/phone-numbers/:id', { preHandler: manage }, async (req) => {
    const { organizationId } = authOf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ label: z.string().max(100).optional(), is_active: z.boolean().optional() }).parse(req.body);
    const { rows } = await db.query(
      `update phone_numbers set label = coalesce($3, label), is_active = coalesce($4, is_active)
        where id = $1 and organization_id = $2 returning id, e164, label, is_active`,
      [id, organizationId, body.label ?? null, body.is_active ?? null],
    );
    if (!rows[0]) throw notFound();
    return rows[0];
  });

  app.delete('/api/phone-numbers/:id', { preHandler: manage }, async (req) => {
    const { organizationId } = authOf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { rows } = await db.query<{ vapi_phone_number_id: string }>(
      'delete from phone_numbers where id = $1 and organization_id = $2 returning vapi_phone_number_id',
      [id, organizationId],
    );
    if (!rows[0]) throw notFound();
    await deps.vapi.deletePhoneNumber(rows[0].vapi_phone_number_id).catch((err) =>
      req.log.warn({ err }, 'failed to delete phone number from Vapi'),
    );
    return { ok: true };
  });
}

export async function loadTwilioCredentials(deps: Deps, organizationId: string, twilioAccountId: string) {
  const { rows } = await deps.db.query<{ account_sid: string; auth_token_secret_id: string }>(
    'select account_sid, auth_token_secret_id from twilio_accounts where id = $1 and organization_id = $2',
    [twilioAccountId, organizationId],
  );
  if (!rows[0]) throw notFound('Twilio account not found');
  return { accountSid: rows[0].account_sid, authToken: await readSecret(deps.db, rows[0].auth_token_secret_id) };
}
