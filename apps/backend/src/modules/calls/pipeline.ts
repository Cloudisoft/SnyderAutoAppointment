import type { CampaignSnapshot } from '@snyder/shared';
import type { Deps } from '../../deps';
import type { AssistantExtension, AssistantLead } from '../agents/assistantBuilder';
import { processCallEnded, type CallEndResult, type CallEndStep } from './endOfCall';
import { runPostCallSummary, type SummaryStep } from './summary';
import { createToolRegistry, type ToolDefinition, type ToolRegistry } from './tools';
import type { CallEndData } from './types';

/** The per-call behaviour feature modules plug into: tools, end-of-call steps, summary steps. */
export interface ExtensionContext {
  deps: Deps;
  snapshot: CampaignSnapshot;
  lead: AssistantLead;
  callId: string;
  organizationId: string;
  leadTimeZone: string;
}

/** Contributes per-call assistant tools/prompt rules (null = nothing for this call). */
export type ExtensionProvider = (ctx: ExtensionContext) => Promise<AssistantExtension | null> | AssistantExtension | null;

export interface CallPipeline {
  tools: ToolRegistry;
  endSteps: CallEndStep[];
  summarySteps: SummaryStep[];
  extensions: ExtensionProvider[];
}

export function createCallPipeline(
  parts: { tools?: ToolDefinition[]; endSteps?: CallEndStep[]; summarySteps?: SummaryStep[]; extensions?: ExtensionProvider[] } = {},
): CallPipeline {
  return {
    tools: createToolRegistry(parts.tools ?? []),
    endSteps: parts.endSteps ?? [],
    summarySteps: parts.summarySteps ?? [],
    extensions: parts.extensions ?? [],
  };
}

/** Finalizes a call, then kicks off the post-call summary in the background. */
export async function handleCallEnded(
  deps: Deps,
  pipeline: CallPipeline,
  data: CallEndData,
  opts: { callId?: string; awaitSummary?: boolean } = {},
): Promise<CallEndResult> {
  const result = await processCallEnded(deps, data, { callId: opts.callId, steps: pipeline.endSteps });
  if (result.status === 'processed') {
    const summary = runPostCallSummary(deps, result.callId, pipeline.summarySteps).catch((err) =>
      deps.logger.error({ err, callId: result.callId }, 'post-call summary failed; reconciliation will retry'),
    );
    if (opts.awaitSummary) await summary;
  }
  return result;
}
