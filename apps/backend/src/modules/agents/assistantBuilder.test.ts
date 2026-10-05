import { describe, expect, it } from 'vitest';
import { buildAssistant } from './assistantBuilder';
import { sampleSnapshot } from '../../../test/helpers/samples';


const lead = {
  id: 'l1',
  first_name: 'Ada',
  last_name: 'L',
  email: null,
  company: 'Analytical',
  phone_e164: '+12125550142',
  custom_fields: { plan_tier: 'gold' },
};
const config = { BACKEND_PUBLIC_URL: 'https://api.example.test', VAPI_WEBHOOK_SECRET: 'secret-secret-secret' };

describe('buildAssistant', () => {
  const a = buildAssistant({ snapshot: sampleSnapshot, lead, callId: 'c1', organizationId: 'o1', config });

  it('uses the Cartesia sonic-3 voice and agent name', () => {
    expect(a.voice).toMatchObject({ provider: 'cartesia', voiceId: 'v1', model: 'sonic-3' });
    expect(a.firstMessage).toBe('Hi Ada, this is Katie from Acme Co.');
  });

  it('sends GPT models to OpenAI and records every call', () => {
    expect(a.model).toMatchObject({ provider: 'openai', model: 'gpt-4o' });
    expect(a.artifactPlan).toEqual({ recordingEnabled: true, transcriptPlan: { enabled: true } });
  });

  it('sends Claude Haiku 4.5 to Anthropic under the Vapi model id', () => {
    const snapshot = { ...sampleSnapshot, agent: { ...sampleSnapshot.agent, model: 'claude-haiku-4-5-20251001' } };
    const b = buildAssistant({ snapshot, lead, callId: 'c1', organizationId: 'o1', config });
    expect(b.model).toMatchObject({ provider: 'anthropic', model: 'claude-haiku-4-5-20251001' });
    expect(b.voice.provider).toBe('cartesia');
  });

  it('renders prompt placeholders and strips unknown ones', () => {
    const prompt = a.model.messages[0]!.content;
    expect(prompt).toContain('Call Ada at Analytical about gold.');
    expect(prompt).not.toContain('{{');
  });

  it('includes end-call, DNC, transfer and knowledge base tools, all pointed at our server URL', () => {
    const types = a.model.tools.map((t) => (t.type === 'function' ? t.function.name : t.type));
    expect(types).toEqual(['endCall', 'mark_do_not_call', 'transferCall']);
    expect(a.model.toolIds).toEqual(['kb-tool']);
    expect(a.server).toEqual({ url: 'https://api.example.test/webhooks/vapi', secret: 'secret-secret-secret', timeoutSeconds: 20 });
    expect(a.metadata).toEqual({ callId: 'c1', organizationId: 'o1' });
  });

  it('adds no booking tools when no extension is provided', () => {
    const names = a.model.tools.flatMap((t) => (t.type === 'function' ? [t.function.name] : []));
    expect(names).not.toContain('book_appointment');
    expect(names).not.toContain('check_availability');
  });
});
