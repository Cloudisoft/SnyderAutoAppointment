import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { numberToWords, ordinalWords, yearWords } from '../../../lib/words';
import { spokenEmail, spokenSlotLabel, spokenTime, spokenTimeZone } from './spoken';

const now = new Date('2026-10-05T12:00:00Z');

describe('spoken labels for Cartesia', () => {
  it('writes the example exactly', () => {
    expect(spokenSlotLabel(new Date('2026-10-13T15:00:00Z'), 'America/New_York', now)).toBe(
      'Tuesday, October thirteenth at eleven a.m. Eastern',
    );
  });

  it('spells out minutes, noon and midnight', () => {
    const t = (iso: string) => spokenTime(DateTime.fromISO(iso, { zone: 'UTC' }));
    expect(t('2026-10-13T14:30:00')).toBe('two thirty p.m.');
    expect(t('2026-10-13T09:05:00')).toBe('nine oh five a.m.');
    expect(t('2026-10-13T12:00:00')).toBe('twelve noon');
    expect(t('2026-10-13T00:00:00')).toBe('twelve midnight');
    expect(t('2026-10-13T12:45:00')).toBe('twelve forty-five p.m.');
  });

  it('adds the year in words only when it is not this year', () => {
    expect(spokenSlotLabel(new Date('2027-01-04T15:00:00Z'), 'America/Chicago', now)).toBe(
      'Monday, January fourth, twenty twenty-seven at nine a.m. Central',
    );
  });

  it('never contains digits, slashes, colons or raw IANA ids', () => {
    const zones = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles',
      'America/Anchorage', 'Pacific/Honolulu', 'America/Halifax', 'America/St_Johns', 'Europe/London', 'Europe/Paris',
      'Asia/Kolkata', 'Asia/Tokyo', 'Australia/Sydney', 'UTC', 'America/Indiana/Indianapolis', 'Africa/Casablanca'];
    for (const zone of zones) {
      for (let h = 0; h < 48; h += 7) {
        const label = spokenSlotLabel(new Date(Date.UTC(2026, 9, 13, h % 24, (h * 13) % 60)), zone, now);
        expect(label, `${zone}: ${label}`).not.toMatch(/[0-9/:_]/);
        expect(label).not.toContain(zone);
        expect(label).not.toMatch(/\b(GMT|UTC|EST|EDT|PST|PDT)\b/);
      }
    }
  });

  it('names common zones naturally', () => {
    expect(spokenTimeZone('America/Los_Angeles')).toBe('Pacific');
    expect(spokenTimeZone('America/Denver')).toBe('Mountain');
    expect(spokenTimeZone('America/Phoenix')).toBe('Arizona time');
    expect(spokenTimeZone('Europe/Paris')).toMatch(/^Central European time$/);
    expect(spokenTimeZone('Asia/Kolkata')).toMatch(/time$/);
  });

  it('spells email addresses in clear chunks', () => {
    expect(spokenEmail('john@gmail.com')).toBe('j, o, h, n, at gmail dot com');
    expect(spokenEmail('Ann.Lee7@acme.io')).toBe('a, n, n, dot, l, e, e, seven, at a, c, m, e dot i o');
    expect(spokenEmail('a_b+x@outlook.co.uk')).toBe('a, underscore, b, plus, x, at outlook dot co dot u k');
  });

  it('number words', () => {
    expect(numberToWords(42)).toBe('forty-two');
    expect(ordinalWords(13)).toBe('thirteenth');
    expect(ordinalWords(22)).toBe('twenty-second');
    expect(ordinalWords(30)).toBe('thirtieth');
    expect(ordinalWords(31)).toBe('thirty-first');
    expect(yearWords(2026)).toBe('twenty twenty-six');
    expect(yearWords(2005)).toBe('two thousand five');
  });
});
