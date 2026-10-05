import type { Db } from '../../src/db/pool';
import { withTx } from '../../src/db/pool';
import { publishCampaign } from '../../src/modules/campaigns/service';

let seq = 0;
const uniq = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;

export async function createVoice(db: Db, orgId: string, name = 'Katie') {
  const { rows } = await db.query<{ id: string }>(
    `insert into voices(organization_id, voice_id, name) values ($1, $2, $3) returning id`,
    [orgId, `cartesia-${uniq()}`, name],
  );
  return rows[0]!.id;
}

export async function createAgent(db: Db, orgId: string, opts: { prompt?: string; voiceName?: string } = {}) {
  const voiceId = await createVoice(db, orgId, opts.voiceName);
  const { rows } = await db.query<{ id: string }>(
    `insert into agents(organization_id, name, voice_id, system_prompt, first_message)
     values ($1, 'Agent', $2, $3, 'Hi {{first_name}}, this is {{agent_name}} from {{business_name}}.') returning id`,
    [orgId, voiceId, opts.prompt ?? 'You are calling {{first_name}} about {{campaign_name}}.'],
  );
  return rows[0]!.id;
}

export async function createPhoneNumber(db: Db, orgId: string) {
  const { rows: acct } = await db.query<{ id: string }>(
    `insert into twilio_accounts(organization_id, label, account_sid, auth_token_secret_id)
     values ($1, 'Main', $2, vault.create_secret('token-' || $2)) returning id`,
    [orgId, `AC${uniq().padEnd(32, '0').slice(0, 32)}`],
  );
  const e164 = `+1212555${String(1000 + (seq++ % 9000)).padStart(4, '0')}`;
  const { rows } = await db.query<{ id: string }>(
    `insert into phone_numbers(organization_id, twilio_account_id, e164, vapi_phone_number_id)
     values ($1, $2, $3, $4) on conflict (organization_id, e164) do update set is_active = true returning id`,
    [orgId, acct[0]!.id, e164, `pn_${uniq()}`],
  );
  return rows[0]!.id;
}

export async function createLead(
  db: Db,
  orgId: string,
  fields: Partial<{ first_name: string; last_name: string; email: string; phone_e164: string; time_zone: string | null; custom_fields: Record<string, unknown> }> = {},
) {
  const { rows } = await db.query<{ id: string }>(
    `insert into leads(organization_id, first_name, last_name, email, phone_e164, time_zone, custom_fields)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [
      orgId,
      fields.first_name ?? 'Ada',
      fields.last_name ?? 'Lovelace',
      fields.email ?? 'ada@example.com',
      fields.phone_e164 ?? '+12125550142',
      fields.time_zone ?? null,
      fields.custom_fields ?? {},
    ],
  );
  return rows[0]!.id;
}

/** Creates and publishes a campaign. `extra` is merged into the draft (e.g. { appointments: {...} }). */
export async function createPublishedCampaign(
  db: Db,
  orgId: string,
  extra: Record<string, unknown> = {},
  opts: { name?: string } = {},
) {
  const agentId = await createAgent(db, orgId);
  const numberId = await createPhoneNumber(db, orgId);
  const draft = {
    agent_id: agentId,
    phone_number_ids: [numberId],
    business_name: 'Acme Co',
    time_zone: 'America/New_York',
    concurrency: 2,
    calling_window: { days: [1, 2, 3, 4, 5, 6, 7], start: '00:00', end: '23:59' },
    max_attempts: 3,
    retry_delay_minutes: 60,
    ...extra,
  };
  const { rows } = await db.query<{ id: string }>(
    `insert into campaigns(organization_id, name, draft, status) values ($1, $2, $3, 'active') returning id`,
    [orgId, opts.name ?? 'Spring Outreach', draft],
  );
  const campaignId = rows[0]!.id;
  const res = await withTx(db, (c) => publishCampaign(c, orgId, campaignId, null));
  if (!res.versionId) throw new Error(`publish failed: ${res.errors.join('; ')}`);
  return { campaignId, versionId: res.versionId, agentId, numberId };
}
