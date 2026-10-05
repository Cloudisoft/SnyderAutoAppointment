import { createHash, randomBytes } from 'node:crypto';
import type { DbClient } from '../../db/pool';

/** 32 random bytes, URL-safe. Only the SHA-256 hash ever reaches the database. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Issues a new link token for an appointment (stored as a hash) and returns the raw token. */
export async function mintAppointmentToken(db: DbClient, appt: { id: string; organization_id: string; ends_at: Date }): Promise<string> {
  const token = generateToken();
  const hash = hashToken(token);
  const { rows } = await db.query<{ expires_at: Date }>(
    `update appointments set token_hash = $2, token_expires_at = coalesce(token_expires_at, ends_at + interval '30 days')
      where id = $1 returning token_expires_at as expires_at`,
    [appt.id, hash],
  );
  await db.query(
    `insert into appointment_tokens(organization_id, appointment_id, token_hash, expires_at) values ($1, $2, $3, $4)`,
    [appt.organization_id, appt.id, hash, rows[0]?.expires_at ?? new Date(appt.ends_at.getTime() + 30 * 86_400_000)],
  );
  return token;
}

/** Resolves a raw token to its appointment id if the token is known, unrevoked and unexpired. */
export async function resolveToken(db: DbClient, token: string, now: Date): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const { rows } = await db.query<{ appointment_id: string }>(
    `select appointment_id from appointment_tokens where token_hash = $1 and revoked_at is null and expires_at > $2`,
    [hashToken(token), now.toISOString()],
  );
  return rows[0]?.appointment_id ?? null;
}
