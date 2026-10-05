import { supabase } from './supabase';

export const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080').replace(/\/$/, '');

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
  const res = await fetch(`${API_BASE}${path}`, {
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
  const res = await fetch(`${API_BASE}${path}`, { headers });
  if (!res.ok) throw new ApiError(res.status, res.statusText);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
