import { recordingUrlOf, type VapiArtifact, type VapiCall } from '../../integrations/vapi';
import type { CallEndData } from './types';

interface EndOfCallReport {
  endedReason?: string;
  call?: { id: string; startedAt?: string; endedAt?: string; cost?: number };
  startedAt?: string;
  endedAt?: string;
  durationSeconds?: number;
  cost?: number;
  transcript?: string;
  recordingUrl?: string;
  summary?: string;
  artifact?: VapiArtifact;
  analysis?: { summary?: string; structuredData?: Record<string, unknown> };
}

export function fromEndOfCallReport(msg: EndOfCallReport): CallEndData {
  return {
    vapiCallId: msg.call?.id ?? '',
    endedReason: msg.endedReason ?? null,
    startedAt: msg.startedAt ?? msg.call?.startedAt ?? null,
    endedAt: msg.endedAt ?? msg.call?.endedAt ?? null,
    durationSeconds: typeof msg.durationSeconds === 'number' ? Math.round(msg.durationSeconds) : null,
    recordingUrl: recordingUrlOf(msg.artifact, msg.recordingUrl),
    transcript: msg.artifact?.transcript ?? msg.transcript ?? null,
    summary: msg.analysis?.summary ?? msg.summary ?? null,
    structuredData: msg.analysis?.structuredData ?? null,
    cost: msg.cost ?? msg.call?.cost ?? null,
    source: 'webhook',
  };
}

export function fromVapiCall(call: VapiCall): CallEndData {
  return {
    vapiCallId: call.id,
    endedReason: call.endedReason ?? null,
    startedAt: call.startedAt ?? null,
    endedAt: call.endedAt ?? null,
    durationSeconds: null,
    recordingUrl: recordingUrlOf(call.artifact, call.recordingUrl),
    transcript: call.artifact?.transcript ?? call.transcript ?? null,
    summary: call.analysis?.summary ?? call.summary ?? null,
    structuredData: call.analysis?.structuredData ?? null,
    cost: call.cost ?? null,
    source: 'reconcile',
  };
}
