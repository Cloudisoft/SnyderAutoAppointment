import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import type { Db } from '../db/pool';
import { testConfig, testDeps } from '../../test/helpers/deps';

describe('serving the web app', () => {
  it('serves assets, falls back to index.html for app routes and keeps API 404s as JSON', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'dist-'));
    writeFileSync(path.join(dir, 'index.html'), '<html>app</html>');
    writeFileSync(path.join(dir, 'robots.txt'), 'User-agent: *');
    const app = await buildApp(testDeps({ db: {} as Db, config: { ...testConfig(), FRONTEND_DIST_DIR: dir } }));
    expect((await app.inject({ method: 'GET', url: '/a/some-token' })).body).toBe('<html>app</html>');
    expect((await app.inject({ method: 'GET', url: '/settings/appointments' })).body).toBe('<html>app</html>');
    expect((await app.inject({ method: 'GET', url: '/robots.txt' })).body).toBe('User-agent: *');
    const api = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(api.statusCode).toBe(404);
    expect(api.json().error).toBe('not_found');
    expect((await app.inject({ method: 'GET', url: '/health' })).json()).toEqual({ ok: true });
  });
});
