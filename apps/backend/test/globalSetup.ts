import { readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { MIGRATIONS_DIR, runMigrations } from '../src/db/migrations';

const ADMIN_URL =
  process.env.TEST_DATABASE_ADMIN_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const DB_NAME = process.env.TEST_DATABASE_NAME ?? 'snyder_test';

/**
 * Creates a fresh test database, installs the Supabase shim and applies every migration.
 * DB-backed suites read TEST_DATABASE_URL. Set SKIP_DB_TESTS=1 to run only the pure suites.
 */
export default async function setup() {
  if (process.env.SKIP_DB_TESTS === '1') return;
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  try {
    await admin.connect();
  } catch (err) {
    throw new Error(
      `Cannot reach Postgres for DB tests at ${ADMIN_URL} (${(err as Error).message}). ` +
        'Start Postgres or set TEST_DATABASE_ADMIN_URL; set SKIP_DB_TESTS=1 to skip DB suites.',
    );
  }
  await admin.query(`drop database if exists ${DB_NAME} with (force)`);
  await admin.query(`create database ${DB_NAME}`);
  await admin.end();

  const url = new URL(ADMIN_URL);
  url.pathname = `/${DB_NAME}`;
  const testUrl = url.toString();
  const pool = new pg.Pool({ connectionString: testUrl, max: 1 });
  try {
    const shim = await readFile(path.resolve(MIGRATIONS_DIR, '../test/supabase_shim.sql'), 'utf8');
    await pool.query(shim);
    await runMigrations(pool);
  } finally {
    await pool.end();
  }
  process.env.TEST_DATABASE_URL = testUrl;
}
