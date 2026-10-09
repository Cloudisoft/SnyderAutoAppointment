import { describe, expect, it } from 'vitest';
import { buildIcs, foldLine } from './ics';
import { DEFAULT_TEMPLATES, renderAppointmentEmail, type AppointmentEmailContext } from './render';

const ctx = (over: Partial<AppointmentEmailContext['appointment']> = {}): AppointmentEmailContext => ({
  appointment: {
    id: '11111111-2222-3333-4444-555555555555',
    organization_id: 'o',
    starts_at: new Date('2026-10-13T15:00:00Z'),
    ends_at: new Date('2026-10-13T15:30:00Z'),
    status: 'confirmed',
    version: 1,
    lead_time_zone: 'America/Chicago',
    attendee_name: 'Ada Lovelace',
    attendee_email: 'ada@example.com',
    notes: null,
    call_id: 'call-1',
    campaign_version_id: 'v',
    ...over,
  },
  type: { name: 'Intro call', duration_minutes: 30, location_type: 'video', location_details: 'https://meet.example.com/acme', description: null },
  host: { display_name: 'Jordan Rivera', email: 'jordan@acme.test', time_zone: 'America/New_York' },
  lead: { first_name: 'Ada', last_name: 'Lovelace', email: 'ada@example.com', phone_e164: '+12125550142', company: 'Analytical', custom_fields: { plan_tier: 'gold' } },
  organizationName: 'Acme Org',
  campaignName: 'Spring Outreach',
  businessName: 'Acme Co',
  agentName: 'Katie',
  settings: null,
  callSummary: 'Interested in the gold plan.',
  meeting: null,
});
const config = { APPOINTMENTS_PUBLIC_URL: 'https://book.example.test', APP_PUBLIC_URL: 'https://app.example.test', SMTP_FROM_EMAIL: 'hello@acme.test' };
const now = new Date('2026-10-12T14:00:00Z');
const link = 'https://book.example.test/a/tok_abcdefghijklmnopqrstuvwxyz';

describe('appointment emails', () => {
  it('fills placeholders in the prospect’s time zone and strips unknown ones', () => {
    const email = renderAppointmentEmail(ctx(), {
      kind: 'confirmation',
      template: { subject: 'Hi {{first_name}}: {{appointment_date}} {{bogus}}', body: 'Plan {{plan_tier}} with {{agent_name}} {{unknown_placeholder}}. Link: {{appointment_link}}' },
      link, config, now,
    });
    expect(email.subject).toBe('Hi Ada: Tuesday, October 13, 2026');
    expect(email.text).toContain('Plan gold with Katie. Link: ' + link);
    expect(email.text).toContain('When: Tuesday, October 13, 2026 at 10:00 AM (Central Time)');
    for (const body of [email.subject, email.text, email.html]) {
      expect(body).not.toMatch(/\{\{|\}\}|bogus|unknown_placeholder/);
    }
    expect(email.html).toContain(`href="${link}"`);
    expect(email.html).toContain('calendar.google.com');
    expect(email.html).toContain('outlook.live.com');
    expect(email.text).toContain('Add to Google Calendar: https://calendar.google.com');
  });

  it('default confirmation includes date, time, duration, host, location and the unique link', () => {
    const e = renderAppointmentEmail(ctx(), { kind: 'confirmation', template: DEFAULT_TEMPLATES.confirmation, link, config, now });
    expect(e.text).toContain('Thanks for speaking with Katie from Acme Co');
    expect(e.text).toContain('Duration: 30 minutes');
    expect(e.text).toContain('Host: Jordan Rivera');
    expect(e.text).toContain('Where: Video call: https://meet.example.com/acme');
    expect(e.text).toContain(link);
    expect(e.icalEvent?.method).toBe('REQUEST');
  });

  it('every email is branded with the Snyder Automation logo and the meeting link card', () => {
    const base = ctx();
    const withMeet = { ...base, type: { ...base.type, location_type: 'google_meet' }, meeting: { provider: 'google_meet', join_url: 'https://meet.google.com/abc-defg-hij' } };
    const e = renderAppointmentEmail(withMeet, { kind: 'confirmation', template: DEFAULT_TEMPLATES.confirmation, link: 'https://book.example.test/a/tok', config, now: new Date('2026-10-12T14:00:00Z') });
    expect(e.html).toContain('https://app.example.test/brand/logo-light.png');
    expect(e.html).toContain('Join Google Meet');
    expect(e.html).toContain('https://meet.google.com/abc-defg-hij');
    expect(e.html).toContain('#FE5E01');
  });

  it('host notice uses the host zone, lead details, summary and app links', () => {
    const e = renderAppointmentEmail(ctx(), { kind: 'host_notice', template: DEFAULT_TEMPLATES.host_notice, link: null, config, now });
    expect(e.subject).toBe('★ New booking: Ada Lovelace, Tuesday, October 13, 2026 at 11:00 AM');
    expect(e.text).toContain('Phone: +12125550142');
    expect(e.text).toContain('Call summary: Interested in the gold plan.');
    expect(e.text).toContain('https://app.example.test/calls?call=call-1');
  });

  it('.ics is valid with a stable UID, SEQUENCE from the version and METHOD:CANCEL on cancel', () => {
    const first = renderAppointmentEmail(ctx(), { kind: 'confirmation', template: DEFAULT_TEMPLATES.confirmation, link, config, now }).icalEvent!.content;
    const moved = renderAppointmentEmail(ctx({ version: 2, starts_at: new Date('2026-10-14T15:00:00Z'), ends_at: new Date('2026-10-14T15:30:00Z') }), {
      kind: 'reschedule', template: DEFAULT_TEMPLATES.reschedule, link, config, now,
    }).icalEvent!.content;
    const cancel = renderAppointmentEmail(ctx({ version: 3 }), { kind: 'cancellation', template: DEFAULT_TEMPLATES.cancellation, link: null, config, now }).icalEvent!.content;

    const uid = (s: string) => s.match(/^UID:(.+)$/m)![1];
    expect(uid(first)).toBe('appointment-11111111-2222-3333-4444-555555555555@book.example.test');
    expect(uid(moved)).toBe(uid(first));
    expect(uid(cancel)).toBe(uid(first));
    expect(first).toMatch(/^SEQUENCE:1\r$/m);
    expect(moved).toMatch(/^SEQUENCE:2\r$/m);
    expect(moved).toMatch(/^DTSTART:20261014T150000Z\r$/m);
    expect(cancel).toMatch(/^METHOD:CANCEL\r$/m);
    expect(cancel).toMatch(/^STATUS:CANCELLED\r$/m);
    for (const ics of [first, moved, cancel]) {
      expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
      expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
      expect(ics).not.toMatch(/[^\r]\n/); // CRLF only
      for (const line of ics.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
      expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    }
  });

  it('escapes and folds long text per RFC 5545', () => {
    const ics = buildIcs({
      uid: 'u@x', sequence: 0, method: 'REQUEST', start: now, end: now, stamp: now,
      summary: 'A, B; C\\D', description: 'line1\nline2 ' + 'é'.repeat(80), location: 'Room 1',
      organizer: { name: 'Acme', email: 'a@x' },
    });
    expect(ics).toContain('SUMMARY:A\\, B\\; C\\\\D');
    expect(ics).toContain('DESCRIPTION:line1\\nline2');
    const unfolded = ics.replace(/\r\n /g, '');
    expect(unfolded).toContain('é'.repeat(80));
    expect(foldLine('x'.repeat(200)).split('\r\n ').every((p) => Buffer.byteLength(p) <= 75)).toBe(true);
  });
});
