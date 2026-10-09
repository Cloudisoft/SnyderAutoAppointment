import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Badge, Button, Card, ConfirmModal, SkeletonRows } from '../../components/ui';
import { api } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { toast } from '../../lib/toast';

export interface Integration {
  provider: 'google' | 'zoom';
  label: string;
  available: boolean;
  connected: boolean;
  status: 'connected' | 'error' | null;
  account_email: string | null;
  account_name: string | null;
  last_error: string | null;
  connected_at: string | null;
  redirect_uri: string;
}

const COPY: Record<Integration['provider'], { what: string; icon: string }> = {
  google: {
    what: 'Every booked appointment goes onto this Google Calendar, with the prospect and host invited. Appointment types set to Google Meet get a Meet link automatically.',
    icon: 'M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2zm0 16H5V9h14v11z',
  },
  zoom: {
    what: 'Appointment types set to Zoom get their own Zoom meeting, created on this account and kept in sync when an appointment moves or is cancelled.',
    icon: 'M15 10l4.55-2.28A1 1 0 0121 8.62v6.76a1 1 0 01-1.45.9L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z',
  },
};

export function IntegrationsSettings() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [disconnect, setDisconnect] = useState<Integration | null>(null);
  const list = useQuery({ queryKey: ['integrations'], queryFn: () => api.get<Integration[]>('/api/integrations') });

  // Coming back from Google/Zoom: report the outcome once, then clean the URL.
  useEffect(() => {
    const connected = params.get('connected');
    const error = params.get('error');
    if (!connected && !error) return;
    if (connected) toast.success(`${connected === 'google' ? 'Google Calendar & Meet' : 'Zoom'} connected`);
    if (error) toast.error(error);
    setParams({}, { replace: true });
    void qc.invalidateQueries({ queryKey: ['integrations'] });
  }, [params, setParams, qc]);

  const connect = useMutation({
    mutationFn: (provider: Integration['provider']) => api.post<{ url: string }>(`/api/integrations/${provider}/connect`, { return_to: window.location.origin }),
    onSuccess: ({ url }) => window.location.assign(url),
  });
  const remove = useMutation({
    mutationFn: (provider: Integration['provider']) => api.del(`/api/integrations/${provider}`),
    onSuccess: () => {
      toast.success('Disconnected');
      setDisconnect(null);
      void qc.invalidateQueries({ queryKey: ['integrations'] });
    },
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">Connect your calendar and video meeting accounts so booked appointments are scheduled and meeting links are sent automatically.</p>
      {list.isLoading ? <SkeletonRows rows={3} /> : (
        <div className="grid gap-4 lg:grid-cols-2 stagger">
          {(list.data ?? []).map((i) => (
            <Card key={i.provider}>
              <div className="flex items-start gap-4">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={COPY[i.provider].icon} /></svg>
                </span>
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-display text-lg font-bold">{i.label}</h2>
                    {i.connected ? <Badge tone={i.status === 'error' ? 'red' : 'green'}>{i.status === 'error' ? 'Needs reconnecting' : 'Connected'}</Badge> : <Badge>Not connected</Badge>}
                  </div>
                  <p className="text-sm text-muted">{COPY[i.provider].what}</p>
                  {i.connected && (
                    <p className="text-sm">
                      <span className="font-medium">{i.account_email}</span>
                      {i.connected_at && <span className="text-muted"> · since {formatDate(i.connected_at)}</span>}
                    </p>
                  )}
                  {i.last_error && <p className="text-sm text-danger">{i.last_error}</p>}
                  {!i.available && (
                    <p className="rounded-lg bg-warning/10 p-3 text-sm text-warning">
                      Not available yet: the server needs its {i.provider === 'google' ? 'Google' : 'Zoom'} OAuth app keys. Redirect URL to register: <code className="break-all">{i.redirect_uri}</code>
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2 pt-1">
                    {(!i.connected || i.status === 'error') && (
                      <Button variant="primary" size="sm" disabled={!i.available} loading={connect.isPending && connect.variables === i.provider} onClick={() => connect.mutate(i.provider)}>
                        {i.connected ? 'Reconnect' : 'Connect'}
                      </Button>
                    )}
                    {i.connected && <Button size="sm" onClick={() => setDisconnect(i)}>Disconnect</Button>}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      <ConfirmModal
        open={!!disconnect}
        title={`Disconnect ${disconnect?.label}?`}
        confirmLabel="Disconnect"
        loading={remove.isPending}
        onClose={() => setDisconnect(null)}
        onConfirm={() => disconnect && remove.mutate(disconnect.provider)}
      >
        Existing calendar events and meetings stay as they are. New bookings won’t get {disconnect?.provider === 'zoom' ? 'Zoom meetings' : 'calendar events or Meet links'} until you connect again.
      </ConfirmModal>
    </div>
  );
}
