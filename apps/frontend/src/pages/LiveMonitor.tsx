import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { CallEventStream, type CallEvent } from '../components/calls/CallEvents';
import { Badge, Card, EmptyState, PageHeader } from '../components/ui';
import { api } from '../lib/api';
import { formatRelative } from '../lib/format';
import { supabase } from '../lib/supabase';

interface LiveCall { id: string; status: string; started_at: string | null; created_at: string; to_number: string; campaign_name: string | null; first_name: string | null; last_name: string | null }

export function LiveMonitorPage() {
  const live = useQuery({ queryKey: ['monitor-live'], queryFn: () => api.get<LiveCall[]>('/api/monitor/live'), refetchInterval: 5_000 });
  const [selected, setSelected] = useState<string | null>(null);
  const calls = live.data ?? [];
  const active = selected ?? calls[0]?.id ?? null;
  return (
    <div>
      <PageHeader title="Live monitor" description={`${calls.length} calls in progress`} />
      {calls.length === 0 ? (
        <EmptyState title="No live calls right now" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <ul className="space-y-2">
            {calls.map((c) => (
              <li key={c.id}>
                <button onClick={() => setSelected(c.id)} className={`w-full rounded-lg border p-3 text-left ${active === c.id ? 'border-primary bg-primary/5' : 'border-border bg-surface'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{[c.first_name, c.last_name].filter(Boolean).join(' ') || c.to_number}</span>
                    <Badge tone={c.status === 'in_progress' ? 'green' : 'amber'}>{c.status.replace('_', ' ')}</Badge>
                  </div>
                  <p className="text-xs text-muted">{c.campaign_name} · {formatRelative(c.started_at ?? c.created_at)}</p>
                </button>
              </li>
            ))}
          </ul>
          {active && <LiveTranscript callId={active} />}
        </div>
      )}
    </div>
  );
}

function LiveTranscript({ callId }: { callId: string }) {
  const qc = useQueryClient();
  const key = ['monitor-events', callId];
  const events = useQuery({ queryKey: key, queryFn: () => api.get<CallEvent[]>(`/api/monitor/calls/${callId}/events`), refetchInterval: 10_000 });
  useEffect(() => {
    // Realtime push of new events (RLS applies to the anon-key client).
    const channel = supabase
      .channel(`call-events-${callId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'call_events', filter: `call_id=eq.${callId}` }, (payload) => {
        qc.setQueryData<CallEvent[]>(key, (old = []) => (old.some((e) => e.id === (payload.new as CallEvent).id) ? old : [...old, payload.new as CallEvent]));
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [callId]);
  return (
    <Card title="Live transcript">
      <div className="max-h-[70vh] overflow-auto"><CallEventStream events={events.data ?? []} /></div>
    </Card>
  );
}
