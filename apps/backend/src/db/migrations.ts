import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';

export const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../supabase/migrations',
);

const FILE_RE = /^(\d{4})_[a-z0-9_]+\.sql$/;

export async function listMigrations(dir = MIGRATIONS_DIR): Promise<{ version: string; file: string }[]> {
  const files = (await readdir(dir)).filter((f) => FILE_RE.test(f)).sort();
  return files.map((file) => ({ version: file.slice(0, 4), file }));
}

/**
 * Applies pending numbered migrations in order. Production deploys normally use
 * `supabase db push`; this runner exists for local development and tests and records
 * applied versions in the same `supabase_migrations.schema_migrations` table.
 */
export async function runMigrations(client: pg.Pool | pg.PoolClient, dir = MIGRATIONS_DIR): Promise<string[]> {
  await client.query(`
    create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (
      version text primary key,
      name text,
      statements text[]
    );
  `);
  const { rows } = await client.query<{ version: string }>(
    'select version from supabase_migrations.schema_migrations',
  );
  const applied = new Set(rows.map((r) => r.version));
  const ran: string[] = [];
  for (const m of await listMigrations(dir)) {
    if (applied.has(m.version)) continue;
    const sql = await readFile(path.join(dir, m.file), 'utf8');
    await client.query('begin');
    try {
      await client.query(sql);
      await client.query(
        'insert into supabase_migrations.schema_migrations(version, name) values ($1, $2)',
        [m.version, m.file.replace(/\.sql$/, '')],
      );
      await client.query('commit');
    } catch (err) {
      await client.query('rollback');
      throw new Error(`Migration ${m.file} failed: ${(err as Error).message}`);
    }
    ran.push(m.file);
  }
  return ran;
}
