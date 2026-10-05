/** Classifies how a call ended from Vapi's endedReason and timing. Pure. */

export interface CallOutcome {
  connected: boolean;
  voicemail: boolean;
  noAnswer: boolean;
  busy: boolean;
  failed: boolean;
  dncRequested: boolean;
  transferred: boolean;
  endedReason: string | null;
  durationSeconds: number;
}

const NO_ANSWER = new Set([
  'customer-did-not-answer',
  'customer-did-not-give-microphone-permission',
  'no-answer',
  'twilio-reported-customer-misdialed',
  'vonage-rejected',
]);
const BUSY = new Set(['customer-busy']);
const VOICEMAIL = new Set(['voicemail', 'machine-detected']);
const TRANSFERRED = new Set(['assistant-forwarded-call', 'call.in-progress.transferred']);

function isFailure(reason: string): boolean {
  return (
    /(^|[-.])(error|failed|fault)([-.]|$)/.test(reason) ||
    reason.startsWith('pipeline-') ||
    reason.startsWith('call.start.') ||
    reason === 'twilio-failed-to-connect-call' ||
    reason === 'assistant-not-found' ||
    reason === 'db-error'
  );
}

export function classifyOutcome(input: {
  endedReason: string | null;
  startedAt: string | Date | null;
  endedAt: string | Date | null;
  durationSeconds: number | null;
  dncRequested: boolean;
}): CallOutcome {
  const reason = input.endedReason ?? '';
  const duration =
    input.durationSeconds ??
    (input.startedAt && input.endedAt
      ? Math.max(0, Math.round((new Date(input.endedAt).getTime() - new Date(input.startedAt).getTime()) / 1000))
      : 0);
  const voicemail = VOICEMAIL.has(reason);
  const noAnswer = NO_ANSWER.has(reason);
  const busy = BUSY.has(reason);
  const failed = !voicemail && !noAnswer && !busy && (isFailure(reason) || (!input.startedAt && duration === 0));
  const connected = !voicemail && !noAnswer && !busy && !failed;
  return {
    connected,
    voicemail,
    noAnswer,
    busy,
    failed,
    dncRequested: input.dncRequested,
    transferred: TRANSFERRED.has(reason),
    endedReason: input.endedReason,
    durationSeconds: duration,
  };
}
