import { createCallPipeline, type CallPipeline } from './modules/calls/pipeline';

/** Composition root: every feature's call tools, end-of-call steps and summary steps. */
export function defaultCallPipeline(): CallPipeline {
  return createCallPipeline({ tools: [], endSteps: [], summarySteps: [] });
}
