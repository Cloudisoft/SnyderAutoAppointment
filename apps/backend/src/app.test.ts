import { describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { createLogger } from './lib/logger';
import { systemClock } from './lib/clock';
import { testConfig } from '../test/helpers/deps';
import type { Db } from './db/pool';

describe('app', () => {
  it('serves /health', async () => {
    const app = await buildApp({
      config: testConfig(),
      db: {} as Db,
      logger: createLogger('silent'),
      clock: systemClock,
    });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});
