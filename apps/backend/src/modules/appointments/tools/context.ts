import type { AppointmentSettings, CampaignSnapshot } from '@snyder/shared';
import type { DbClient } from '../../../db/pool';
import { resolveLeadTimeZone } from '../../../lib/timezone';
import { loadVersionSnapshot } from '../../campaigns/service';
import type { CallRow } from '../../calls/types';
import { appointmentSettingsOf } from '../settings';

export interface BookingLead {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone_e164: string;
  time_zone: string | null;
}

export interface BookingContext {
  call: CallRow;
  snapshot: CampaignSnapshot;
  settings: AppointmentSettings;
  lead: BookingLead | null;
  leadTimeZone: string;
}

export async function loadBookingContext(db: DbClient, call: CallRow): Promise<BookingContext> {
  if (!call.campaign_version_id) throw new Error(`call ${call.id} has no campaign version`);
  const snapshot = await loadVersionSnapshot(db, call.campaign_version_id);
  const settings = appointmentSettingsOf(snapshot);
  const { rows } = call.lead_id
    ? await db.query<BookingLead>('select id, first_name, last_name, email, phone_e164, time_zone from leads where id = $1', [call.lead_id])
    : { rows: [] as BookingLead[] };
  const lead = rows[0] ?? null;
  const tz = resolveLeadTimeZone({ leadTimeZone: lead?.time_zone, phoneE164: lead?.phone_e164 ?? call.to_number, campaignTimeZone: snapshot.time_zone });
  return { call, snapshot, settings, lead, leadTimeZone: tz.timeZone };
}

export interface StoredOffer {
  hostId: string;
  startUtc: string;
  endUtc: string;
  spokenLabel: string;
}

/** Saves offered slots on the call and returns their short ids (slot_1, slot_2, ...). */
export async function storeOffers(db: DbClient, callId: string, offers: StoredOffer[]): Promise<string[]> {
  const { rows } = await db.query<{ seq: number }>(
    `update calls set analysis = jsonb_set(analysis, '{booking_offer_seq}', to_jsonb(coalesce((analysis->>'booking_offer_seq')::int, 0) + $2::int))
      where id = $1 returning coalesce((analysis->>'booking_offer_seq')::int, 0) as seq`,
    [callId, offers.length],
  );
  const end = rows[0]?.seq ?? offers.length;
  const ids = offers.map((_, i) => `slot_${end - offers.length + i + 1}`);
  const patch = Object.fromEntries(ids.map((id, i) => [id, offers[i]]));
  await db.query(
    `update calls set analysis = jsonb_set(analysis, '{booking_offers}', coalesce(analysis->'booking_offers', '{}'::jsonb) || $2::jsonb)
      where id = $1`,
    [callId, JSON.stringify(patch)],
  );
  return ids;
}

export async function findOffer(db: DbClient, callId: string, slotId: string): Promise<StoredOffer | null> {
  // Accept "slot_2", "slot 2", "Slot-2" or just "2".
  const n = slotId.match(/(\d+)/)?.[1];
  const normalized = n ? `slot_${Number(n)}` : slotId.trim().toLowerCase();
  const { rows } = await db.query<{ offer: StoredOffer | null }>(
    `select analysis->'booking_offers'->$2 as offer from calls where id = $1`,
    [callId, normalized],
  );
  return rows[0]?.offer ?? null;
}
