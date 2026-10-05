import { describe, expect, it } from 'vitest';
import { pickDisposition, type DispositionFacts, type DispositionRule } from './engine';

// Mirrors the seeded defaults (0006) plus "Appointment booked" (0009).
export const DEFAULT_RULES: DispositionRule[] = [
  { key: 'do_not_call', label: 'Do not call', priority: 10, conditions: { dnc_requested: true }, lead_status: 'do_not_call', retry: false },
  { key: 'voicemail', label: 'Voicemail', priority: 20, conditions: { voicemail: true }, lead_status: null, retry: true },
  { key: 'appointment_booked', label: 'Appointment booked', priority: 30, conditions: { appointment_booked: true }, lead_status: 'appointment_booked', retry: false },
  { key: 'transferred', label: 'Transferred', priority: 40, conditions: { transferred: true }, lead_status: 'contacted', retry: false },
  { key: 'call_connected', label: 'Call connected', priority: 50, conditions: { connected: true }, lead_status: 'contacted', retry: false },
  { key: 'no_answer', label: 'No answer', priority: 60, conditions: { no_answer: true }, lead_status: null, retry: true },
  { key: 'other', label: 'Other', priority: 1000, conditions: {}, lead_status: null, retry: true },
];

const facts = (f: Partial<DispositionFacts>): DispositionFacts => ({
  connected: false,
  voicemail: false,
  noAnswer: false,
  busy: false,
  failed: false,
  dncRequested: false,
  transferred: false,
  appointmentBooked: false,
  endedReason: null,
  durationSeconds: 0,
  ...f,
});

describe('disposition engine (first match wins)', () => {
  it('Appointment booked beats Call connected', () => {
    expect(pickDisposition(DEFAULT_RULES, facts({ connected: true, appointmentBooked: true }))?.key).toBe('appointment_booked');
  });
  it('DNC still wins over an appointment', () => {
    expect(pickDisposition(DEFAULT_RULES, facts({ connected: true, appointmentBooked: true, dncRequested: true }))?.key).toBe('do_not_call');
  });
  it('voicemail still wins over an appointment', () => {
    expect(pickDisposition(DEFAULT_RULES, facts({ voicemail: true, appointmentBooked: true }))?.key).toBe('voicemail');
  });
  it('connected without appointment is Call connected; nothing else falls through to Other', () => {
    expect(pickDisposition(DEFAULT_RULES, facts({ connected: true }))?.key).toBe('call_connected');
    expect(pickDisposition(DEFAULT_RULES, facts({}))?.key).toBe('other');
  });
  it('respects order regardless of input order and skips inactive rules', () => {
    const shuffled = [...DEFAULT_RULES].reverse().map((r) => (r.key === 'appointment_booked' ? { ...r, is_active: false } : r));
    expect(pickDisposition(shuffled, facts({ connected: true, appointmentBooked: true }))?.key).toBe('call_connected');
  });
  it('supports ended reason and duration conditions', () => {
    const rules: DispositionRule[] = [
      { key: 'short', label: 'Short', priority: 1, conditions: { connected: true, max_duration_seconds: 10 }, lead_status: null, retry: true },
      ...DEFAULT_RULES,
    ];
    expect(pickDisposition(rules, facts({ connected: true, durationSeconds: 5 }))?.key).toBe('short');
    expect(pickDisposition(rules, facts({ connected: true, durationSeconds: 50 }))?.key).toBe('call_connected');
  });
});
