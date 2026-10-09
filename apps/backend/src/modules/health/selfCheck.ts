import { DEFAULT_AGENT_MODEL, type CampaignSnapshot } from '@snyder/shared';
import type { Deps } from '../../deps';
import { UpstreamError } from '../../lib/http';
import { buildAssistant } from '../agents/assistantBuilder';
import { bookingPromptRules, bookingVapiTools } from '../appointments/tools/extension';

export interface CallConfigCheck {
  ok: boolean;
  message: string;
  checkedAt: string;
  model: string;
  voice: string;
}

let last: CallConfigCheck | null = null;
export const lastCallConfigCheck = () => last;

/**
 * Sends the platform's standard call setup (default AI model, a real voice on the sonic-3 model,
 * every tool incl. booking + transfer, recording, live listen/control, hang-up phrases) to the
 * calling service as a temporary assistant, then deletes it. Proves the live account accepts
 * exactly what calls will use. No call is placed.
 */
export async function runCallConfigSelfCheck(deps: Deps): Promise<CallConfigCheck> {
  const checkedAt = deps.clock.now().toISOString();
  let voiceId = '';
  let voiceName = 'Katie';
  try {
    const voices = await deps.cartesia.listVoices();
    const v = voices.find((x) => (x.language ?? 'en').startsWith('en')) ?? voices[0];
    if (!v) throw new Error('the voice library returned no voices');
    voiceId = v.id;
    voiceName = v.name.split(/[\s-]/)[0] || v.name;
  } catch (err) {
    last = { ok: false, message: `Voice service check failed: ${(err as Error).message}`, checkedAt, model: DEFAULT_AGENT_MODEL, voice: 'sonic-3' };
    return last;
  }
  const snapshot = {
    campaign_name: 'Config self-check',
    business_name: 'Self-check',
    time_zone: 'America/New_York',
    agent: {
      id: 'self-check',
      name: 'Self-check',
      system_prompt: 'You are a friendly assistant calling {{first_name}}.',
      first_message: 'Hi {{first_name}}, this is {{agent_name}}.',
      model: DEFAULT_AGENT_MODEL,
      temperature: 0.4,
      transfer_number: '+12125550100',
      end_call_message: null,
      knowledge_base_vapi_tool_id: null,
      voice: { voice_id: voiceId, name: voiceName, model: 'sonic-3', language: 'en' },
    },
  } as unknown as CampaignSnapshot;
  const assistant = buildAssistant({
    snapshot,
    lead: { id: 'self-check', first_name: 'Alex', last_name: null, email: null, company: null, phone_e164: '+12125550101', custom_fields: {} },
    callId: '00000000-0000-4000-8000-000000000000',
    organizationId: '00000000-0000-4000-8000-000000000000',
    config: deps.config,
    extensions: [
      {
        name: 'appointments',
        tools: bookingVapiTools(deps.config, true),
        promptSections: [bookingPromptRules({ requireEmail: true, emailOnFile: null, leadTimeZone: 'America/New_York', now: deps.clock.now() })],
      },
    ],
  });
  assistant.name = 'config-self-check';
  const summary = { model: `${assistant.model.provider} ${assistant.model.model}`, voice: `${assistant.voice.provider} ${assistant.voice.model} (${voiceName})` };
  try {
    const created = await deps.vapi.createAssistant(assistant);
    await deps.vapi.deleteAssistant(created.id).catch(() => undefined);
    last = {
      ok: true,
      message: `Accepted: ${summary.model}, ${summary.voice}, tools [${assistant.model.tools.map((t) => (t.type === 'function' ? t.function.name : t.type)).join(', ')}], recording, live listen/control, hang-up phrases`,
      checkedAt,
      ...summary,
    };
  } catch (err) {
    last = { ok: false, message: `Rejected: ${err instanceof UpstreamError ? `${err.status} ${err.body.slice(0, 600)}` : (err as Error).message}`, checkedAt, ...summary };
  }
  return last;
}
