/** Disposition engine: rules sorted by priority, first match wins. Pure. */

export interface DispositionConditions {
  connected?: boolean;
  voicemail?: boolean;
  no_answer?: boolean;
  busy?: boolean;
  failed?: boolean;
  dnc_requested?: boolean;
  transferred?: boolean;
  appointment_booked?: boolean;
  ended_reasons?: string[];
  min_duration_seconds?: number;
  max_duration_seconds?: number;
}

export interface DispositionRule {
  key: string;
  label: string;
  priority: number;
  conditions: DispositionConditions;
  lead_status: string | null;
  retry: boolean;
  is_active?: boolean;
}

export interface DispositionFacts {
  connected: boolean;
  voicemail: boolean;
  noAnswer: boolean;
  busy: boolean;
  failed: boolean;
  dncRequested: boolean;
  transferred: boolean;
  appointmentBooked: boolean;
  endedReason: string | null;
  durationSeconds: number;
}

const BOOL_FACTS: [keyof DispositionConditions, keyof DispositionFacts][] = [
  ['connected', 'connected'],
  ['voicemail', 'voicemail'],
  ['no_answer', 'noAnswer'],
  ['busy', 'busy'],
  ['failed', 'failed'],
  ['dnc_requested', 'dncRequested'],
  ['transferred', 'transferred'],
  ['appointment_booked', 'appointmentBooked'],
];

export function ruleMatches(rule: DispositionRule, facts: DispositionFacts): boolean {
  const c = rule.conditions ?? {};
  for (const [cond, fact] of BOOL_FACTS) {
    const want = c[cond];
    if (typeof want === 'boolean' && facts[fact] !== want) return false;
  }
  if (c.ended_reasons?.length && !c.ended_reasons.includes(facts.endedReason ?? '')) return false;
  if (typeof c.min_duration_seconds === 'number' && facts.durationSeconds < c.min_duration_seconds) return false;
  if (typeof c.max_duration_seconds === 'number' && facts.durationSeconds > c.max_duration_seconds) return false;
  return true;
}

export function pickDisposition(rules: DispositionRule[], facts: DispositionFacts): DispositionRule | null {
  const ordered = rules.filter((r) => r.is_active !== false).sort((a, b) => a.priority - b.priority);
  return ordered.find((r) => ruleMatches(r, facts)) ?? null;
}
