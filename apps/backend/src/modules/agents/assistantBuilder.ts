import { providerForModel, type CampaignSnapshot } from '@snyder/shared';
import type { Config } from '../../config';
import type { VapiAssistant, VapiFunctionTool, VapiTool } from '../../integrations/vapi';
import { leadVars, renderTemplate, type TemplateVars } from '../../lib/templates';

export interface AssistantLead {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  company: string | null;
  phone_e164: string;
  custom_fields: Record<string, unknown>;
}

/** Feature modules (e.g. appointment booking) contribute tools and prompt rules per call. */
export interface AssistantExtension {
  name: string;
  tools: VapiTool[];
  promptSections: string[];
  /** Optional extensions are dropped (and the call re-sent) if Vapi rejects the assistant config. */
  optional?: boolean;
}

export interface BuildAssistantInput {
  snapshot: CampaignSnapshot;
  lead: AssistantLead;
  callId: string;
  organizationId: string;
  config: Pick<Config, 'BACKEND_PUBLIC_URL' | 'VAPI_WEBHOOK_SECRET'>;
  extensions?: AssistantExtension[];
}

export const VAPI_WEBHOOK_PATH = '/webhooks/vapi';

export function serverUrl(config: Pick<Config, 'BACKEND_PUBLIC_URL'>) {
  return `${config.BACKEND_PUBLIC_URL.replace(/\/$/, '')}${VAPI_WEBHOOK_PATH}`;
}

/** Function tool executed by our backend, authenticated with VAPI_WEBHOOK_SECRET. */
export function serverFunctionTool(
  config: Pick<Config, 'BACKEND_PUBLIC_URL' | 'VAPI_WEBHOOK_SECRET'>,
  def: VapiFunctionTool['function'],
  extra: Partial<Pick<VapiFunctionTool, 'messages'>> & { timeoutSeconds?: number } = {},
): VapiFunctionTool {
  return {
    type: 'function',
    async: false,
    function: def,
    server: { url: serverUrl(config), secret: config.VAPI_WEBHOOK_SECRET, timeoutSeconds: extra.timeoutSeconds ?? 20 },
    ...(extra.messages ? { messages: extra.messages } : {}),
  };
}

export function promptVars(snapshot: CampaignSnapshot, lead: AssistantLead): TemplateVars {
  return {
    ...leadVars(lead),
    agent_name: snapshot.agent.voice.name,
    campaign_name: snapshot.campaign_name,
    business_name: snapshot.business_name || snapshot.campaign_name,
  };
}

const BASE_RULES = [
  'Speak naturally and keep each turn short; this is a phone call.',
  'If the person asks not to be called again, apologise, call mark_do_not_call, confirm they will not be contacted again, then end the call.',
  'If you reach voicemail or an automated system, end the call without leaving a message.',
  'Never read out URLs, symbols or codes; describe them in plain words instead.',
];

/** Builds the transient Vapi assistant for one outbound call. */
export function buildAssistant(input: BuildAssistantInput): VapiAssistant {
  const { snapshot, lead, config } = input;
  const agent = snapshot.agent;
  const vars = promptVars(snapshot, lead);
  const extensions = input.extensions ?? [];

  const tools: VapiTool[] = [
    { type: 'endCall' },
    serverFunctionTool(config, {
      name: 'mark_do_not_call',
      description: 'Record that the person asked not to be called again. Call this before ending the call.',
      parameters: { type: 'object', properties: { reason: { type: 'string', description: 'What they said' } } },
    }),
  ];
  if (agent.transfer_number) {
    tools.push({
      type: 'transferCall',
      destinations: [{ type: 'number', number: agent.transfer_number, message: 'One moment while I connect you.' }],
    });
  }
  for (const ext of extensions) tools.push(...ext.tools);

  const sections = [
    renderTemplate(agent.system_prompt, vars).trim(),
    `# Call rules\n${BASE_RULES.map((r) => `- ${r}`).join('\n')}`,
    ...extensions.flatMap((e) => e.promptSections),
  ].filter(Boolean);

  return {
    name: `${snapshot.campaign_name}`.slice(0, 40),
    firstMessage: renderTemplate(agent.first_message, vars) || undefined,
    firstMessageMode: 'assistant-speaks-first',
    model: {
      provider: providerForModel(agent.model),
      model: agent.model,
      temperature: agent.temperature,
      messages: [{ role: 'system', content: sections.join('\n\n') }],
      tools,
      ...(agent.knowledge_base_vapi_tool_id ? { toolIds: [agent.knowledge_base_vapi_tool_id] } : {}),
    },
    voice: { provider: 'cartesia', voiceId: agent.voice.voice_id, model: agent.voice.model, language: agent.voice.language },
    transcriber: { provider: 'deepgram', model: 'nova-3', language: agent.voice.language },
    server: { url: serverUrl(config), secret: config.VAPI_WEBHOOK_SECRET, timeoutSeconds: 20 },
    serverMessages: ['status-update', 'end-of-call-report', 'transcript', 'tool-calls', 'transfer-update', 'hang'],
    voicemailDetection: { provider: 'vapi' },
    ...(agent.end_call_message ? { endCallMessage: renderTemplate(agent.end_call_message, vars) } : {}),
    maxDurationSeconds: 900,
    analysisPlan: { summaryPlan: { enabled: true } },
    artifactPlan: { recordingEnabled: true, transcriptPlan: { enabled: true } },
    metadata: { callId: input.callId, organizationId: input.organizationId },
  };
}
