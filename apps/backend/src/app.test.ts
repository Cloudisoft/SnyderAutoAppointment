import { describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { testDeps } from '../test/helpers/deps';
import type { Db } from './db/pool';

describe('app', () => {
  it('serves /health', async () => {
    const app = await buildApp(testDeps({ db: {} as Db }));
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});
