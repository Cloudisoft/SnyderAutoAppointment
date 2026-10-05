import { CampaignConfigSchema, type CampaignConfig, type CampaignSnapshot } from '@snyder/shared';
import type pg from 'pg';
import type { DbClient } from '../../db/pool';
import { notFound } from '../../lib/errors';
import { appointmentSnapshotContributor } from '../appointments/settings';

export interface PublishCheck {
  errors: string[];
  warnings: string[];
}

/** Feature sections of the campaign config (e.g. "appointments") validated and frozen on publish. */
export interface SnapshotContributor {
  key: string;
  validate(db: DbClient, organizationId: string, draft: Record<string, unknown>): Promise<PublishCheck>;
  /** Returns the normalized (defaulted) section(s) to store in the snapshot. */
  normalize(draft: Record<string, unknown>): Record<string, unknown>;
}

const contributors: SnapshotContributor[] = [appointmentSnapshotContributor];

export function parseCampaignConfig(raw: unknown): CampaignConfig {
  return CampaignConfigSchema.parse(raw ?? {});
}

/** Resolves agent, voice and numbers for the draft and reports blocking errors and warnings. */
export async function resolveSnapshot(
  db: DbClient,
  organizationId: string,
  campaign: { name: string; draft: Record<string, unknown> },
): Promise<{ snapshot: CampaignSnapshot | null } & PublishCheck> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const parsed = CampaignConfigSchema.safeParse(campaign.draft ?? {});
  if (!parsed.success) {
    return { snapshot: null, errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`), warnings };
  }
  const config = parsed.data;

  let agent: CampaignSnapshot['agent'] | null = null;
  if (!config.agent_id) errors.push('Choose an agent.');
  else {
    const { rows } = await db.query(
      `select a.*, v.voice_id as v_voice_id, v.name as v_name, v.model as v_model, v.language as v_language,
              v.is_active as v_active, kb.vapi_tool_id as kb_tool_id
         from agents a
         left join voices v on v.id = a.voice_id
         left join knowledge_bases kb on kb.id = a.knowledge_base_id
        where a.id = $1 and a.organization_id = $2`,
      [config.agent_id, organizationId],
    );
    const a = rows[0];
    if (!a) errors.push('The selected agent no longer exists.');
    else if (!a.v_voice_id) errors.push('The agent has no voice.');
    else if (!a.v_active) errors.push('The agent’s voice is disabled.');
    else {
      if (!a.system_prompt.trim()) warnings.push('The agent has an empty prompt.');
      agent = {
        id: a.id,
        name: a.name,
        system_prompt: a.system_prompt,
        first_message: a.first_message,
        model: a.model,
        temperature: Number(a.temperature),
        transfer_number: a.transfer_number,
        end_call_message: a.end_call_message,
        knowledge_base_vapi_tool_id: a.kb_tool_id ?? null,
        voice: { voice_id: a.v_voice_id, name: a.v_name, model: a.v_model, language: a.v_language },
      };
    }
  }

  const { rows: numbers } = await db.query<{ id: string; e164: string; vapi_phone_number_id: string }>(
    `select id, e164, vapi_phone_number_id from phone_numbers
      where organization_id = $1 and id = any($2::uuid[]) and is_active order by e164`,
    [organizationId, config.phone_number_ids],
  );
  if (!numbers.length) errors.push('Choose at least one active phone number.');

  for (const c of contributors) {
    const r = await c.validate(db, organizationId, campaign.draft ?? {});
    errors.push(...r.errors);
    warnings.push(...r.warnings);
  }

  if (errors.length || !agent) return { snapshot: null, errors, warnings };
  const sections = Object.assign({}, ...contributors.map((c) => c.normalize(campaign.draft ?? {})));
  return {
    snapshot: { ...(campaign.draft as object), ...sections, ...config, campaign_name: campaign.name, agent, phone_numbers: numbers },
    errors,
    warnings,
  };
}

export async function publishCampaign(
  client: pg.PoolClient,
  organizationId: string,
  campaignId: string,
  userId: string | null,
): Promise<{ versionId: string | null; version: number | null } & PublishCheck> {
  const { rows } = await client.query(
    'select id, name, draft from campaigns where id = $1 and organization_id = $2 for update',
    [campaignId, organizationId],
  );
  const campaign = rows[0];
  if (!campaign) throw notFound('Campaign not found');
  const resolved = await resolveSnapshot(client, organizationId, campaign);
  if (!resolved.snapshot) return { versionId: null, version: null, errors: resolved.errors, warnings: resolved.warnings };
  const { rows: v } = await client.query<{ id: string; version: number }>(
    `insert into campaign_versions(organization_id, campaign_id, version, snapshot, published_by)
     select $1, $2, coalesce(max(version), 0) + 1, $3, $4 from campaign_versions where campaign_id = $2
     returning id, version`,
    [organizationId, campaignId, resolved.snapshot, userId],
  );
  await client.query(
    'update campaigns set current_version_id = $2, has_unpublished_changes = false where id = $1',
    [campaignId, v[0]!.id],
  );
  return { versionId: v[0]!.id, version: v[0]!.version, errors: [], warnings: resolved.warnings };
}

export async function loadVersionSnapshot(db: DbClient, versionId: string): Promise<CampaignSnapshot> {
  const { rows } = await db.query<{ snapshot: CampaignSnapshot }>('select snapshot from campaign_versions where id = $1', [
    versionId,
  ]);
  if (!rows[0]) throw notFound('Campaign version not found');
  return rows[0].snapshot;
}
