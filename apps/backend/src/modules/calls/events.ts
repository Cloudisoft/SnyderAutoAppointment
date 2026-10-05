import type { DbClient } from '../../db/pool';

export type CallEventType = 'status' | 'transcript' | 'tool' | 'booking' | 'system';

export async function addCallEvent(
  db: DbClient,
  e: { organizationId: string; callId: string; type: CallEventType; role?: string | null; content?: string | null; metadata?: Record<string, unknown> },
) {
  await db.query(
    `insert into call_events(organization_id, call_id, type, role, content, metadata) values ($1, $2, $3, $4, $5, $6)`,
    [e.organizationId, e.callId, e.type, e.role ?? null, e.content ?? null, e.metadata ?? {}],
  );
}
