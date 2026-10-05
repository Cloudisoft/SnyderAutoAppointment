import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { formatRelative } from '../lib/format';

interface InAppNotification {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export function NotificationBell() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<InAppNotification[]>('/api/notifications'),
    refetchInterval: 30_000,
  });
  const markRead = useMutation({
    mutationFn: () => api.post('/api/notifications/read-all'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const unread = (q.data ?? []).filter((n) => !n.read_at).length;
  return (
    <div className="relative">
      <button aria-label="Notifications" className="relative rounded-md px-2 py-1 hover:bg-surface-2" onClick={() => setOpen((o) => !o)}>
        🔔
        {unread > 0 && <span key={unread} className="absolute -right-1 -top-1 rounded-full bg-danger px-1.5 text-[10px] text-white animate-pop">{unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] origin-top-right rounded-lg border border-border bg-surface shadow-lg animate-scale-in">
          <div className="flex items-center justify-between border-b border-border px-3 py-2 text-sm">
            <span className="font-medium">Notifications</span>
            {unread > 0 && <button className="text-primary" onClick={() => markRead.mutate()}>Mark all read</button>}
          </div>
          <ul className="max-h-96 overflow-auto divide-y divide-border">
            {(q.data ?? []).length === 0 && <li className="p-3 text-sm text-muted">Nothing yet.</li>}
            {(q.data ?? []).map((n) => (
              <li key={n.id} className={n.read_at ? 'p-3 text-sm' : 'p-3 text-sm bg-primary/5'}>
                {n.link ? <Link to={n.link} onClick={() => setOpen(false)} className="font-medium hover:underline">{n.title}</Link> : <span className="font-medium">{n.title}</span>}
                {n.body && <p className="text-muted">{n.body}</p>}
                <p className="text-xs text-muted mt-1">{formatRelative(n.created_at)}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
