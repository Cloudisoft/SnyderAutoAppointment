import { CampaignConfigSchema, TERMINAL_LEAD_STATUSES } from '@snyder/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTx } from '../../db/pool';
import type { Deps } from '../../deps';
import { badRequest, notFound } from '../../lib/errors';
import { authenticate, authOf, requirePermission } from '../../plugins/auth';
import { publishCampaign, resolveSnapshot } from './service';

const idParam = z.object({ id: z.string().uuid() });

export async function registerCampaignRoutes(app: FastifyInstance, deps: Deps) {
  const { db } = deps;
  const auth = authenticate(deps);
  const view = [auth, requirePermission('campaigns.view')];
  const manage = [auth, requirePermission('campaigns.manage')];

  app.get('/api/campaigns', { preHandler: view }, async (req) => {
    const { organizationId } = authOf(req);
    const { rows } = await db.query(
      `select c.id, c.name, c.status, c.has_unpublished_changes, c.created_at, c.updated_at,
              v.version as current_version,
              (select count(*)::int from campaign_leads cl where cl.campaign_id = c.id and cl.state <> 'removed') as lead_count,
              (select count(*)::int from campaign_leads cl where cl.campaign_id = c.id and cl.state in ('queued','retry_wait')) as remaining_count
         from campaigns c left join campaign_versions v on v.id = c.current_version_id
        where c.organization_id = $1 and c.status <> 'archived'
        order by c.created_at desc`,
      [organizationId],
    );
    return rows;
  });

  app.post('/api/campaigns', { preHandler: manage }, async (req, reply) => {
    const { organizationId, userId } = authOf(req);
    const body = z.object({ name: z.string().trim().min(1).max(200) }).parse(req.body);
    const { rows: org } = await db.query<{ time_zone: string; name: string }>(
      'select time_zone, name from organizations where id = $1',
      [organizationId],
    );
    const draft = CampaignConfigSchema.parse({ time_zone: org[0]?.time_zone, business_name: org[0]?.name });
    const { rows } = await db.query(
      'insert into campaigns(organization_id, name, draft, created_by) values ($1, $2, $3, $4) returning *',
      [organizationId, body.name, draft, userId],
    );
    return reply.status(201).send(rows[0]);
  });

  app.get('/api/campaigns/:id', { preHandler: view }, async (req) => {
    const { organizationId } = authOf(req);
    const { id } = idParam.parse(req.params);
    const { rows } = await db.query('select * from campaigns where id = $1 and organization_id = $2', [id, organizationId]);
    if (!rows[0]) throw notFound();
    const versions = await db.query(
      `select v.id, v.version, v.published_at, p.email as published_by_email
         from campaign_versions v left join profiles p on p.id = v.published_by
        where v.campaign_id = $1 order by v.version desc`,
      [id],
    );
    const stats = await db.query(
      `select state, count(*)::int as n from campaign_leads where campaign_id = $1 group by state`,
      [id],
    );
    return { ...rows[0], versions: versions.rows, lead_states: Object.fromEntries(stats.rows.map((r) => [r.state, r.n])) };
  });

  app.get('/api/campaigns/:id/versions/:versionId', { preHandler: view }, async (req) => {
    const { organizationId } = authOf(req);
    const p = z.object({ id: z.string().uuid(), versionId: z.string().uuid() }).parse(req.params);
    const { rows } = await db.query(
      'select * from campaign_versions where id = $1 and campaign_id = $2 and organization_id = $3',
      [p.versionId, p.id, organizationId],
    );
    if (!rows[0]) throw notFound();
    return rows[0];
  });

  // Save draft. Unknown sections (e.g. "appointments") are kept and validated by their modules.
  app.put('/api/campaigns/:id/draft', { preHandler: manage }, async (req) => {
    const { organizationId } = authOf(req);
    const { id } = idParam.parse(req.params);
    const body = z
      .object({ name: z.string().trim().min(1).max(200).optional(), config: z.record(z.unknown()) })
      .parse(req.body);
    const config = CampaignConfigSchema.passthrough().parse(body.config);
    const { rows } = await db.query(
      `update campaigns set draft = $3, name = coalesce($4, name), has_unpublished_changes = true
        where id = $1 and organization_id = $2 returning *`,
      [id, organizationId, config, body.name ?? null],
    );
    if (!rows[0]) throw notFound();
    return rows[0];
  });

  // Dry-run publish checks so the editor can show warnings before publishing.
  app.get('/api/campaigns/:id/publish-check', { preHandler: manage }, async (req) => {
    const { organizationId } = authOf(req);
    const { id } = idParam.parse(req.params);
    const { rows } = await db.query('select name, draft from campaigns where id = $1 and organization_id = $2', [
      id,
      organizationId,
    ]);
    if (!rows[0]) throw notFound();
    const r = await resolveSnapshot(db, organizationId, rows[0]);
    return { errors: r.errors, warnings: r.warnings };
  });

  // Save & publish: optionally saves the draft, then freezes it into a new immutable version.
  app.post('/api/campaigns/:id/publish', { preHandler: manage }, async (req, reply) => {
    const { organizationId, userId } = authOf(req);
    const { id } = idParam.parse(req.params);
    const body = z
      .object({ name: z.string().trim().min(1).max(200).optional(), config: z.record(z.unknown()).optional() })
      .parse(req.body ?? {});
    const result = await withTx(db, async (c) => {
      if (body.config) {
        const config = CampaignConfigSchema.passthrough().parse(body.config);
        const upd = await c.query(
          `update campaigns set draft = $3, name = coalesce($4, name), has_unpublished_changes = true
            where id = $1 and organization_id = $2`,
          [id, organizationId, config, body.name ?? null],
        );
        if (!upd.rowCount) throw notFound();
      }
      return publishCampaign(c, organizationId, id, userId);
    });
    if (result.errors.length) return reply.status(422).send({ error: 'publish_failed', ...result });
    return result;
  });

  app.post('/api/campaigns/:id/status', { preHandler: manage }, async (req) => {
    const { organizationId } = authOf(req);
    const { id } = idParam.parse(req.params);
    const { status } = z.object({ status: z.enum(['active', 'paused', 'archived']) }).parse(req.body);
    const { rows } = await db.query<{ current_version_id: string | null }>(
      'select current_version_id from campaigns where id = $1 and organization_id = $2',
      [id, organizationId],
    );
    if (!rows[0]) throw notFound();
    if (status === 'active' && !rows[0].current_version_id) throw badRequest('Publish the campaign before starting it.');
    await db.query('update campaigns set status = $3 where id = $1 and organization_id = $2', [id, organizationId, status]);
    return { ok: true, status };
  });

  // Adds leads (by list or ids). DNC numbers and leads in terminal statuses are skipped.
  app.post('/api/campaigns/:id/leads', { preHandler: manage }, async (req) => {
    const { organizationId } = authOf(req);
    const { id } = idParam.parse(req.params);
    const body = z
      .object({ lead_list_id: z.string().uuid().optional(), lead_ids: z.array(z.string().uuid()).optional() })
      .refine((b) => b.lead_list_id || b.lead_ids?.length, 'Provide lead_list_id or lead_ids')
      .parse(req.body);
    const camp = await db.query('select 1 from campaigns where id = $1 and organization_id = $2', [id, organizationId]);
    if (!camp.rowCount) throw notFound();
    const { rowCount } = await db.query(
      `insert into campaign_leads(organization_id, campaign_id, lead_id)
       select $1, $2, l.id from leads l
        where l.organization_id = $1
          and ($3::uuid is null or l.lead_list_id = $3)
          and ($4::uuid[] is null or l.id = any($4))
          and l.status <> all($5::text[])
          and not exists (select 1 from dnc_numbers d where d.organization_id = $1 and d.phone_e164 = l.phone_e164)
       on conflict (campaign_id, lead_id) do nothing`,
      [organizationId, id, body.lead_list_id ?? null, body.lead_ids ?? null, TERMINAL_LEAD_STATUSES],
    );
    return { added: rowCount ?? 0 };
  });
}
