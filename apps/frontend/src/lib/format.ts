import { DateTime } from 'luxon';

export function formatDateTime(iso: string | null | undefined, zone?: string) {
  if (!iso) return '—';
  return DateTime.fromISO(iso, { zone: zone ?? 'local' }).toFormat('ccc, LLL d yyyy, h:mm a ZZZZ');
}

export function formatDate(iso: string | null | undefined, zone?: string) {
  if (!iso) return '—';
  return DateTime.fromISO(iso, { zone: zone ?? 'local' }).toFormat('LLL d, yyyy');
}

export function formatTime(iso: string, zone?: string) {
  return DateTime.fromISO(iso, { zone: zone ?? 'local' }).toFormat('h:mm a');
}

export function formatRelative(iso: string) {
  return DateTime.fromISO(iso).toRelative() ?? iso;
}

export function formatDuration(seconds: number | null | undefined) {
  if (seconds == null) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function titleCase(s: string) {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Readable call end reason without vendor names, e.g. "customer-ended-call" -> "Customer ended call". */
export function formatEndedReason(reason: string | null | undefined): string {
  if (!reason) return '—';
  const text = reason.replace(/vapi/gi, 'platform').replace(/cartesia/gi, 'voice').replace(/[.\-_]+/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}
