import type { Config } from './config';
import type { Db } from './db/pool';
import type { CartesiaClient } from './integrations/cartesia';
import type { OpenAiClient } from './integrations/openai';
import type { AuthVerifier, SupabaseAdmin } from './integrations/supabase';
import type { TwilioClient } from './integrations/twilio';
import type { VapiClient } from './integrations/vapi';
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
  vapi: VapiClient;
  cartesia: CartesiaClient;
  twilio: TwilioClient;
  openai: OpenAiClient;
}
