import { supabase } from './supabase';

// Same origin in production builds (the API serves the app); localhost API in dev.
export const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? (import.meta.env.DEV ? 'http://localhost:8080' : '')).replace(/\/$/, '');

let activeOrgId: string | null = null;
export function setActiveOrg(id: string | null) {
  activeOrgId = id;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown, opts: { auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (opts.auth !== false) {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (token) headers.authorization = `Bearer ${token}`;
    if (activeOrgId) headers['x-organization-id'] = activeOrgId;
  }
  const res = await send(`${API_BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? safeJson(text) : undefined;
  if (!res.ok) {
    const message = (json as { message?: string } | undefined)?.message ?? res.statusText;
    throw new ApiError(res.status, message, json);
  }
  return json as T;
}

/** fetch() that turns network failures into a readable ApiError instead of "Failed to fetch". */
async function send(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    throw new ApiError(0, 'Could not reach the server. Check your connection and try again.');
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
  del: <T>(path: string) => request<T>('DELETE', path),
  /** Unauthenticated calls (public appointment page). */
  public: {
    get: <T>(path: string) => request<T>('GET', path, undefined, { auth: false }),
    post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}, { auth: false }),
  },
};

/** Downloads a file from an authenticated endpoint. */
export async function downloadFile(path: string, filename: string) {
  const { data } = await supabase.auth.getSession();
  const headers: Record<string, string> = {};
  if (data.session) headers.authorization = `Bearer ${data.session.access_token}`;
  if (activeOrgId) headers['x-organization-id'] = activeOrgId;
  const res = await send(`${API_BASE}${path}`, { headers });
  if (!res.ok) {
    const json = safeJson(await res.text()) as { message?: string } | undefined;
    throw new ApiError(res.status, json?.message ?? `Download failed (${res.status})`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke later; revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
