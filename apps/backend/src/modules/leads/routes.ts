import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTx, type DbClient } from '../../db/pool';
import type { Deps } from '../../deps';
import { parseCsvObjects } from '../../lib/csv';
import { badRequest, notFound } from '../../lib/errors';
import { digitsOnly, toE164 } from '../../lib/phone';
import { authenticate, authOf, requirePermission } from '../../plugins/auth';
import { isValidTimeZone } from '../org/routes';

const STANDARD_FIELDS: Record<string, string> = {
  first_name: 'first_name',
  firstname: 'first_name',
  first: 'first_name',
  last_name: 'last_name',
  lastname: 'last_name',
  last: 'last_name',
  email: 'email',
  email_address: 'email',
  phone: 'phone',
  phone_number: 'phone',
  mobile: 'phone',
  cell: 'phone',
  company: 'company',
  company_name: 'company',
  time_zone: 'time_zone',
  timezone: 'time_zone',
  tz: 'time_zone',
};

const LeadInput = z.object({
  first_name: z.string().trim().max(200).nullish(),
  last_name: z.string().trim().max(200).nullish(),
  email: z.string().trim().email().nullish().or(z.literal('')),
  phone: z.string().min(3),
  company: z.string().trim().max(300).nullish(),
  time_zone: z.string().nullish(),
  lead_list_id: z.string().uuid().nullish(),
  custom_fields: z.record(z.unknown()).default({}),
});

/** Splits a free-text search into a text pattern and a digits-only phone pattern. */
export function searchTerms(q: string | undefined): { text: string | null; digits: string | null } {
  const trimmed = (q ?? '').trim();
  if (!trimmed) return { text: null, digits: null };
  const digits = digitsOnly(trimmed);
  return { text: `%${trimmed.replace(/[%_\\]/g, (c) => `\\${c}`)}%`, digits: digits.length >= 3 ? digits : null };
}

