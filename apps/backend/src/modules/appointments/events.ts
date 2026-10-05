import type { DbClient } from '../../db/pool';

export type AppointmentEventType =
  | 'booked'
  | 'confirmed'
  | 'rescheduled'
  | 'cancelled'
  | 'completed'
  | 'no_show'
  | 'email_sent'
  | 'email_failed'
  | 'hold_released'
  | 'needs_review'
  | 'notification_skipped';

export async function recordAppointmentEvent(
  db: DbClient,
  e: {
    organizationId: string;
    appointmentId: string;
    type: AppointmentEventType;
    actorType: 'system' | 'ai' | 'user' | 'prospect';
    actorId?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  await db.query(
    `insert into appointment_events(organization_id, appointment_id, type, actor_type, actor_id, metadata)
     values ($1, $2, $3, $4, $5, $6)`,
    [e.organizationId, e.appointmentId, e.type, e.actorType, e.actorId ?? null, e.metadata ?? {}],
  );
}
