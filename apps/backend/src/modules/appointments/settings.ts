import { AppointmentSettingsSchema, type AppointmentSettings, type CampaignSnapshot } from '@snyder/shared';
import type { DbClient } from '../../db/pool';
import type { PublishCheck, SnapshotContributor } from '../campaigns/service';

/** Reads the (defaulted) appointment settings frozen into a campaign version snapshot. */
export function appointmentSettingsOf(snapshot: CampaignSnapshot | Record<string, unknown>): AppointmentSettings {
  const raw = (snapshot as Record<string, unknown>).appointments;
  const parsed = AppointmentSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : AppointmentSettingsSchema.parse({});
}

/** Validates the campaign's "appointments" section on publish and freezes the defaulted settings. */
export const appointmentSnapshotContributor: SnapshotContributor = {
  key: 'appointments',
  async validate(db: DbClient, organizationId: string, draft: Record<string, unknown>): Promise<PublishCheck> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const parsed = AppointmentSettingsSchema.safeParse(draft.appointments ?? {});
    if (!parsed.success) {
      return { errors: parsed.error.issues.map((i) => `Appointments: ${i.path.join('.')}: ${i.message}`), warnings };
    }
    const s = parsed.data;
    if (!s.booking_enabled) return { errors, warnings };

    if (!s.appointment_type_id) errors.push('Appointments: choose an appointment type.');
    else {
      const t = await db.query('select is_active from appointment_types where id = $1 and organization_id = $2', [
        s.appointment_type_id,
        organizationId,
      ]);
      if (!t.rows[0]) errors.push('Appointments: the appointment type no longer exists.');
      else if (!t.rows[0].is_active) errors.push('Appointments: the appointment type is inactive.');
    }
    if (!s.host_assignment.host_ids.length) {
      errors.push('Appointments: add at least one host to the host pool.');
    } else {
      const pool = s.host_assignment.strategy === 'specific_host' ? s.host_assignment.host_ids.slice(0, 1) : s.host_assignment.host_ids;
      const { rows } = await db.query<{ n: number }>(
        `select count(distinct h.id)::int as n
           from appointment_hosts h join availability_rules r on r.host_id = h.id
          where h.organization_id = $1 and h.id = any($2::uuid[]) and h.is_active`,
        [organizationId, pool],
      );
      if (!rows[0]?.n) {
        warnings.push('Booking is enabled but no active host in the pool has weekly availability, so the AI will have no slots to offer.');
      }
    }
    return { errors, warnings };
  },
  normalize(draft) {
    return { appointments: AppointmentSettingsSchema.parse(draft.appointments ?? {}) };
  },
};

export type { AppointmentSettings };
