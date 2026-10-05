import type { CallingWindow } from '@snyder/shared';
import { DateTime } from 'luxon';

/** True when `now` falls inside the calling window in the given (lead) time zone. */
export function inCallingWindow(now: Date, timeZone: string, w: CallingWindow): boolean {
  const local = DateTime.fromJSDate(now, { zone: timeZone });
  if (!local.isValid || !w.days.includes(local.weekday)) return false;
  const hhmm = local.toFormat('HH:mm');
  return hhmm >= w.start && hhmm < w.end;
}
