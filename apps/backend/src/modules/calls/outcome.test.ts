import { describe, expect, it } from 'vitest';
import { classifyOutcome } from './outcome';

const base = { startedAt: '2026-10-12T14:00:00Z', endedAt: '2026-10-12T14:03:00Z', durationSeconds: null, dncRequested: false };

describe('classifyOutcome', () => {
  it('treats customer/assistant hangups after answering as connected', () => {
    for (const r of ['customer-ended-call', 'assistant-ended-call', 'silence-timed-out', 'exceeded-max-duration']) {
      expect(classifyOutcome({ ...base, endedReason: r })).toMatchObject({ connected: true, durationSeconds: 180 });
    }
  });
  it('detects voicemail, no answer, busy and failures as not connected', () => {
    expect(classifyOutcome({ ...base, endedReason: 'voicemail' })).toMatchObject({ voicemail: true, connected: false });
    expect(classifyOutcome({ ...base, startedAt: null, endedReason: 'customer-did-not-answer' })).toMatchObject({ noAnswer: true, connected: false });
    expect(classifyOutcome({ ...base, endedReason: 'customer-busy' })).toMatchObject({ busy: true, connected: false });
    expect(classifyOutcome({ ...base, endedReason: 'twilio-failed-to-connect-call' })).toMatchObject({ failed: true, connected: false });
    expect(classifyOutcome({ ...base, endedReason: 'pipeline-error-openai-llm-failed' })).toMatchObject({ failed: true });
  });
  it('treats a call that never started as failed', () => {
    expect(classifyOutcome({ ...base, startedAt: null, endedAt: null, endedReason: null })).toMatchObject({ failed: true, connected: false });
  });
});
