import { describe, expect, it } from 'vitest';
import { parseAppointmentSettings, reminderType } from './appointments';

describe('appointment settings', () => {
  it('applies the documented defaults', () => {
    const s = parseAppointmentSettings({});
    expect(s).toMatchObject({
      booking_enabled: false,
      min_notice_minutes: 120,
      max_days_ahead: 14,
      slots_to_offer: 3,
      hold_minutes: 15,
      require_email: true,
      reminder_offsets_minutes: [1440, 60],
      requeue_on_cancel: false,
    });
  });
  it('names reminder types from offsets', () => {
    expect(reminderType(1440)).toBe('reminder_24h');
    expect(reminderType(60)).toBe('reminder_1h');
    expect(reminderType(45)).toBe('reminder_45m');
  });
});
