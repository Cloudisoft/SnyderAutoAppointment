export const LEAD_STATUSES = [
  'new',
  'queued',
  'in_progress',
  'contacted',
  'callback',
  'not_interested',
  'do_not_call',
  'bad_number',
  'completed',
  'appointment_booked',
  'appointment_cancelled',
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'New',
  queued: 'Queued',
  in_progress: 'In progress',
  contacted: 'Contacted',
  callback: 'Callback',
  not_interested: 'Not interested',
  do_not_call: 'Do not call',
  bad_number: 'Bad number',
  completed: 'Completed',
  appointment_booked: 'Appointment booked',
  appointment_cancelled: 'Appointment cancelled',
};

/** Statuses that take a lead out of dialing entirely. */
export const TERMINAL_LEAD_STATUSES: LeadStatus[] = [
  'do_not_call',
  'bad_number',
  'not_interested',
  'completed',
  'appointment_booked',
];

/** Digits only, for phone search ("(555) 123-4567" -> "5551234567"). */
export function phoneDigits(input: string): string {
  return input.replace(/\D/g, '');
}
