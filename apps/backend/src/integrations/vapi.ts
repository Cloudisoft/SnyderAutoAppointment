import { HttpError } from '../lib/errors';
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
    provider: 'openai' | 'anthropic';
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
  artifactPlan?: { recordingEnabled?: boolean; transcriptPlan?: { enabled: boolean } };
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
  /** Creates a saved assistant (used only to validate a config; delete it right after). */
  createAssistant(assistant: VapiAssistant): Promise<{ id: string }>;
  deleteAssistant(id: string): Promise<void>;
  /** Cheap authenticated read to confirm the API key works. */
  ping(): Promise<void>;
}

/** True when Vapi rejected the request payload (as opposed to auth/outage errors). */
export function isVapiValidationError(err: unknown): boolean {
  return err instanceof UpstreamError && (err.status === 400 || err.status === 422);
}

export function createVapiClient(apiKey: string): VapiClient {
  const headers = () => {
    if (!apiKey) throw new HttpError(503, 'The calling service is not configured on the server (missing API key)', 'not_configured');
    return { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' };
  };
  return {
    createCall: (req) =>
      fetchJson('Vapi', `${VAPI_BASE}/call`, { method: 'POST', headers: headers(), body: JSON.stringify(req) }),
    getCall: (id) => fetchJson('Vapi', `${VAPI_BASE}/call/${encodeURIComponent(id)}`, { headers: headers() }),
    async importTwilioNumber(o) {
      const payload = {
        provider: 'twilio',
        number: o.number,
        twilioAccountSid: o.twilioAccountSid,
        twilioAuthToken: o.twilioAuthToken,
        name: o.name,
        server: { url: o.serverUrl, secret: o.serverSecret },
      };
      try {
        return await fetchJson<{ id: string }>('Vapi', `${VAPI_BASE}/phone-number`, { method: 'POST', headers: headers(), body: JSON.stringify(payload) });
      } catch (err) {
        if (!(err instanceof UpstreamError) || err.status !== 400) throw err;
        if (/another org/i.test(err.body)) {
          throw new HttpError(
            409,
            `${o.number} is already connected to a different calling account. Remove it from that account first, or import a different number.`,
            'number_in_use',
          );
        }
        // Already imported into this account earlier (e.g. a previous attempt): reuse it and point it at our server.
        const existingId =
          /Existing Phone Number ([0-9a-f-]{36})/i.exec(err.body)?.[1] ??
          (await fetchJson<{ id: string; number?: string }[]>('Vapi', `${VAPI_BASE}/phone-number?limit=1000`, { headers: headers() })).find(
            (n) => n.number === o.number,
          )?.id;
        if (!existingId) throw err;
        const { provider: _p, number: _n, ...update } = payload;
        await fetchJson('Vapi', `${VAPI_BASE}/phone-number/${encodeURIComponent(existingId)}`, {
          method: 'PATCH',
          headers: headers(),
          body: JSON.stringify(update),
        });
        return { id: existingId };
      }
    },
    createAssistant: (assistant) =>
      fetchJson('Vapi', `${VAPI_BASE}/assistant`, { method: 'POST', headers: headers(), body: JSON.stringify(assistant) }),
    async deleteAssistant(id) {
      await fetchJson('Vapi', `${VAPI_BASE}/assistant/${encodeURIComponent(id)}`, { method: 'DELETE', headers: headers() });
    },
    async ping() {
      await fetchJson('Vapi', `${VAPI_BASE}/phone-number?limit=1`, { headers: headers() });
    },
    async deletePhoneNumber(id) {
      await fetchJson('Vapi', `${VAPI_BASE}/phone-number/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: headers(),
      });
    },
  };
}
