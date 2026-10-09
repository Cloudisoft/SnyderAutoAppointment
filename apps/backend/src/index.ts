import { buildApp } from './app';
import { defaultCallPipeline } from './composition';
import { buildJobs } from './jobs';
import { JobRunner } from './jobs/runner';
import { loadConfig } from './config';
import { createPool } from './db/pool';
import { createCartesiaClient } from './integrations/cartesia';
import { createSmtpMailer } from './integrations/mailer';
import { createOpenAiClient } from './integrations/openai';
import { createTwilioClient } from './integrations/twilio';
import { createVapiClient } from './integrations/vapi';
import { createGoogleClient } from './integrations/google';
import { createZoomClient } from './integrations/zoom';
import {
  createSupabaseAdmin,
  createSupabaseAuthVerifier,
  createSupabaseServiceClient,
} from './integrations/supabase';
import type { Deps } from './deps';
import { systemClock } from './lib/clock';
import { createLogger } from './lib/logger';

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);
const db = createPool(config.DATABASE_URL, 20);

const supabase = createSupabaseServiceClient(config);

const deps: Deps = {
  config,
  db,
  logger,
  clock: systemClock,
  auth: createSupabaseAuthVerifier(supabase),
  supabaseAdmin: createSupabaseAdmin(supabase),
  vapi: createVapiClient(config.VAPI_API_KEY),
  cartesia: createCartesiaClient(config.CARTESIA_API_KEY),
  twilio: createTwilioClient(),
  openai: createOpenAiClient(config.OPENAI_API_KEY),
  mailer: createSmtpMailer(config, db),
  google: createGoogleClient(config.GOOGLE_CLIENT_ID, config.GOOGLE_CLIENT_SECRET),
  zoom: createZoomClient(config.ZOOM_CLIENT_ID, config.ZOOM_CLIENT_SECRET),
};
const pipeline = defaultCallPipeline();
const app = await buildApp(deps, pipeline);
const runner = new JobRunner(db, logger);
if (config.JOBS_ENABLED) runner.start(buildJobs(deps, pipeline));

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'shutting down');
  await runner.stop();
  await app.close();
  await db.end();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port: config.PORT, host: '0.0.0.0' });