export async function registerLeadRoutes(app: FastifyInstance, deps: Deps) {
  const { db } = deps;
  const auth = authenticate(deps);
  const view = [auth, requirePermission('leads.view')];
  const manage = [auth, requirePermission('leads.manage')];

  // --- Lead lists -----------------------------------------------------------
  app.get('/api/lead-lists', { preHandler: view }, async (req) => {
    const { organizationId } = authOf(req);
    const { rows } = await db.query(
      `select l.id, l.name, l.created_at, count(ld.id)::int as lead_count
         from lead_lists l left join leads ld on ld.lead_list_id = l.id
        where l.organization_id = $1 group by l.id order by l.created_at desc`,
      [organizationId],
    );
    return rows;
  });
  app.post('/api/lead-lists', { preHandler: manage }, async (req, reply) => {
    const { organizationId } = authOf(req);
    const body = z.object({ name: z.string().trim().min(1).max(200) }).parse(req.body);
    const { rows } = await db.query(
      'insert into lead_lists(organization_id, name) values ($1, $2) returning *',
      [organizationId, body.name],
    );
    return reply.status(201).send(rows[0]);
  });
  app.delete('/api/lead-lists/:id', { preHandler: manage }, async (req) => {
    const { organizationId } = authOf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { rowCount } = await db.query('delete from lead_lists where id = $1 and organization_id = $2', [
      id,
      organizationId,
    ]);
    if (!rowCount) throw notFound();
    return { ok: true };
  });

  // --- Custom field definitions --------------------------------------------
  app.get('/api/lead-fields', { preHandler: view }, async (req) => {
    const { organizationId } = authOf(req);
    const { rows } = await db.query(
      'select id, key, label, field_type from lead_custom_field_defs where organization_id = $1 order by label',
      [organizationId],
    );
    return rows;
  });
  app.post('/api/lead-fields', { preHandler: manage }, async (req, reply) => {
    const { organizationId } = authOf(req);
    const body = z
      .object({
        key: z.string().regex(/^[a-z][a-z0-9_]*$/, 'Use lowercase letters, digits and underscores'),
        label: z.string().trim().min(1),
        field_type: z.enum(['text', 'number', 'date', 'boolean']).default('text'),
      })
      .parse(req.body);
    const { rows } = await db.query(
      `insert into lead_custom_field_defs(organization_id, key, label, field_type) values ($1, $2, $3, $4)
       on conflict (organization_id, key) do update set label = excluded.label, field_type = excluded.field_type
       returning id, key, label, field_type`,
      [organizationId, body.key, body.label, body.field_type],
    );
    return reply.status(201).send(rows[0]);
  });
  app.delete('/api/lead-fields/:id', { preHandler: manage }, async (req) => {
    const { organizationId } = authOf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await db.query('delete from lead_custom_field_defs where id = $1 and organization_id = $2', [id, organizationId]);
    return { ok: true };
  });

  // --- Leads ----------------------------------------------------------------
  app.get('/api/leads', { preHandler: view }, async (req) => {
    const { organizationId } = authOf(req);
    const q = z
      .object({
        list_id: z.string().uuid().optional(),
        status: z.string().optional(),
        q: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(500).default(50),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .parse(req.query);
    const s = searchTerms(q.q);
    const { rows } = await db.query(
      `select l.*, count(*) over()::int as total_count
         from leads l
        where l.organization_id = $1
          and ($2::uuid is null or l.lead_list_id = $2)
          and ($3::text is null or l.status = $3)
          and ($4::text is null
               or (coalesce(l.first_name, '') || ' ' || coalesce(l.last_name, '')) ilike $4
               or l.email ilike $4
               or ($5::text is not null and l.phone_digits like '%' || $5 || '%'))
        order by l.created_at desc
        limit $6 offset $7`,
      [organizationId, q.list_id ?? null, q.status ?? null, s.text, s.digits, q.limit, q.offset],
    );
    return { rows: rows.map(({ total_count: _t, ...r }) => r), total: rows[0]?.total_count ?? 0 };
  });

  app.get('/api/leads/:id', { preHandler: view }, async (req) => {
    const { organizationId } = authOf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { rows } = await db.query('select * from leads where id = $1 and organization_id = $2', [id, organizationId]);
    if (!rows[0]) throw notFound();
    return rows[0];
  });

  app.post('/api/leads', { preHandler: manage }, async (req, reply) => {
    const { organizationId } = authOf(req);
    const body = LeadInput.parse(req.body);
    const phone = toE164(body.phone);
    if (!phone) throw badRequest('Invalid phone number');
    if (body.time_zone && !isValidTimeZone(body.time_zone)) throw badRequest('Unknown time zone');
    const { rows } = await db.query(
      `insert into leads(organization_id, lead_list_id, first_name, last_name, email, phone_e164, company, time_zone, custom_fields)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *`,
      [
        organizationId,
        body.lead_list_id ?? null,
        body.first_name ?? null,
        body.last_name ?? null,
        body.email || null,
        phone,
        body.company ?? null,
        body.time_zone ?? null,
        body.custom_fields,
      ],
    );
    return reply.status(201).send(rows[0]);
  });

  app.patch('/api/leads/:id', { preHandler: manage }, async (req) => {
    const { organizationId } = authOf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = LeadInput.partial().parse(req.body);
    const phone = body.phone ? toE164(body.phone) : undefined;
    if (body.phone && !phone) throw badRequest('Invalid phone number');
    if (body.time_zone && !isValidTimeZone(body.time_zone)) throw badRequest('Unknown time zone');
    const { rows } = await db.query(
      `update leads set
         first_name = coalesce($3, first_name), last_name = coalesce($4, last_name),
         email = case when $5::boolean then $6 else email end,
         phone_e164 = coalesce($7, phone_e164), company = coalesce($8, company),
         time_zone = case when $9::boolean then $10 else time_zone end,
         custom_fields = case when $11::jsonb is null then custom_fields else custom_fields || $11::jsonb end
       where id = $1 and organization_id = $2 returning *`,
      [
        id,
        organizationId,
        body.first_name ?? null,
        body.last_name ?? null,
        body.email !== undefined,
        body.email || null,
        phone ?? null,
        body.company ?? null,
        body.time_zone !== undefined,
        body.time_zone || null,
        body.custom_fields && Object.keys(body.custom_fields).length ? body.custom_fields : null,
      ],
    );
    if (!rows[0]) throw notFound();
    return rows[0];
  });

  app.delete('/api/leads/:id', { preHandler: manage }, async (req) => {
    const { organizationId } = authOf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { rowCount } = await db.query('delete from leads where id = $1 and organization_id = $2', [id, organizationId]);
    if (!rowCount) throw notFound();
    return { ok: true };
  });

  // CSV import. Standard columns map to lead fields; anything else becomes a custom field.
  app.post('/api/leads/import', { preHandler: manage, bodyLimit: 20 * 1024 * 1024 }, async (req) => {
    const { organizationId } = authOf(req);
    const body = z
      .object({
        csv: z.string().min(1),
        lead_list_id: z.string().uuid().optional(),
        lead_list_name: z.string().trim().min(1).optional(),
      })
      .parse(req.body);
    const records = parseCsvObjects(body.csv);
    if (!records.length) throw badRequest('The CSV has no data rows');
    if (records.length > 50_000) throw badRequest('Import at most 50,000 rows at a time');

    return withTx(db, async (c) => {
      let listId = body.lead_list_id ?? null;
      if (!listId && body.lead_list_name) {
        const { rows } = await c.query<{ id: string }>(
          'insert into lead_lists(organization_id, name) values ($1, $2) returning id',
          [organizationId, body.lead_list_name],
        );
        listId = rows[0]!.id;
      } else if (listId) {
        const ok = await c.query('select 1 from lead_lists where id = $1 and organization_id = $2', [listId, organizationId]);
        if (!ok.rowCount) throw badRequest('Unknown lead list');
      }

      const customKeys = Object.keys(records[0]!).filter((k) => !STANDARD_FIELDS[k] && /^[a-z][a-z0-9_]*$/.test(k));
      for (const key of customKeys) {
        await c.query(
          `insert into lead_custom_field_defs(organization_id, key, label) values ($1, $2, $3)
           on conflict (organization_id, key) do nothing`,
          [organizationId, key, key.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())],
        );
      }

      let inserted = 0;
      const errors: { row: number; error: string }[] = [];
      for (const [i, rec] of records.entries()) {
        const std: Record<string, string> = {};
        const custom: Record<string, string> = {};
        for (const [k, v] of Object.entries(rec)) {
          const mapped = STANDARD_FIELDS[k];
          if (mapped) std[mapped] = v;
          else if (customKeys.includes(k) && v !== '') custom[k] = v;
        }
        const phone = std.phone ? toE164(std.phone) : null;
        if (!phone) {
          errors.push({ row: i + 2, error: 'Missing or invalid phone number' });
          continue;
        }
        const tz = std.time_zone && isValidTimeZone(std.time_zone) ? std.time_zone : null;
        const email = std.email && z.string().email().safeParse(std.email).success ? std.email : null;
        await c.query(
          `insert into leads(organization_id, lead_list_id, first_name, last_name, email, phone_e164, company, time_zone, custom_fields)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [organizationId, listId, std.first_name || null, std.last_name || null, email, phone, std.company || null, tz, custom],
        );
        inserted++;
      }
      return { inserted, skipped: errors.length, errors: errors.slice(0, 100), lead_list_id: listId };
    });
  });

  // --- Suppressions & DNC ----------------------------------------------------
  app.get('/api/email-suppressions', { preHandler: view }, async (req) => {
    const { organizationId } = authOf(req);
    const { rows } = await db.query(
      'select id, email, reason, created_at from email_suppressions where organization_id = $1 order by created_at desc limit 1000',
      [organizationId],
    );
    return rows;
  });
  app.post('/api/email-suppressions', { preHandler: manage }, async (req, reply) => {
    const { organizationId } = authOf(req);
    const body = z.object({ email: z.string().trim().email(), reason: z.string().default('manual') }).parse(req.body);
    await addEmailSuppression(db, organizationId, body.email, body.reason);
    return reply.status(201).send({ ok: true });
  });
  app.delete('/api/email-suppressions/:id', { preHandler: manage }, async (req) => {
    const { organizationId } = authOf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await db.query('delete from email_suppressions where id = $1 and organization_id = $2', [id, organizationId]);
    return { ok: true };
  });

  app.get('/api/dnc', { preHandler: view }, async (req) => {
    const { organizationId } = authOf(req);
    const { rows } = await db.query(
      'select id, phone_e164, source, created_at from dnc_numbers where organization_id = $1 order by created_at desc limit 1000',
      [organizationId],
    );
    return rows;
  });
  app.post('/api/dnc', { preHandler: manage }, async (req, reply) => {
    const { organizationId } = authOf(req);
    const body = z.object({ phone: z.string() }).parse(req.body);
    const phone = toE164(body.phone);
    if (!phone) throw badRequest('Invalid phone number');
    await addDnc(db, organizationId, phone, 'manual');
    return reply.status(201).send({ ok: true });
  });
  app.delete('/api/dnc/:id', { preHandler: manage }, async (req) => {
    const { organizationId } = authOf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await db.query('delete from dnc_numbers where id = $1 and organization_id = $2', [id, organizationId]);
    return { ok: true };
  });
}

export async function addEmailSuppression(
  db: DbClient,
  organizationId: string,
  email: string,
  reason: string,
) {
  await db.query(
    `insert into email_suppressions(organization_id, email, reason) values ($1, $2, $3)
     on conflict (organization_id, lower(email)) do nothing`,
    [organizationId, email.trim(), reason],
  );
}

export async function isEmailSuppressed(
  db: DbClient,
  organizationId: string,
  email: string,
): Promise<boolean> {
  const { rowCount } = await db.query(
    'select 1 from email_suppressions where organization_id = $1 and lower(email) = lower($2)',
    [organizationId, email.trim()],
  );
  return !!rowCount;
}

export async function addDnc(db: DbClient, organizationId: string, phoneE164: string, source: string) {
  await db.query(
    `insert into dnc_numbers(organization_id, phone_e164, source) values ($1, $2, $3)
     on conflict (organization_id, phone_e164) do nothing`,
    [organizationId, phoneE164, source],
  );
}
