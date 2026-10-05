import { fetchJson, UpstreamError } from '../lib/http';

const VAPI_BASE = 'https://api.vapi.ai';

/** A function tool executed by our server URL. */
export interface VapiFunctionTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  };
  server: { url: string; secret?: string; timeoutSeconds?: number };
  async?: boolean;
  messages?: { type: 'request-start' | 'request-failed' | 'request-response-delayed'; content: string; timingMilliseconds?: number }[];
}

export type VapiTool =
  | VapiFunctionTool
  | { type: 'endCall' }
  | { type: 'transferCall'; destinations: { type: 'number'; number: string; message?: string }[] };

/** Transient (per-call) assistant configuration. */
export interface VapiAssistant {
  name: string;
  firstMessage?: string;
  firstMessageMode?: 'assistant-speaks-first' | 'assistant-waits-for-user';
  model: {
    provider: 'openai';
    model: string;
    temperature?: number;
    messages: { role: 'system'; content: string }[];
    tools: VapiTool[];
    toolIds?: string[];
  };
  voice: { provider: 'cartesia'; voiceId: string; model: string; language?: string };
  transcriber?: { provider: 'deepgram'; model: string; language?: string };
  server: { url: string; secret: string; timeoutSeconds?: number };
  serverMessages: string[];
  voicemailDetection?: { provider: 'vapi' | 'twilio' };
  endCallMessage?: string;
  maxDurationSeconds?: number;
  analysisPlan?: { summaryPlan?: { enabled: boolean } };
  metadata?: Record<string, string>;
}

export interface VapiCallRequest {
  phoneNumberId: string;
  customer: { number: string; name?: string };
  assistant: VapiAssistant;
  metadata: Record<string, string>;
}

export interface VapiMessage {
  role: string;
  message?: string;
  content?: string;
  time?: number;
  secondsFromStart?: number;
}

export interface VapiCall {
  id: string;
  status: string;
  endedReason?: string;
  startedAt?: string;
  endedAt?: string;
  cost?: number;
  metadata?: Record<string, string>;
  transcript?: string;
  recordingUrl?: string;
  summary?: string;
  messages?: VapiMessage[];
  artifact?: { transcript?: string; recordingUrl?: string; messages?: VapiMessage[] };
  analysis?: { summary?: string; structuredData?: Record<string, unknown>; successEvaluation?: unknown };
}

export interface VapiClient {
  createCall(req: VapiCallRequest): Promise<{ id: string; status?: string }>;
  getCall(id: string): Promise<VapiCall>;
  importTwilioNumber(opts: {
    number: string;
    twilioAccountSid: string;
    twilioAuthToken: string;
    name?: string;
    serverUrl: string;
    serverSecret: string;
  }): Promise<{ id: string }>;
  deletePhoneNumber(id: string): Promise<void>;
}

/** True when Vapi rejected the request payload (as opposed to auth/outage errors). */
export function isVapiValidationError(err: unknown): boolean {
  return err instanceof UpstreamError && (err.status === 400 || err.status === 422);
}

export function createVapiClient(apiKey: string): VapiClient {
  const headers = () => {
    if (!apiKey) throw new Error('VAPI_API_KEY is not configured');
    return { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' };
  };
  return {
    createCall: (req) =>
      fetchJson('Vapi', `${VAPI_BASE}/call`, { method: 'POST', headers: headers(), body: JSON.stringify(req) }),
    getCall: (id) => fetchJson('Vapi', `${VAPI_BASE}/call/${encodeURIComponent(id)}`, { headers: headers() }),
    importTwilioNumber: (o) =>
      fetchJson('Vapi', `${VAPI_BASE}/phone-number`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          provider: 'twilio',
          number: o.number,
          twilioAccountSid: o.twilioAccountSid,
          twilioAuthToken: o.twilioAuthToken,
          name: o.name,
          server: { url: o.serverUrl, secret: o.serverSecret },
        }),
      }),
    async deletePhoneNumber(id) {
      await fetchJson('Vapi', `${VAPI_BASE}/phone-number/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: headers(),
      });
    },
  };
}
