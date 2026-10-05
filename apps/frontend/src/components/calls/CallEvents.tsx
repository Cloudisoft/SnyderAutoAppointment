import { Badge } from '../ui';
import { formatTime } from '../../lib/format';

export interface CallEvent {
  id: number;
  type: 'status' | 'transcript' | 'tool' | 'booking' | 'system';
  role: string | null;
  content: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

/** Renders a call's event stream: transcript bubbles plus status, tool and booking markers. */
export function CallEventStream({ events }: { events: CallEvent[] }) {
  if (!events.length) return <p className="text-sm text-muted">No activity yet.</p>;
  return (
    <ol className="space-y-2">
      {events.map((e) => {
        if (e.type === 'transcript') {
          const ai = e.role === 'assistant';
          return (
            <li key={e.id} className={ai ? 'flex justify-start' : 'flex justify-end'}>
              <div className={ai ? 'max-w-[85%] rounded-lg bg-surface-2 px-3 py-2 text-sm' : 'max-w-[85%] rounded-lg bg-primary/10 px-3 py-2 text-sm'}>
                <span className="block text-[10px] uppercase tracking-wide text-muted">{ai ? 'AI' : 'Prospect'} · {formatTime(e.created_at)}</span>
                {e.content}
              </div>
            </li>
          );
        }
        if (e.type === 'booking') {
          return (
            <li key={e.id} className="rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-sm">
              <Badge tone="green">Booking</Badge> <span className="ml-1">{e.content}</span>
              <span className="ml-2 text-xs text-muted">{formatTime(e.created_at)}</span>
            </li>
          );
        }
        const failed = e.type === 'tool' && e.metadata?.ok === false;
        return (
          <li key={e.id} className="text-center text-xs text-muted">
            {e.type === 'tool' ? `Tool: ${e.content}${failed ? ' (failed, fallback used)' : ''}` : e.type === 'status' ? `Status: ${e.content}` : e.content}
            {' · '}
            {formatTime(e.created_at)}
          </li>
        );
      })}
    </ol>
  );
}
