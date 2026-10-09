import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';

/** Normalizes a phone number to E.164, or returns null when it isn't a valid number. */
export function toE164(input: string, defaultCountry: CountryCode = 'US'): string | null {
  const parsed = parsePhoneNumberFromString(String(input).trim(), defaultCountry);
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number;
}

export function digitsOnly(input: string): string {
  return input.replace(/\D/g, '');
}

/**
 * Forgiving parse for spreadsheet imports: strips a leading apostrophe, a trailing ".0",
 * extensions, and expands numbers Excel wrote in scientific notation (2.125550142E+09).
 * Accepts numbers that are possible for their country even if not yet in the validity tables.
 */
export function toE164Lenient(input: string, defaultCountry: CountryCode = 'US'): string | null {
  let s = String(input ?? '').trim().replace(/^'+/, '');
  if (!s) return null;
  if (/^\d+(\.\d+)?e\+?\d+$/i.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n) && Number.isInteger(n)) s = n.toFixed(0);
  }
  s = s.replace(/^(\d+)\.0+$/, '$1');
  const strict = toE164(s, defaultCountry);
  if (strict) return strict;
  const parsed = parsePhoneNumberFromString(s, defaultCountry);
  if (parsed?.isPossible()) return parsed.number;
  // Digits with a country code but no "+" (e.g. 447911123456).
  const digits = digitsOnly(s);
  if (digits.length > 10 && !s.startsWith('+')) {
    const intl = parsePhoneNumberFromString(`+${digits}`);
    if (intl?.isValid()) return intl.number;
  }
  return null;
}
