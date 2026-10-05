import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import type { Config } from '../config';

export interface AuthUser {
  id: string;
  email: string | null;
}

/** Verifies Supabase access tokens (JWTs) sent by the frontend. */
export interface AuthVerifier {
  verify(token: string): Promise<AuthUser | null>;
}

/** Server-side Supabase admin operations (service role key, backend only). */
export interface SupabaseAdmin {
  inviteUser(email: string, redirectTo?: string): Promise<AuthUser>;
}

export function createSupabaseServiceClient(config: Config): SupabaseClient {
  return createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function createSupabaseAuthVerifier(client: SupabaseClient, ttlMs = 60_000): AuthVerifier {
  const cache = new Map<string, { user: AuthUser; expires: number }>();
  return {
    async verify(token) {
      const key = createHash('sha256').update(token).digest('hex');
      const hit = cache.get(key);
      if (hit && hit.expires > Date.now()) return hit.user;
      const { data, error } = await client.auth.getUser(token);
      if (error || !data.user) return null;
      const user = { id: data.user.id, email: data.user.email ?? null };
      if (cache.size > 5_000) cache.clear();
      cache.set(key, { user, expires: Date.now() + ttlMs });
      return user;
    },
  };
}

export function createSupabaseAdmin(client: SupabaseClient): SupabaseAdmin {
  return {
    async inviteUser(email, redirectTo) {
      const { data, error } = await client.auth.admin.inviteUserByEmail(email, { redirectTo });
      if (error || !data.user) throw new Error(`Supabase invite failed: ${error?.message ?? 'no user'}`);
      return { id: data.user.id, email: data.user.email ?? email };
    },
  };
}
