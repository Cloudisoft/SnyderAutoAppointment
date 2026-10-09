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
  | { type: 'endCall'; messages?: VapiFunctionTool['messages'] }
  | {
      type: 'transferCall';
      destinations: { type: 'number'; number: string; message?: string; description?: string }[];
      messages?: VapiFunctionTool['messages'];
    };

/** Live supervision commands sent to a call's control URL. */
export type VapiControl =
  | { type: 'say'; content: string; endCallAfterSpoken?: boolean }
  | { type: 'end-call' }
  | { type: 'transfer'; destination: { type: 'number'; number: string }; content?: string };

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
  /** Spoken phrases that make the platform hang up right after the assistant says them. */
  endCallPhrases?: string[];
  /** Live listen (audio websocket) and control (say / end / transfer) URLs on the created call. */
  monitorPlan?: { listenEnabled: boolean; controlEnabled: boolean };
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
  artifact?: VapiArtifact;
  analysis?: { summary?: string; structuredData?: Record<string, unknown>; successEvaluation?: unknown };
}

/** Call artifacts. Recordings may be on private storage, reachable only through expiring presigned URLs. */
export interface VapiArtifact {
  transcript?: string;
  recordingUrl?: string;
  stereoRecordingUrl?: string;
  recording?: { stereoUrl?: string; mono?: { combinedUrl?: string } };
  presignedMonoUrl?: string;
  presignedStereoUrl?: string;
  messages?: VapiMessage[];
}

/** The best playable recording URL in an artifact (fresh presigned URL first). */
export function recordingUrlOf(a: VapiArtifact | undefined, fallback?: string): string | null {
  return a?.presignedMonoUrl ?? a?.recording?.mono?.combinedUrl ?? a?.recordingUrl ?? a?.presignedStereoUrl ?? a?.recording?.stereoUrl ?? a?.stereoRecordingUrl ?? fallback ?? null;
}

export interface VapiClient {
  createCall(req: VapiCallRequest): Promise<{ id: string; status?: string; monitor?: { listenUrl?: string; controlUrl?: string } }>;
  /** Sends a live control command (say, end call, transfer) to a call's control URL. */
  controlCall(controlUrl: string, command: VapiControl): Promise<void>;
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
    async controlCall(controlUrl, command) {
      if (!/^https:\/\//.test(controlUrl)) throw new HttpError(400, 'Invalid control URL');
      let res: Response;
      try {
        res = await fetch(controlUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(command),
          signal: AbortSignal.timeout(8_000),
        });
      } catch (err) {
        throw new UpstreamError('Vapi', 0, `could not connect (${(err as Error).message})`);
      }
      if (!res.ok) throw new UpstreamError('Vapi', res.status, await res.text());
    },
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
