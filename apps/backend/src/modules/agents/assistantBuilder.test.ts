import { describe, expect, it } from 'vitest';
import { buildAssistant, GOODBYE_LINE, TRANSFER_ANNOUNCEMENT } from './assistantBuilder';
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

  it('enables live listen/control, hang-up phrases and explicit end-call and transfer rules', () => {
    expect(a.monitorPlan).toEqual({ listenEnabled: true, controlEnabled: true });
    expect(a.endCallPhrases).toContain('goodbye');
    const prompt = a.model.messages[0]!.content;
    expect(prompt).toContain('immediately call the endCall tool');
    expect(prompt).toContain('call the transferCall tool');
    const transfer = a.model.tools.find((t) => t.type === 'transferCall');
    expect(transfer).toMatchObject({ messages: [{ type: 'request-start', content: 'Sure, let me transfer your call.' }] });
  });

  it('without a transfer number, offers a callback instead of a transfer', () => {
    const snapshot = { ...sampleSnapshot, agent: { ...sampleSnapshot.agent, transfer_number: null } };
    const b = buildAssistant({ snapshot, lead, callId: 'c1', organizationId: 'o1', config });
    expect(b.model.tools.some((t) => t.type === 'transferCall')).toBe(false);
    expect(b.model.messages[0]!.content).toContain('offer to have someone call them back');
  });

  it('recognises transfer announcements and goodbyes, not ordinary sentences', () => {
    for (const s of ['Sure, let me transfer your call.', "I'm going to connect you now", 'I will transfer you to the team', 'Transferring your call now.']) {
      expect(TRANSFER_ANNOUNCEMENT.test(s), s).toBe(true);
    }
    for (const s of ['Would you like me to transfer you?', 'We can connect next week.']) expect(TRANSFER_ANNOUNCEMENT.test(s), s).toBe(false);
    for (const s of ['Thanks for your time, goodbye.', 'Have a great day!', 'Bye for now']) expect(GOODBYE_LINE.test(s), s).toBe(true);
    for (const s of ['Before we say goodbye, can I ask one thing?', 'Is today a great day for you?']) expect(GOODBYE_LINE.test(s), s).toBe(false);
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
