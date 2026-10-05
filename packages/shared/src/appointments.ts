import { z } from 'zod';

export const APPOINTMENT_STATUSES = [
  'pending',
  'confirmed',
  'rescheduled',
  'cancelled',
  'completed',
  'no_show',
  'needs_review',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/** Statuses that hold a slot (enforced by the appointments_no_double_booking constraint). */
export const ACTIVE_APPOINTMENT_STATUSES: AppointmentStatus[] = ['pending', 'confirmed', 'rescheduled'];

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  rescheduled: 'Rescheduled',
  cancelled: 'Cancelled',
  completed: 'Completed',
  no_show: 'No-show',
  needs_review: 'Needs review',
};

export const LOCATION_TYPES = ['phone', 'video', 'in_person', 'custom'] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];

export const HOST_STRATEGIES = ['specific_host', 'round_robin', 'least_booked'] as const;
export type HostStrategy = (typeof HOST_STRATEGIES)[number];

export const DEFAULT_CONFIRMATION_SUBJECT = 'Confirmed: {{appointment_date}} at {{appointment_time}} with {{host_name}}';
export const DEFAULT_CONFIRMATION_BODY = `Hi {{first_name}},

Thanks for speaking with {{agent_name}} from {{business_name}}. Your appointment is confirmed for {{appointment_date}} at {{appointment_time}} ({{time_zone}}) with {{host_name}}.

Where: {{location}}

Need to change it? Use your personal link to reschedule or cancel: {{appointment_link}}

See you then,
{{business_name}}`;

/** Per-campaign appointment settings (campaign draft key "appointments", frozen into each version). */
export const AppointmentSettingsSchema = z.object({
  booking_enabled: z.boolean().default(false),
  appointment_type_id: z.string().uuid().nullable().default(null),
  host_assignment: z
    .object({
      strategy: z.enum(HOST_STRATEGIES).default('round_robin'),
      host_ids: z.array(z.string().uuid()).default([]),
    })
    .default({}),
  min_notice_minutes: z.number().int().min(0).max(43_200).default(120),
  max_days_ahead: z.number().int().min(1).max(90).default(14),
  slots_to_offer: z.number().int().min(1).max(6).default(3),
  hold_minutes: z.number().int().min(1).max(240).default(15),
  require_email: z.boolean().default(true),
  /** Minutes before the start time. Default 24h and 1h. */
  reminder_offsets_minutes: z.array(z.number().int().min(5).max(10_080)).max(5).default([1440, 60]),
  confirmation_email: z
    .object({
      subject: z.string().max(300).default(DEFAULT_CONFIRMATION_SUBJECT),
      body: z.string().max(20_000).default(DEFAULT_CONFIRMATION_BODY),
    })
    .default({}),
  requeue_on_cancel: z.boolean().default(false),
  /** Future Twilio SMS confirmations/reminders. Only effective when SMS_APPOINTMENTS_ENABLED=true. */
  sms_enabled: z.boolean().default(false),
});
export type AppointmentSettings = z.infer<typeof AppointmentSettingsSchema>;

export function parseAppointmentSettings(raw: unknown): AppointmentSettings {
  return AppointmentSettingsSchema.parse(raw ?? {});
}

/** Notification type for a reminder offset: 1440 -> reminder_24h, 60 -> reminder_1h, 45 -> reminder_45m. */
export function reminderType(offsetMinutes: number): string {
  return offsetMinutes % 60 === 0 ? `reminder_${offsetMinutes / 60}h` : `reminder_${offsetMinutes}m`;
}
