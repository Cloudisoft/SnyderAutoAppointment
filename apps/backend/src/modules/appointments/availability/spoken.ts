import { DateTime } from 'luxon';
import { numberToWords, ordinalWords, yearWords } from '../../../lib/words';

/**
 * Text the AI speaks through Cartesia. Dates, times and time zones are written out in words:
 * "Tuesday, October thirteenth at eleven a.m. Eastern". Never digits, slashes or IANA ids.
 */

const NAMED_ZONES: [RegExp, string][] = [
  [/^America\/(New_York|Detroit|Toronto|Montreal|Nassau|Iqaluit|Indiana\/(Indianapolis|Vincennes|Winamac|Marengo|Petersburg|Vevay)|Kentucky\/.+|Indianapolis|Louisville)$/, 'Eastern'],
  [/^(US\/Eastern|EST5EDT)$/, 'Eastern'],
  [/^America\/(Chicago|Winnipeg|Regina|Swift_Current|Menominee|Indiana\/(Knox|Tell_City)|North_Dakota\/.+|Rainy_River|Rankin_Inlet|Resolute|Matamoros)$/, 'Central'],
  [/^(US\/Central|CST6CDT)$/, 'Central'],
  [/^America\/(Denver|Boise|Edmonton|Yellowknife|Cambridge_Bay|Inuvik|Ojinaga|Ciudad_Juarez)$/, 'Mountain'],
  [/^(US\/Mountain|MST7MDT)$/, 'Mountain'],
  [/^America\/Phoenix$|^US\/Arizona$|^MST$/, 'Arizona time'],
  [/^America\/(Los_Angeles|Vancouver|Tijuana)$|^US\/Pacific$|^PST8PDT$/, 'Pacific'],
  [/^America\/(Anchorage|Juneau|Sitka|Nome|Yakutat|Metlakatla)$|^US\/Alaska$/, 'Alaska time'],
  [/^Pacific\/Honolulu$|^US\/Hawaii$/, 'Hawaii time'],
  [/^America\/(Halifax|Moncton|Glace_Bay|Goose_Bay|Puerto_Rico)$|^Atlantic\/Bermuda$/, 'Atlantic'],
  [/^America\/St_Johns$/, 'Newfoundland time'],
  [/^Europe\/London$/, 'London time'],
  [/^Europe\/Dublin$/, 'Irish time'],
  [/^(UTC|Etc\/UTC|Etc\/GMT|GMT)$/, 'universal time'],
];

export function spokenTimeZone(timeZone: string, at: Date = new Date()): string {
  for (const [re, name] of NAMED_ZONES) if (re.test(timeZone)) return name;
  const generic = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longGeneric' })
    .formatToParts(at)
    .find((p) => p.type === 'timeZoneName')?.value;
  if (generic && !/\d|GMT|UTC/.test(generic)) return generic.replace(/\s+Time$/i, '') + ' time';
  // Fall back to the city: "Asia/Tokyo" -> "Tokyo time".
  const city = timeZone.split('/').pop()!.replace(/_/g, ' ').replace(/[^A-Za-z ]/g, '');
  return `${city} time`;
}

export function spokenTime(local: DateTime): string {
  const { hour, minute } = local;
  if (minute === 0 && hour === 12) return 'twelve noon';
  if (minute === 0 && hour === 0) return 'twelve midnight';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const mins = minute === 0 ? '' : minute < 10 ? ` oh ${numberToWords(minute)}` : ` ${numberToWords(minute)}`;
  return `${numberToWords(h12)}${mins} ${hour < 12 ? 'a.m.' : 'p.m.'}`;
}

/** "Tuesday, October thirteenth" (+ year in words when not the current year). */
export function spokenDate(local: DateTime, now: Date = new Date()): string {
  const nowLocal = DateTime.fromJSDate(now, { zone: local.zone });
  const base = `${local.toFormat('cccc')}, ${local.toFormat('LLLL')} ${ordinalWords(local.day)}`;
  return local.year === nowLocal.year ? base : `${base}, ${yearWords(local.year)}`;
}

/** "Tuesday, October thirteenth at eleven a.m. Eastern" */
export function spokenSlotLabel(start: Date, timeZone: string, now: Date = new Date()): string {
  const local = DateTime.fromJSDate(start, { zone: timeZone });
  return `${spokenDate(local, now)} at ${spokenTime(local)} ${spokenTimeZone(timeZone, start)}`;
}

/** "Tuesday, October 13 at 11:00 AM EDT" — for screens and emails, not speech. */
export function displaySlotLabel(start: Date, timeZone: string): string {
  return DateTime.fromJSDate(start, { zone: timeZone }).toFormat("cccc, LLLL d 'at' h:mm a ZZZZ");
}

const SPOKEN_DOMAINS = new Set([
  'gmail', 'googlemail', 'yahoo', 'hotmail', 'outlook', 'icloud', 'aol', 'protonmail', 'proton', 'live', 'msn',
  'comcast', 'verizon', 'att', 'me', 'mac', 'mail', 'co', 'zoho', 'gmx', 'ymail', 'sbcglobal', 'bellsouth', 'cox', 'charter',
]);
const SPOKEN_TLDS: Record<string, string> = {
  com: 'com', net: 'net', org: 'org', edu: 'e d u', gov: 'gov', io: 'i o', co: 'co', us: 'u s', uk: 'u k',
  ca: 'c a', biz: 'biz', info: 'info', me: 'me', app: 'app', dev: 'dev', ai: 'a i',
};
const SYMBOLS: Record<string, string> = { '.': 'dot', '_': 'underscore', '-': 'dash', '+': 'plus' };
const DIGIT_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

function spellChars(s: string): string[] {
  return s.split('').map((ch) => {
    if (/[0-9]/.test(ch)) return DIGIT_WORDS[Number(ch)]!;
    if (SYMBOLS[ch]) return SYMBOLS[ch]!;
    return ch.toLowerCase();
  });
}

/** "john.doe7@gmail.com" -> "j, o, h, n, dot, d, o, e, seven, at gmail dot com" */
export function spokenEmail(email: string): string {
  const [local = '', domain = ''] = email.trim().split('@');
  const labels = domain.toLowerCase().split('.').filter(Boolean);
  const spokenDomain = labels
    .map((label, i) => {
      if (i === labels.length - 1 && SPOKEN_TLDS[label]) return SPOKEN_TLDS[label];
      if (SPOKEN_DOMAINS.has(label)) return label;
      return spellChars(label).join(', ');
    })
    .join(' dot ');
  return `${spellChars(local).join(', ')}, at ${spokenDomain}`;
}
