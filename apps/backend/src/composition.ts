import { bookingTools } from './modules/appointments/tools/bookingTools';
import { appointmentsExtension } from './modules/appointments/tools/extension';
import { createCallPipeline, type CallPipeline } from './modules/calls/pipeline';

/** Composition root: every feature's call tools, assistant extensions, end-of-call and summary steps. */
export function defaultCallPipeline(): CallPipeline {
  return createCallPipeline({
    tools: [...bookingTools],
    extensions: [appointmentsExtension],
    endSteps: [],
    summarySteps: [],
  });
}
