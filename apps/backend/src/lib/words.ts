/** Number-to-words helpers for text that will be spoken by a TTS voice. */

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

export function numberToWords(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 999_999) throw new RangeError(`numberToWords: unsupported ${n}`);
  if (n < 20) return ONES[n]!;
  if (n < 100) return TENS[Math.floor(n / 10)]! + (n % 10 ? `-${ONES[n % 10]}` : '');
  if (n < 1000) return `${ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` ${numberToWords(n % 100)}` : ''}`;
  return `${numberToWords(Math.floor(n / 1000))} thousand${n % 1000 ? ` ${numberToWords(n % 1000)}` : ''}`;
}

const ORDINAL_IRREGULAR: Record<string, string> = {
  one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth', twelve: 'twelfth',
};

export function ordinalWords(n: number): string {
  const words = numberToWords(n);
  const parts = words.split(/([- ])/);
  const last = parts.pop()!;
  const ord = ORDINAL_IRREGULAR[last] ?? (last.endsWith('y') ? `${last.slice(0, -1)}ieth` : `${last}th`);
  return [...parts, ord].join('');
}

/** 2026 -> "twenty twenty-six", 2005 -> "two thousand five". */
export function yearWords(y: number): string {
  if (y >= 2000 && y < 2010) return numberToWords(y);
  const hi = Math.floor(y / 100);
  const lo = y % 100;
  return `${numberToWords(hi)} ${lo === 0 ? 'hundred' : lo < 10 ? `oh ${numberToWords(lo)}` : numberToWords(lo)}`;
}

/** Spoken digit-by-digit ("42" -> "four two"). */
export function digitsToWords(s: string): string {
  return s.split('').map((d) => ONES[Number(d)]).join(' ');
}
