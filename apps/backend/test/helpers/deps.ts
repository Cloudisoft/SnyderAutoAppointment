import type { Config } from '../../src/config';
import { loadConfig } from '../../src/config';
import type { Deps } from '../../src/deps';
import type { AuthVerifier, SupabaseAdmin } from '../../src/integrations/supabase';
import { fixedClock } from '../../src/lib/clock';
import { createLogger } from '../../src/lib/logger';
import { createAuthUser, testPool } from './db';
import { FakeMailer, FakeOpenAi, FakeVapi, fakeCartesia, fakeTwilio } from './fakes';

export const TEST_WEBHOOK_SECRET = 'test-vapi-webhook-secret-0123456789';

export function testConfig(overrides: Partial<Record<keyof Config, string>> = {}): Config {
  return loadConfig({
    NODE_ENV: 'test',
    SUPABASE_URL: 'http://supabase.test',
    SUPABASE_ANON_KEY: 'anon',
    SUPABASE_SERVICE_ROLE_KEY: 'service',
    DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://unused',
    VAPI_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
    BACKEND_PUBLIC_URL: 'https://api.example.test',
    APPOINTMENTS_PUBLIC_URL: 'https://book.example.test',
    APP_PUBLIC_URL: 'https://app.example.test',
    ...overrides,
  });
}

/** Tokens look like "test:<userId>" in tests. */
export const fakeAuth: AuthVerifier = {
  async verify(token) {
    return token.startsWith('test:') ? { id: token.slice(5), email: null } : null;
  },
};

export const fakeSupabaseAdmin: SupabaseAdmin = {
  async inviteUser(email) {
    const u = await createAuthUser(testPool(), email);
    return { id: u.id, email };
  },
};

export function bearerFor(userId: string) {
  return { authorization: `Bearer test:${userId}` };
}

export function testDeps(overrides: Partial<Deps> = {}): Deps {
  return {
    config: testConfig(),
    db: overrides.db ?? testPool(),
    logger: createLogger('silent'),
    clock: fixedClock('2026-10-12T14:00:00Z'),
    auth: fakeAuth,
    supabaseAdmin: fakeSupabaseAdmin,
    vapi: new FakeVapi(),
    cartesia: fakeCartesia,
    twilio: fakeTwilio,
    openai: new FakeOpenAi(),
    mailer: new FakeMailer(),
    ...overrides,
  };
}
