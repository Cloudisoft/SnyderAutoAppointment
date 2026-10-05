import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    globalSetup: ['test/globalSetup.ts'],
    testTimeout: 20_000,
    hookTimeout: 60_000,
    // DB-backed suites share one database (isolated per organization), so keep files serial-safe.
    fileParallelism: false,
  },
});
