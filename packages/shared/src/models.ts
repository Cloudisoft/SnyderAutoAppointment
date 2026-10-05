/**
 * Conversation models offered for voice agents. Ids are exactly as Vapi's API names them
 * (Vapi requires the dated id for Claude Haiku 4.5).
 */
export type LlmProvider = 'anthropic' | 'openai';

export interface AgentModelOption {
  id: string;
  label: string;
  provider: LlmProvider;
  hint: string;
}

export const DEFAULT_AGENT_MODEL = 'claude-haiku-4-5-20251001';

export const AGENT_MODELS: AgentModelOption[] = [
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', provider: 'anthropic', hint: 'Fastest replies, recommended for calls' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'anthropic', hint: 'Stronger reasoning, a little slower' },
  { id: 'gpt-4o', label: 'GPT-4o', provider: 'openai', hint: 'OpenAI' },
  { id: 'gpt-4o-mini', label: 'GPT-4o mini', provider: 'openai', hint: 'OpenAI, low cost' },
  { id: 'gpt-4.1', label: 'GPT-4.1', provider: 'openai', hint: 'OpenAI' },
];

/** Picks the Vapi model provider for a model id; Claude models go to Anthropic. */
export function providerForModel(model: string): LlmProvider {
  return /^claude-/i.test(model) ? 'anthropic' : 'openai';
}
