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
