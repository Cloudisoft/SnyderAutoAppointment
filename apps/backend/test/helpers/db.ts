import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { describe } from 'vitest';
import { createPool, type Db } from '../../src/db/pool';

export const dbTestsEnabled = process.env.SKIP_DB_TESTS !== '1';
/** describe() that only runs when the test database is available. */
export const describeDb = dbTestsEnabled ? describe : describe.skip;

let pool: Db | undefined;
export function testPool(): Db {
  if (!pool) {
    const url = process.env.TEST_DATABASE_URL;
    if (!url) throw new Error('TEST_DATABASE_URL not set; globalSetup did not run');
    pool = createPool(url, 20);
  }
  return pool;
}

export async function closeTestPool() {
  await pool?.end();
  pool = undefined;
}

/**
 * Runs fn as a Supabase "authenticated" user (RLS enforced) inside a transaction that is
 * always rolled back.
 */
export async function asUser<T>(
  db: Db,
  userId: string,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('begin');
    await client.query('set local role authenticated');
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: userId, role: 'authenticated' }),
    ]);
    return await fn(client);
  } finally {
    await client.query('rollback').catch(() => undefined);
    client.release();
  }
}

export async function createAuthUser(db: Db, email = `${randomUUID()}@example.test`) {
  const { rows } = await db.query<{ id: string }>(
    'insert into auth.users(email) values ($1) returning id',
    [email],
  );
  return { id: rows[0]!.id, email };
}

export interface SeededOrg {
  orgId: string;
  ownerId: string;
  /** Adds a user with the given system role key and returns their id. */
  addUser(roleKey: string): Promise<string>;
}

export async function seedOrg(db: Db, name = 'Test Org', timeZone = 'America/New_York'): Promise<SeededOrg> {
  const owner = await createAuthUser(db);
  const { rows } = await db.query<{ id: string }>(
    'insert into organizations(name, time_zone) values ($1, $2) returning id',
    [name, timeZone],
  );
  const orgId = rows[0]!.id;
  const addUser = async (roleKey: string, userId?: string) => {
    const id = userId ?? (await createAuthUser(db)).id;
    await db.query(
      `insert into memberships(organization_id, user_id, role_id)
       select $1, $2, id from roles where organization_id = $1 and key = $3`,
      [orgId, id, roleKey],
    );
    return id;
  };
  await addUser('owner', owner.id);
  return { orgId, ownerId: owner.id, addUser: (k) => addUser(k) };
}
