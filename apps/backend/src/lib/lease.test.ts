import { afterAll, expect, it } from 'vitest';
import { closeTestPool, describeDb, testPool } from '../../test/helpers/db';
import { acquireLease, releaseLease } from './lease';

describeDb('worker lease', () => {
  afterAll(closeTestPool);
  it('is exclusive until it expires or is released', async () => {
    const db = testPool();
    expect(await acquireLease(db, 'test-lease', 'a', 60_000)).toBe(true);
    expect(await acquireLease(db, 'test-lease', 'b', 60_000)).toBe(false);
    expect(await acquireLease(db, 'test-lease', 'a', 60_000)).toBe(true);
    await releaseLease(db, 'test-lease', 'a');
    expect(await acquireLease(db, 'test-lease', 'b', 1)).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(await acquireLease(db, 'test-lease', 'a', 60_000)).toBe(true);
  });
});
