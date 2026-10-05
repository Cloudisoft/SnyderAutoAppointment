import type { Db } from '../db/pool';
import type { Logger } from '../lib/logger';

/** A background job is a "process one batch" function run on an interval. */
export interface Job {
  name: string;
  intervalMs: number;
  run(): Promise<{ processed?: number; [k: string]: unknown } | void>;
}

/**
 * Runs jobs on timers. Runs of the same job never overlap within an instance, and a Postgres
 * advisory lock ensures only one instance runs a given job at a time.
 */
export class JobRunner {
  private timers = new Map<string, NodeJS.Timeout>();
  private running = new Set<string>();
  private stopped = false;

  constructor(
    private readonly db: Db,
    private readonly logger: Logger,
  ) {}

  start(jobs: Job[]) {
    for (const job of jobs) {
      this.logger.info({ job: job.name, intervalMs: job.intervalMs }, 'job scheduled');
      this.schedule(job, Math.min(job.intervalMs, 2_000));
    }
  }

  private schedule(job: Job, delay: number) {
    if (this.stopped) return;
    const t = setTimeout(async () => {
      await this.runOnce(job);
      this.schedule(job, job.intervalMs);
    }, delay);
    t.unref?.();
    this.timers.set(job.name, t);
  }

  /** Runs one batch of the job if no other run (here or on another instance) is in progress. */
  async runOnce(job: Job): Promise<boolean> {
    if (this.running.has(job.name)) return false;
    this.running.add(job.name);
    const client = await this.db.connect();
    const started = Date.now();
    try {
      const { rows } = await client.query<{ locked: boolean }>('select pg_try_advisory_lock(hashtext($1)) as locked', [
        `job:${job.name}`,
      ]);
      if (!rows[0]?.locked) return false;
      try {
        const result = await job.run();
        if (result && (result.processed ?? 0) > 0) {
          this.logger.info({ job: job.name, ms: Date.now() - started, ...result }, 'job batch processed');
        }
      } finally {
        await client.query('select pg_advisory_unlock(hashtext($1))', [`job:${job.name}`]);
      }
      return true;
    } catch (err) {
      this.logger.error({ err, job: job.name }, 'job batch failed');
      return true;
    } finally {
      client.release();
      this.running.delete(job.name);
    }
  }

  async stop() {
    this.stopped = true;
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    while (this.running.size) await new Promise((r) => setTimeout(r, 50));
  }
}
