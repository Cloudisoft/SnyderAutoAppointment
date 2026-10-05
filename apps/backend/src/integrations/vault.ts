import type { DbClient } from '../db/pool';

/** Stores a secret in Supabase Vault (encrypted at rest) and returns its id. */
export async function storeSecret(db: DbClient, value: string, name: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>('select vault.create_secret($1, $2) as id', [value, name]);
  return rows[0]!.id;
}

export async function readSecret(db: DbClient, id: string): Promise<string> {
  const { rows } = await db.query<{ decrypted_secret: string }>(
    'select decrypted_secret from vault.decrypted_secrets where id = $1',
    [id],
  );
  if (!rows[0]) throw new Error(`Vault secret ${id} not found`);
  return rows[0].decrypted_secret;
}

export async function deleteSecret(db: DbClient, id: string): Promise<void> {
  await db.query('delete from vault.secrets where id = $1', [id]);
}
