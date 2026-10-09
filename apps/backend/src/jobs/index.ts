import { randomUUID } from 'node:crypto';
import os from 'node:os';
import type { Deps } from '../deps';
import type { CallPipeline } from '../modules/calls/pipeline';
import { reconcileCallsBatch } from '../modules/calls/reconcile';
import { dialerTick } from '../modules/dialer/dialer';
import { holdExpiryBatch, noShowBatch, reminderSchedulerBatch } from '../modules/appointments/jobs';
import { meetingSyncBatch } from '../modules/meetings/sync';
import { dispatchNotificationsBatch } from '../modules/appointments/notifications/dispatcher';
import type { Job } from './runner';

export const INSTANCE_ID = `${os.hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;

/** Every background job, with intervals from env vars. */
export function buildJobs(deps: Deps, pipeline: CallPipeline): Job[] {
  const c = deps.config;
  return [
    { name: 'dialer', intervalMs: c.DIALER_INTERVAL_MS, run: () => dialerTick(deps, pipeline, INSTANCE_ID) },
    { name: 'call-reconcile', intervalMs: c.CALL_RECONCILE_INTERVAL_MS, run: () => reconcileCallsBatch(deps, pipeline) },
    { name: 'appointment-hold-expiry', intervalMs: c.APPOINTMENT_HOLD_EXPIRY_INTERVAL_MS, run: () => holdExpiryBatch(deps) },
    { name: 'appointment-notification-dispatch', intervalMs: c.APPOINTMENT_NOTIFICATION_DISPATCH_INTERVAL_MS, run: () => dispatchNotificationsBatch(deps) },
    { name: 'appointment-reminders', intervalMs: c.APPOINTMENT_REMINDER_INTERVAL_MS, run: () => reminderSchedulerBatch(deps) },
    { name: 'appointment-no-show', intervalMs: c.APPOINTMENT_NO_SHOW_INTERVAL_MS, run: () => noShowBatch(deps) },
    { name: 'meeting-sync', intervalMs: c.MEETING_SYNC_INTERVAL_MS, run: () => meetingSyncBatch(deps) },
  ];
}
