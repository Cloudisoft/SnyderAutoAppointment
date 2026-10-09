import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const intMs = (fallback: number) =>
  z.coerce.number().int().positive().optional().transform((v) => v ?? fallback);

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(8080),
  LOG_LEVEL: z.string().default('info'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),

  // Supabase (server side only; the service role key never leaves the backend)
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  DATABASE_URL: z.string().min(1),

  // Vapi / voice / telephony
  VAPI_API_KEY: z.string().default(''),
  VAPI_WEBHOOK_SECRET: z.string().min(16, 'VAPI_WEBHOOK_SECRET must be at least 16 characters'),
  BACKEND_PUBLIC_URL: z.string().url(),
  CARTESIA_API_KEY: z.string().default(''),
  TWILIO_ACCOUNT_SID: z.string().default(''),
  TWILIO_AUTH_TOKEN: z.string().default(''),
  OPENAI_API_KEY: z.string().default(''),

  // Email
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().default(''),
  SMTP_PASSWORD: z.string().default(''),
  SMTP_FROM_EMAIL: z.string().default(''),
  SMTP_FROM_NAME: z.string().default(''),
  // Platform email through an HTTPS email API (used for every organization that hasn't set up its own).
  PLATFORM_EMAIL_TRANSPORT: z.enum(['', 'resend', 'sendgrid', 'postmark', 'brevo']).default(''),
  PLATFORM_EMAIL_API_KEY: z.string().default(''),
  PLATFORM_EMAIL_FROM: z.string().default(''),
  PLATFORM_EMAIL_FROM_NAME: z.string().default(''),

  // Serve the built web app from this process (single-service deploys). Path to apps/frontend/dist.
  FRONTEND_DIST_DIR: z.string().optional(),

  // Frontend origin used for links into the app (call details, appointment pages)
  APP_PUBLIC_URL: z.string().url().default('http://localhost:5173'),

  // Jobs
  JOBS_ENABLED: z
    .string()
    .optional()
    .transform((v) => v !== 'false'),
  DIALER_INTERVAL_MS: intMs(5_000),
  CALL_RECONCILE_INTERVAL_MS: intMs(60_000),

  // Auto appointments
  APPOINTMENTS_PUBLIC_URL: z.string().url().default('http://localhost:5173'),
  APPOINTMENT_HOLD_EXPIRY_INTERVAL_MS: intMs(60_000),
  APPOINTMENT_NOTIFICATION_DISPATCH_INTERVAL_MS: intMs(15_000),
  APPOINTMENT_REMINDER_INTERVAL_MS: intMs(60_000),
  APPOINTMENT_NO_SHOW_INTERVAL_MS: intMs(300_000),
  SMS_APPOINTMENTS_ENABLED: bool,

  // Calendar and video meetings (OAuth apps owned by the platform; each organization connects its own account)
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  ZOOM_CLIENT_ID: z.string().default(''),
  ZOOM_CLIENT_SECRET: z.string().default(''),
  MEETING_SYNC_INTERVAL_MS: intMs(60_000),
});

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
