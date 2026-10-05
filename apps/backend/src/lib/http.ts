/** Vendor-neutral names shown to users (internal service ids stay in logs). */
const DISPLAY_NAMES: Record<string, string> = { Vapi: 'Calling service', Cartesia: 'Voice service', OpenAI: 'AI service' };
export const serviceDisplayName = (service: string) => DISPLAY_NAMES[service] ?? service;

export class UpstreamError extends Error {
  constructor(
    public readonly service: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`${service} responded ${status}: ${body.slice(0, 500)}`);
  }

  /** Short, user-facing explanation (the upstream's own message when it sends one). */
  get userMessage(): string {
    let detail = this.body;
    try {
      const j = JSON.parse(this.body) as { message?: unknown; error?: unknown };
      const m = j.message ?? j.error;
      detail = Array.isArray(m) ? m.join('; ') : typeof m === 'string' ? m : typeof m === 'object' && m ? JSON.stringify(m) : this.body;
    } catch {
      /* not JSON */
    }
    detail = neutralize(detail.slice(0, 300));
    const name = serviceDisplayName(this.service);
    if (this.status === 0) return `${name}: ${detail}`;
    if (this.status === 401 || this.status === 403) return `${name} rejected the API key (${this.status}). Check its credentials in the server settings.`;
    return `${name} error (${this.status}): ${detail || 'no details'}`;
  }
}

/** fetch + JSON with a hard timeout and readable upstream errors. */
export async function fetchJson<T>(
  service: string,
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const { timeoutMs = 15_000, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if ((err as Error).name === 'TimeoutError' || (err as Error).name === 'AbortError') {
      throw new TimeoutError(`${serviceDisplayName(service)} did not respond within ${Math.round(timeoutMs / 1000)}s`);
    }
    throw new UpstreamError(service, 0, `could not connect (${(err as Error).message})`);
  }
  const text = await res.text();
  if (!res.ok) throw new UpstreamError(service, res.status, text);
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Rejects with a TimeoutError if the promise takes longer than ms. */
export async function withTimeout<T>(promise: Promise<T>, ms: number, label = 'operation'): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export class TimeoutError extends Error {}

/** Removes vendor names from text that is shown to users. */
export function neutralize(text: string): string {
  return text.replace(/vapi/gi, 'platform').replace(/cartesia/gi, 'voice');
}
