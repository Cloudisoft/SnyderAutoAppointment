import { useQuery } from '@tanstack/react-query';
import { Button, Card, SkeletonRows, cx } from '../../components/ui';
import { api } from '../../lib/api';

interface Check { ok: boolean; message: string }
interface Health {
  vapi: Check;
  cartesia: Check;
  twilio: (Check & { id: string | null; name: string })[];
  email: Check;
  webhook: Check;
}

export function ConnectionsSettings() {
  const q = useQuery({ queryKey: ['integrations-health'], queryFn: () => api.get<Health>('/api/integrations/health'), staleTime: 0 });
  const rows: [string, string, Check][] = q.data
    ? [
        ['Vapi', 'Places the calls, runs the conversation and live transcripts', q.data.vapi],
        ['Cartesia', 'Voices (sonic-3)', q.data.cartesia],
        ...q.data.twilio.map((t): [string, string, Check] => [`Twilio · ${t.name}`, 'Phone numbers and caller ID', t]),
        ['Email (SMTP)', 'Confirmations, reminders and reschedule links', q.data.email],
        ['Webhook URL', 'Where Vapi sends call events (set automatically on every call)', q.data.webhook],
      ]
    : [];
  return (
    <Card title="Connections" actions={<Button size="sm" loading={q.isFetching} onClick={() => void q.refetch()}>Re-check</Button>}>
      <p className="mb-4 text-sm text-muted">Live checks using the server’s keys. Fix anything red before starting a campaign.</p>
      {q.isLoading ? <SkeletonRows rows={4} /> : (
        <ul className="divide-y divide-border stagger">
          {rows.map(([name, what, c]) => (
            <li key={name} className="flex items-start gap-3 py-3">
              <span className={cx('mt-1 h-2.5 w-2.5 shrink-0 rounded-full', c.ok ? 'bg-success animate-live' : 'bg-danger')} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{name}</p>
                <p className="text-xs text-muted">{what}</p>
              </div>
              <p className={cx('max-w-[55%] break-words text-right text-sm', c.ok ? 'text-success' : 'text-danger')}>{c.message}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
