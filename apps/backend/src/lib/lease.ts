import type { DbClient } from '../db/pool';

/**
 * Acquires or renews a named lease. Returns true when `holder` owns the lease afterwards.
 * A lease is taken over only after it expires, so a crashed instance is replaced within ttlMs.
 */
export async function acquireLease(db: DbClient, name: string, holder: string, ttlMs: number): Promise<boolean> {
  const { rows } = await db.query<{ holder: string }>(
    `insert into worker_leases(name, holder, expires_at) values ($1, $2, now() + make_interval(secs => $3 / 1000.0))
     on conflict (name) do update set holder = excluded.holder, expires_at = excluded.expires_at, updated_at = now()
       where worker_leases.holder = excluded.holder or worker_leases.expires_at < now()
     returning holder`,
    [name, holder, ttlMs],
  );
  return rows[0]?.holder === holder;
}

export async function releaseLease(db: DbClient, name: string, holder: string): Promise<void> {
  await db.query('delete from worker_leases where name = $1 and holder = $2', [name, holder]);
}
