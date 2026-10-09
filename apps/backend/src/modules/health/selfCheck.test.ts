import { describe, expect, it } from 'vitest';
import { testDeps } from '../../../test/helpers/deps';
import { FakeVapi } from '../../../test/helpers/fakes';
import { lastCallConfigCheck, runCallConfigSelfCheck } from './selfCheck';

describe('call config self-check', () => {
  it('sends Claude Haiku 4.5 + sonic-3 with every tool, recording and live control, then deletes it', async () => {
    const vapi = new FakeVapi();
    const r = await runCallConfigSelfCheck(testDeps({ vapi, db: undefined as never }));
    expect(r.ok).toBe(true);
    const a = vapi.createdAssistants[0]!;
    expect(a.model).toMatchObject({ provider: 'anthropic', model: 'claude-haiku-4-5-20251001' });
    expect(a.voice).toMatchObject({ provider: 'cartesia', model: 'sonic-3', voiceId: 'cartesia-voice-1' });
    const tools = a.model.tools.map((t) => (t.type === 'function' ? t.function.name : t.type));
    expect(tools).toEqual(expect.arrayContaining(['endCall', 'transferCall', 'mark_do_not_call', 'check_availability', 'book_appointment']));
    expect(a.artifactPlan?.recordingEnabled).toBe(true);
    expect(a.monitorPlan).toEqual({ listenEnabled: true, controlEnabled: true });
    expect(vapi.deletedAssistants).toHaveLength(1);
    expect(lastCallConfigCheck()?.ok).toBe(true);
  });

  it('reports the exact rejection', async () => {
    const vapi = new FakeVapi();
    vapi.rejectAssistant = 'model.model must be one of the following values';
    const r = await runCallConfigSelfCheck(testDeps({ vapi, db: undefined as never }));
    expect(r.ok).toBe(false);
    expect(r.message).toContain('model.model must be one of');
  });
});
