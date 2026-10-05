import { randomUUID } from 'node:crypto';
import os from 'node:os';
import type { Deps } from '../deps';
import type { CallPipeline } from '../modules/calls/pipeline';
import { reconcileCallsBatch } from '../modules/calls/reconcile';
import { dialerTick } from '../modules/dialer/dialer';
import type { Job } from './runner';

export const INSTANCE_ID = `${os.hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;

/** Every background job, with intervals from env vars. */
export function buildJobs(deps: Deps, pipeline: CallPipeline): Job[] {
  const c = deps.config;
  return [
    { name: 'dialer', intervalMs: c.DIALER_INTERVAL_MS, run: () => dialerTick(deps, pipeline, INSTANCE_ID) },
    { name: 'call-reconcile', intervalMs: c.CALL_RECONCILE_INTERVAL_MS, run: () => reconcileCallsBatch(deps, pipeline) },
  ];
}
