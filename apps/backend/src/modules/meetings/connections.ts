import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Config } from '../../config';
import { withTx, type DbClient } from '../../db/pool';
import type { Deps } from '../../deps';
import type { OAuthProviderClient, OAuthTokens } from '../../integrations/oauth';
import { deleteSecret, readSecret, storeSecret } from '../../integrations/vault';
import { UpstreamError } from '../../lib/http';

export const PROVIDERS = ['google', 'zoom'] as const;
export type Provider = (typeof PROVIDERS)[number];
export const PROVIDER_LABELS: Record<Provider, string> = { google: 'Google Calendar & Meet', zoom: 'Zoom' };

/** A problem only a person can fix (reconnect an account, connect one first). Not retried. */
export class MeetingSetupError extends Error {}

export interface Connection {
  organization_id: string;
  provider: Provider;
  account_email: string | null;
  account_name: string | null;
  refresh_token_secret_id: string;
  status: 'connected' | 'error';
  last_error: string | null;
  connected_at: Date;
}

export function clientFor(deps: Deps, provider: Provider): OAuthProviderClient {
  return provider === 'google' ? deps.google : deps.zoom;
}

export function redirectUri(config: Pick<Config, 'BACKEND_PUBLIC_URL'>, provider: Provider): string {
  return `${config.BACKEND_PUBLIC_URL.replace(/\/$/, '')}/api/integrations/${provider}/callback`;
}

// --- OAuth state: signed, short-lived, binds the callback to the org and user that started it ---
const STATE_TTL_MS = 15 * 60_000;
const stateKey = (secret: string) => createHmac('sha256', secret).update('oauth-state:v1').digest();

export function signState(secret: string, s: { organizationId: string; userId: string; provider: Provider; returnTo?: string }, now: Date): string {
  const payload = Buffer.from(
    JSON.stringify({ o: s.organizationId, u: s.userId, p: s.provider, r: s.returnTo, e: now.getTime() + STATE_TTL_MS, n: randomBytes(8).toString('hex') }),
  ).toString('base64url');
  const sig = createHmac('sha256', stateKey(secret)).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyState(secret: string, state: string, provider: Provider, now: Date): { organizationId: string; userId: string; returnTo?: string } | null {
  const [payload, sig] = state.split('.');
  if (!payload || !sig) return null;
  const expected = createHmac('sha256', stateKey(secret)).update(payload).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { o: string; u: string; p: string; e: number; r?: string };
    if (s.p !== provider || s.e < now.getTime()) return null;
    return { organizationId: s.o, userId: s.u, returnTo: s.r };
  } catch {
    return null;
  }
}

export async function getConnection(db: DbClient, organizationId: string, provider: Provider): Promise<Connection | null> {
  const { rows } = await db.query<Connection>('select * from organization_integrations where organization_id = $1 and provider = $2', [organizationId, provider]);
  return rows[0] ?? null;
}

export async function saveConnection(
  deps: Deps,
  c: { organizationId: string; provider: Provider; userId: string; tokens: OAuthTokens; account: { email: string; name?: string } },
): Promise<void> {
  if (!c.tokens.refreshToken) throw new MeetingSetupError('The account did not grant offline access. Please try connecting again.');
  await withTx(deps.db, async (tx) => {
    const old = await tx.query<{ refresh_token_secret_id: string }>(
      'select refresh_token_secret_id from organization_integrations where organization_id = $1 and provider = $2 for update',
      [c.organizationId, c.provider],
    );
    const secretId = await storeSecret(tx, c.tokens.refreshToken!, `${c.provider}-refresh-${c.organizationId}-${Date.now()}`);
    await tx.query(
      `insert into organization_integrations(organization_id, provider, account_email, account_name, refresh_token_secret_id, scopes, status, last_error, connected_by, connected_at)
       values ($1, $2, $3, $4, $5, $6, 'connected', null, $7, now())
       on conflict (organization_id, provider) do update set account_email = excluded.account_email, account_name = excluded.account_name,
         refresh_token_secret_id = excluded.refresh_token_secret_id, scopes = excluded.scopes, status = 'connected', last_error = null,
         connected_by = excluded.connected_by, connected_at = now()`,
      [c.organizationId, c.provider, c.account.email, c.account.name ?? null, secretId, c.tokens.scope ?? null, c.userId],
    );
    if (old.rows[0]) await deleteSecret(tx, old.rows[0].refresh_token_secret_id);
  });
  tokenCache.set(cacheKey(c.organizationId, c.provider), { token: c.tokens.accessToken, expiresAt: Date.now() + c.tokens.expiresIn * 1000 });
}

export async function removeConnection(deps: Deps, organizationId: string, provider: Provider): Promise<boolean> {
  const conn = await getConnection(deps.db, organizationId, provider);
  if (!conn) return false;
  const refresh = await readSecret(deps.db, conn.refresh_token_secret_id).catch(() => null);
  if (refresh) await clientFor(deps, provider).revoke(refresh);
  await withTx(deps.db, async (tx) => {
    await tx.query('delete from organization_integrations where organization_id = $1 and provider = $2', [organizationId, provider]);
    await deleteSecret(tx, conn.refresh_token_secret_id);
  });
  tokenCache.delete(cacheKey(organizationId, provider));
  return true;
}

// --- Access tokens: cached in memory, refreshed under an advisory lock (Zoom rotates refresh tokens) ---
const tokenCache = new Map<string, { token: string; expiresAt: number }>();
const cacheKey = (org: string, provider: Provider) => `${org}:${provider}`;

export function clearTokenCache() {
  tokenCache.clear();
}

export async function accessTokenFor(deps: Deps, organizationId: string, provider: Provider): Promise<string> {
  const key = cacheKey(organizationId, provider);
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt - 60_000 > Date.now()) return cached.token;
  return withTx(deps.db, async (tx) => {
    await tx.query('select pg_advisory_xact_lock(hashtext($1))', [`oauth:${key}`]);
    const again = tokenCache.get(key);
    if (again && again.expiresAt - 60_000 > Date.now()) return again.token;
    const conn = await getConnection(tx, organizationId, provider);
    if (!conn) throw new MeetingSetupError(`${PROVIDER_LABELS[provider]} is not connected. An admin can connect it in Settings → Integrations.`);
    const refresh = await readSecret(tx, conn.refresh_token_secret_id);
    let tokens: OAuthTokens;
    try {
      tokens = await clientFor(deps, provider).refresh(refresh);
    } catch (err) {
      if (err instanceof UpstreamError && (err.status === 400 || err.status === 401)) {
        const message = `${PROVIDER_LABELS[provider]} access was revoked or expired. Reconnect it in Settings → Integrations.`;
        await tx.query(`update organization_integrations set status = 'error', last_error = $3 where organization_id = $1 and provider = $2`, [organizationId, provider, message]);
        throw new MeetingSetupError(message);
      }
      throw err;
    }
    if (tokens.refreshToken && tokens.refreshToken !== refresh) {
      const newId = await storeSecret(tx, tokens.refreshToken, `${provider}-refresh-${organizationId}-${Date.now()}`);
      await tx.query('update organization_integrations set refresh_token_secret_id = $3 where organization_id = $1 and provider = $2', [organizationId, provider, newId]);
      await deleteSecret(tx, conn.refresh_token_secret_id);
    }
    if (conn.status !== 'connected') {
      await tx.query(`update organization_integrations set status = 'connected', last_error = null where organization_id = $1 and provider = $2`, [organizationId, provider]);
    }
    tokenCache.set(key, { token: tokens.accessToken, expiresAt: Date.now() + tokens.expiresIn * 1000 });
    return tokens.accessToken;
  });
}
