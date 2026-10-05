export class UpstreamError extends Error {
  constructor(
    public readonly service: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`${service} responded ${status}: ${body.slice(0, 500)}`);
  }
}

/** fetch + JSON with a hard timeout and readable upstream errors. */
export async function fetchJson<T>(
  service: string,
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const { timeoutMs = 15_000, ...rest } = init;
  const res = await fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
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
