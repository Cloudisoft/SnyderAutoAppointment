import type { Deps } from '../../deps';
import type { VapiControl } from '../../integrations/vapi';
import { GOODBYE_LINE, TRANSFER_ANNOUNCEMENT } from '../agents/assistantBuilder';
import { addCallEvent } from './events';

/**
 * Safety nets for live calls. The assistant is told to call its transferCall / endCall tools, but
 * models sometimes only *say* "let me transfer your call" or "goodbye". When that happens the
 * server finishes the job through the call's control URL after a short grace period.
 */
export const liveControlTiming = { transferMs: 4_000, goodbyeMs: 7_000 };

interface MonitorRow {
  call_id: string;
  organization_id: string;
  listen_url: string | null;
  control_url: string | null;
}

export async function getMonitor(deps: Deps, callId: string, organizationId?: string): Promise<MonitorRow | null> {
  const { rows } = await deps.db.query<MonitorRow>(
    `select m.call_id, m.organization_id, m.listen_url, m.control_url
       from call_monitors m join calls c on c.id = m.call_id
      where m.call_id = $1 and ($2::uuid is null or m.organization_id = $2)
        and c.end_processed_at is null and c.status not in ('ended', 'failed')`,
    [callId, organizationId ?? null],
  );
  return rows[0] ?? null;
}

/** Transfer number frozen into the campaign version the call was placed with. */
export async function transferNumberFor(deps: Deps, callId: string): Promise<string | null> {
  const { rows } = await deps.db.query<{ n: string | null }>(
    `select v.snapshot->'agent'->>'transfer_number' as n
       from calls c join campaign_versions v on v.id = c.campaign_version_id where c.id = $1`,
    [callId],
  );
  return rows[0]?.n || null;
}

export async function sendControl(deps: Deps, monitor: MonitorRow, command: VapiControl, note: string) {
  if (!monitor.control_url) throw new Error('This call has no live control link');
  await deps.vapi.controlCall(monitor.control_url, command);
  await addCallEvent(deps.db, { organizationId: monitor.organization_id, callId: monitor.call_id, type: 'status', content: note });
}

/** Called for every final assistant transcript line. Never throws. */
export function watchAssistantLine(deps: Deps, call: { id: string; organization_id: string }, line: string) {
  const log = deps.logger.child({ callId: call.id });
  if (TRANSFER_ANNOUNCEMENT.test(line)) {
    setTimeout(() => void completeTransfer(deps, call.id).catch((err) => log.error({ err }, 'auto transfer failed')), liveControlTiming.transferMs);
  } else if (GOODBYE_LINE.test(line.trim())) {
    const said = new Date();
    setTimeout(() => void completeHangup(deps, call.id, said).catch((err) => log.error({ err }, 'auto hang-up failed')), liveControlTiming.goodbyeMs);
  }
}

async function completeTransfer(deps: Deps, callId: string) {
  const number = await transferNumberFor(deps, callId);
  if (!number) return;
  const { rows } = await deps.db.query<{ transferred: boolean }>('select transferred from calls where id = $1', [callId]);
  if (!rows[0] || rows[0].transferred) return; // the transferCall tool already ran
  // Claim it once, so repeated announcements never trigger a second transfer.
  const claimed = await deps.db.query(
    `update call_monitors set auto_transfer_at = now() where call_id = $1 and auto_transfer_at is null returning call_id`,
    [callId],
  );
  if (!claimed.rowCount) return;
  const monitor = await getMonitor(deps, callId);
  if (!monitor) return;
  await sendControl(deps, monitor, { type: 'transfer', destination: { type: 'number', number } }, `transferring to ${number}`);
  await deps.db.query('update calls set transferred = true where id = $1', [callId]);
}

async function completeHangup(deps: Deps, callId: string, saidAt: Date) {
  // If the person spoke after the goodbye, the conversation is not over.
  const spoke = await deps.db.query(
    `select 1 from call_events where call_id = $1 and type = 'transcript' and role = 'user' and created_at > $2 limit 1`,
    [callId, saidAt],
  );
  if (spoke.rowCount) return;
  const claimed = await deps.db.query(
    `update call_monitors set auto_end_at = now() where call_id = $1 and auto_end_at is null returning call_id`,
    [callId],
  );
  if (!claimed.rowCount) return;
  const monitor = await getMonitor(deps, callId);
  if (!monitor) return; // already ended on its own
  await sendControl(deps, monitor, { type: 'end-call' }, 'call ended after goodbye');
}
