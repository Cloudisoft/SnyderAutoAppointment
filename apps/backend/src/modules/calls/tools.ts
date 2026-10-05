import type { Deps } from '../../deps';
import { withTimeout } from '../../lib/http';
import { addDnc } from '../leads/routes';
import { addCallEvent } from './events';
import type { CallRow } from './types';

export interface ToolContext {
  deps: Deps;
  call: CallRow;
  toolCallId: string;
  args: Record<string, unknown>;
}

export interface ToolDefinition {
  name: string;
  handler(ctx: ToolContext): Promise<string>;
  /** Must stay well inside Vapi's tool timeout. */
  timeoutMs: number;
  /** Spoken when the handler fails or times out, so the call carries on gracefully. */
  fallbackMessage: string;
}

export type ToolRegistry = Map<string, ToolDefinition>;

export const GENERIC_TOOL_FALLBACK =
  "I'm sorry, I couldn't complete that just now. Let me make a note and have someone follow up with you by email or a quick call back.";

export function parseToolArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const v = JSON.parse(raw);
      return v && typeof v === 'object' ? v : {};
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * Executes one Vapi tool call. Never throws: any failure (unknown call, unknown tool, handler
 * error, timeout) is logged loudly with the real error and turned into a graceful spoken message.
 */
export async function executeToolCall(
  deps: Deps,
  registry: ToolRegistry,
  call: CallRow | null,
  toolCall: { id: string; name: string; arguments: unknown },
): Promise<{ toolCallId: string; result: string }> {
  const def = registry.get(toolCall.name);
  const log = deps.logger.child({ tool: toolCall.name, toolCallId: toolCall.id, callId: call?.id });
  if (!call) {
    log.error('VAPI TOOL FAILED: tool call for unknown call');
    return { toolCallId: toolCall.id, result: def?.fallbackMessage ?? GENERIC_TOOL_FALLBACK };
  }
  if (!def) {
    log.error('VAPI TOOL FAILED: unknown tool');
    return { toolCallId: toolCall.id, result: GENERIC_TOOL_FALLBACK };
  }
  const args = parseToolArgs(toolCall.arguments);
  const started = Date.now();
  try {
    const result = await withTimeout(def.handler({ deps, call, toolCallId: toolCall.id, args }), def.timeoutMs, toolCall.name);
    await addCallEvent(deps.db, {
      organizationId: call.organization_id,
      callId: call.id,
      type: 'tool',
      content: toolCall.name,
      metadata: { ms: Date.now() - started, ok: true },
    }).catch(() => undefined);
    return { toolCallId: toolCall.id, result };
  } catch (err) {
    log.error({ err, ms: Date.now() - started }, 'VAPI TOOL FAILED: handler error; returned graceful fallback');
    await addCallEvent(deps.db, {
      organizationId: call.organization_id,
      callId: call.id,
      type: 'tool',
      content: toolCall.name,
      metadata: { ms: Date.now() - started, ok: false, error: (err as Error).message },
    }).catch(() => undefined);
    return { toolCallId: toolCall.id, result: def.fallbackMessage };
  }
}

export const markDoNotCallTool: ToolDefinition = {
  name: 'mark_do_not_call',
  timeoutMs: 5_000,
  fallbackMessage: "Understood. I'll make sure you're not contacted again.",
  async handler({ deps, call, args }) {
    await deps.db.query('update calls set dnc_requested = true where id = $1', [call.id]);
    await addDnc(deps.db, call.organization_id, call.to_number, 'call');
    await addCallEvent(deps.db, {
      organizationId: call.organization_id,
      callId: call.id,
      type: 'system',
      content: 'Do-not-call requested',
      metadata: { reason: typeof args.reason === 'string' ? args.reason.slice(0, 500) : null },
    });
    return "Understood. I've removed your number from our list and you won't be contacted again.";
  },
};

export function createToolRegistry(extra: ToolDefinition[] = []): ToolRegistry {
  const registry: ToolRegistry = new Map();
  for (const t of [markDoNotCallTool, ...extra]) registry.set(t.name, t);
  return registry;
}
