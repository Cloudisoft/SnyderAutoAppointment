import type { Config } from './config';
import type { Db } from './db/pool';
import type { AuthVerifier, SupabaseAdmin } from './integrations/supabase';
import type { Clock } from './lib/clock';
import type { Logger } from './lib/logger';

/** Everything route handlers, services and jobs need. Built once in index.ts, faked in tests. */
export interface Deps {
  config: Config;
  db: Db;
  logger: Logger;
  clock: Clock;
  auth: AuthVerifier;
  supabaseAdmin: SupabaseAdmin;
}
