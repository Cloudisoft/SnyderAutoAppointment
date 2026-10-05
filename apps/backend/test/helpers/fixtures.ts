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

/** Inserts a dialed call (with its campaign lead) as the dialer would. */
export async function createCall(
  db: Db,
  orgId: string,
  c: { campaignId: string; versionId: string; leadId: string; vapiCallId?: string; bookingTools?: boolean; createdAt?: string },
) {
  const { rows: cl } = await db.query<{ id: string }>(
    `insert into campaign_leads(organization_id, campaign_id, lead_id, state, attempts) values ($1, $2, $3, 'dialing', 1)
     on conflict (campaign_id, lead_id) do update set state = 'dialing', attempts = campaign_leads.attempts + 1 returning id`,
    [orgId, c.campaignId, c.leadId],
  );
  const { rows } = await db.query<{ id: string; vapi_call_id: string }>(
    `insert into calls(organization_id, campaign_id, campaign_version_id, campaign_lead_id, lead_id, vapi_call_id, to_number,
                       status, started_at, booking_tools_enabled, created_at)
     values ($1, $2, $3, $4, $5, $6, '+12125550142', 'in_progress', now(), $7, coalesce($8::timestamptz, now()))
     returning id, vapi_call_id`,
    [orgId, c.campaignId, c.versionId, cl[0]!.id, c.leadId, c.vapiCallId ?? `vapi_${uniq()}`, c.bookingTools ?? false, c.createdAt ?? null],
  );
  return { callId: rows[0]!.id, vapiCallId: rows[0]!.vapi_call_id, campaignLeadId: cl[0]!.id };
}

export function endOfCallReport(vapiCallId: string, over: Record<string, unknown> = {}) {
  return {
    message: {
      type: 'end-of-call-report',
      endedReason: 'customer-ended-call',
      call: { id: vapiCallId },
      startedAt: '2026-10-12T14:00:00Z',
      endedAt: '2026-10-12T14:04:00Z',
      artifact: { transcript: 'AI: Hi there\nUser: Sure, sounds good.', recordingUrl: 'https://rec.example/1.wav' },
      analysis: { summary: 'Prospect interested.' },
      ...over,
    },
  };
}

export async function createAppointmentType(
  db: Db,
  orgId: string,
  t: Partial<{ duration: number; before: number; after: number; location_type: string; location_details: string; name: string }> = {},
) {
  const { rows } = await db.query<{ id: string }>(
    `insert into appointment_types(organization_id, name, duration_minutes, buffer_before_minutes, buffer_after_minutes, location_type, location_details)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [orgId, t.name ?? 'Intro call', t.duration ?? 30, t.before ?? 0, t.after ?? 0, t.location_type ?? 'video', t.location_details ?? 'https://meet.example.com/acme'],
  );
  return rows[0]!.id;
}

/** Host with weekly hours (ISO weekdays) in their time zone. Default Mon–Fri 09:00–17:00 New York. */
export async function createHost(
  db: Db,
  orgId: string,
  h: Partial<{ name: string; email: string; timeZone: string; days: number[]; start: string; end: string }> = {},
) {
  const { rows } = await db.query<{ id: string }>(
    `insert into appointment_hosts(organization_id, display_name, email, time_zone) values ($1, $2, $3, $4) returning id`,
    [orgId, h.name ?? 'Jordan Rivera', h.email ?? 'jordan@acme.test', h.timeZone ?? 'America/New_York'],
  );
  const hostId = rows[0]!.id;
  for (const d of h.days ?? [1, 2, 3, 4, 5]) {
    await db.query(
      `insert into availability_rules(organization_id, host_id, weekday, start_time, end_time) values ($1, $2, $3, $4, $5)`,
      [orgId, hostId, d, h.start ?? '09:00', h.end ?? '17:00'],
    );
  }
  return hostId;
}

export async function insertAppointment(
  db: Db,
  orgId: string,
  a: { typeId: string; hostId: string; startsAt: string; endsAt: string; status?: string; before?: number; after?: number; callId?: string; leadId?: string; campaignId?: string },
) {
  const { rows } = await db.query<{ id: string }>(
    `insert into appointments(organization_id, appointment_type_id, host_id, starts_at, ends_at, lead_time_zone, status, source,
                              buffer_before_minutes, buffer_after_minutes, call_id, lead_id, campaign_id)
     values ($1, $2, $3, $4, $5, 'America/New_York', $6, 'manual', $7, $8, $9, $10, $11) returning id`,
    [orgId, a.typeId, a.hostId, a.startsAt, a.endsAt, a.status ?? 'confirmed', a.before ?? 0, a.after ?? 0, a.callId ?? null, a.leadId ?? null, a.campaignId ?? null],
  );
  return rows[0]!.id;
}

/** Published campaign with booking enabled, one appointment type and one host (Mon–Fri 9–5 New York). */
export async function createBookingCampaign(db: Db, orgId: string, settings: Record<string, unknown> = {}, typeOpts: Parameters<typeof createAppointmentType>[2] = {}) {
  const typeId = await createAppointmentType(db, orgId, typeOpts);
  const hostId = await createHost(db, orgId);
  const c = await createPublishedCampaign(db, orgId, {
    appointments: {
      booking_enabled: true,
      appointment_type_id: typeId,
      host_assignment: { strategy: 'round_robin', host_ids: [hostId] },
      ...settings,
    },
  });
  return { ...c, typeId, hostId };
}

export function toolCallPayload(vapiCallId: string, name: string, args: Record<string, unknown>, id = `tc_${uniq()}`) {
  return { message: { type: 'tool-calls', call: { id: vapiCallId }, toolCallList: [{ id, type: 'function', function: { name, arguments: args } }] } };
}
