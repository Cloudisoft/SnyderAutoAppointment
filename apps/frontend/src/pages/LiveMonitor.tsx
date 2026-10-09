import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { CallEventStream, type CallEvent } from '../components/calls/CallEvents';
import { useAuth } from '../auth/AuthProvider';
import { Badge, Button, Card, ConfirmModal, EmptyState, Input, PageHeader, Select } from '../components/ui';
import { LivePcmPlayer, PCM_FORMATS } from '../lib/livePcmPlayer';
import { errorMessage, toast } from '../lib/toast';
import { api } from '../lib/api';
import { formatRelative } from '../lib/format';
import { supabase } from '../lib/supabase';

interface LiveCall {
  id: string;
  status: string;
  started_at: string | null;
  created_at: string;
  to_number: string;
  campaign_name: string | null;
  first_name: string | null;
  last_name: string | null;
  transferred: boolean;
  can_listen: boolean;
  can_control: boolean;
  transfer_number: string | null;
}

export function LiveMonitorPage() {
  const { can } = useAuth();
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
          <ul className="space-y-2 stagger">
            {calls.map((c, i) => (
              <li key={c.id} style={{ ['--i' as string]: i }}>
                <button onClick={() => setSelected(c.id)} className={`w-full rounded-lg border p-3 text-left transition-colors duration-150 ${active === c.id ? 'border-primary bg-primary/5' : 'border-border bg-surface'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 font-medium">
                      {c.status === 'in_progress' && <span aria-hidden className="h-2 w-2 rounded-full bg-success animate-live" />}
                      {[c.first_name, c.last_name].filter(Boolean).join(' ') || c.to_number}
                    </span>
                    <Badge tone={c.transferred ? 'purple' : c.status === 'in_progress' ? 'green' : 'amber'}>{c.transferred ? 'transferred' : c.status.replace('_', ' ')}</Badge>
                  </div>
                  <p className="text-xs text-muted">{c.campaign_name} · {formatRelative(c.started_at ?? c.created_at)}</p>
                </button>
              </li>
            ))}
          </ul>
          {active && (
            <div className="space-y-4">
              {can('monitor.control') && calls.find((c) => c.id === active) && <SupervisorPanel call={calls.find((c) => c.id === active)!} />}
              <LiveTranscript callId={active} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LiveTranscript({ callId }: { callId: string }) {
  const qc = useQueryClient();
  const key = ['monitor-events', callId];
  const events = useQuery({ queryKey: key, queryFn: () => api.get<CallEvent[]>(`/api/monitor/calls/${callId}/events`), refetchInterval: 3_000 });
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

type Control = { action: 'say'; content: string } | { action: 'end' } | { action: 'transfer'; number?: string };

/** Live listen plus supervisor controls: speak into the call, transfer it, or hang up. */
function SupervisorPanel({ call }: { call: LiveCall }) {
  const player = useRef<LivePcmPlayer | null>(null);
  const [listen, setListen] = useState<'off' | 'connecting' | 'live' | 'error'>('off');
  const [formatId, setFormatId] = useState(PCM_FORMATS[0]!.id);
  const [volume, setVolume] = useState(1);
  const [line, setLine] = useState('');
  const [transferTo, setTransferTo] = useState(call.transfer_number ?? '');
  const [confirmEnd, setConfirmEnd] = useState(false);

  useEffect(() => () => player.current?.stop(), []);
  useEffect(() => {
    // Switching calls stops listening to the previous one.
    player.current?.stop();
    player.current = null;
    setListen('off');
    setTransferTo(call.transfer_number ?? '');
  }, [call.id]);

  async function startListening(id = formatId) {
    try {
      const { listenUrl } = await api.get<{ listenUrl: string }>(`/api/monitor/calls/${call.id}/listen`);
      const format = PCM_FORMATS.find((f) => f.id === id)!.format;
      player.current?.stop();
      const p = new LivePcmPlayer(format, (s, detail) => {
        if (s === 'error') toast.error(detail ?? 'Live audio failed.');
        setListen(s === 'closed' ? 'off' : s);
      });
      p.start(listenUrl);
      p.setVolume(volume);
      player.current = p;
    } catch (err) {
      setListen('off');
      toast.error(errorMessage(err));
    }
  }
  function stopListening() {
    player.current?.stop();
    player.current = null;
    setListen('off');
  }

  const control = useMutation({
    mutationFn: (c: Control) => api.post(`/api/monitor/calls/${call.id}/control`, c),
    onSuccess: (_r, c) => {
      toast.success(c.action === 'say' ? 'Message spoken on the call' : c.action === 'end' ? 'Call ended' : 'Transferring the call');
      if (c.action === 'say') setLine('');
      setConfirmEnd(false);
    },
  });

  return (
    <Card
      title={<span className="flex items-center gap-2">Live controls {listen === 'live' && <span className="flex items-center gap-1 text-xs font-medium text-success"><span className="h-2 w-2 rounded-full bg-success animate-live" />Listening</span>}</span>}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <p className="text-sm font-semibold">Listen in</p>
          {!call.can_listen ? (
            <p className="text-sm text-muted">Live audio is available for calls placed after this update.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                {listen === 'off' || listen === 'error' ? (
                  <Button variant="primary" size="sm" onClick={() => void startListening()}>▶ Listen live</Button>
                ) : (
                  <Button size="sm" loading={listen === 'connecting'} onClick={stopListening}>■ Stop</Button>
                )}
                <input
                  type="range" min={0} max={2} step={0.1} value={volume} aria-label="Volume" className="w-24 accent-[var(--primary)]"
                  onChange={(e) => { const v = Number(e.target.value); setVolume(v); player.current?.setVolume(v); }}
                />
              </div>
              <label className="block text-xs text-muted">
                Sounds too fast, slow or robotic? Try another format:
                <Select className="mt-1 h-8 py-0 text-sm" value={formatId} onChange={(e) => { setFormatId(e.target.value); if (listen !== 'off') void startListening(e.target.value); }}>
                  {PCM_FORMATS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                </Select>
              </label>
            </>
          )}
        </div>
        <div className="space-y-3">
          {!call.can_control ? (
            <p className="text-sm text-muted">Call controls are available for calls placed after this update.</p>
          ) : (
            <>
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (line.trim()) control.mutate({ action: 'say', content: line.trim() }); }}>
                <Input placeholder="Type a line for the AI to say now" value={line} onChange={(e) => setLine(e.target.value)} />
                <Button disabled={!line.trim() || control.isPending}>Say</Button>
              </form>
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); control.mutate({ action: 'transfer', number: transferTo.trim() || undefined }); }}>
                <Input type="tel" placeholder="Transfer to number" value={transferTo} onChange={(e) => setTransferTo(e.target.value)} />
                <Button disabled={control.isPending || call.transferred}>Transfer</Button>
              </form>
              <Button variant="danger" size="sm" disabled={control.isPending} onClick={() => setConfirmEnd(true)}>End call</Button>
            </>
          )}
        </div>
      </div>
      <ConfirmModal open={confirmEnd} title="End this call now?" confirmLabel="End call" loading={control.isPending} onClose={() => setConfirmEnd(false)} onConfirm={() => control.mutate({ action: 'end' })}>
        The call is hung up immediately for everyone on it.
      </ConfirmModal>
    </Card>
  );
}
