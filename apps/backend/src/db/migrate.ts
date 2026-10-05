import { createPool } from './pool';
import { runMigrations } from './migrations';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const pool = createPool(url, 1);
try {
  const ran = await runMigrations(pool);
  console.log(ran.length ? `Applied: ${ran.join(', ')}` : 'No pending migrations');
} finally {
  await pool.end();
}
