import pg from 'pg';

// timestamptz -> ISO string handled by pg as Date; bigint counts come back as strings, parse them.
pg.types.setTypeParser(20, (v) => Number(v));

export type Db = pg.Pool;
export type DbClient = pg.PoolClient | pg.Pool;

export function createPool(connectionString: string, max = 10): Db {
  return new pg.Pool({ connectionString, max });
}

/** Run fn inside a transaction, committing on success and rolling back on error. */
export async function withTx<T>(db: Db, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export function isPgError(err: unknown, code: string): err is pg.DatabaseError {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === code;
}

/** Postgres error codes we branch on. */
export const PG = {
  uniqueViolation: '23505',
  exclusionViolation: '23P01',
  foreignKeyViolation: '23503',
} as const;
