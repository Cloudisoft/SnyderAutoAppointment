import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { Badge, Button, ErrorText, Select, Spinner, Textarea, cx } from '../../components/ui';
import { API_BASE, ApiError, api } from '../../lib/api';

interface PublicAppointment {
  business_name: string;
  first_name: string | null;
  appointment_type: string;
  description: string | null;
  starts_at: string;
  ends_at: string;
  duration_minutes: number;
  time_zone: string;
  host_name: string;
  location_type: string;
  location: string;
  join_url: string | null;
  status: string;
  can_modify: boolean;
  calendar: { google: string; outlook: string } | null;
}
interface PublicSlot { host_id: string; start_utc: string; end_utc: string }

const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const zoneLabel = (zone: string, at: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'long' }).formatToParts(new Date(at)).find((p) => p.type === 'timeZoneName')?.value ?? zone;

/** Keeps this page out of search engines and referrer headers. */
function usePrivatePage() {
  useEffect(() => {
    const metas = [
      Object.assign(document.createElement('meta'), { name: 'robots', content: 'noindex, nofollow' }),
      Object.assign(document.createElement('meta'), { name: 'referrer', content: 'no-referrer' }),
    ];
    metas.forEach((m) => document.head.appendChild(m));
    return () => metas.forEach((m) => m.remove());
  }, []);
}

export function PublicAppointmentPage() {
  usePrivatePage();
  const { token = '' } = useParams();
  const qc = useQueryClient();
  const key = ['public-appointment', token];
  const q = useQuery({ queryKey: key, queryFn: () => api.public.get<PublicAppointment>(`/public/appointments/${token}`), retry: false, meta: { silent: true } });
  const [zone, setZone] = useState<string | null>(null);
  const [mode, setMode] = useState<'view' | 'reschedule' | 'cancel'>('view');
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (q.data) document.title = `Your appointment with ${q.data.business_name}`;
  }, [q.data]);

  if (q.isLoading) return <Shell><div className="grid place-items-center py-24"><Spinner /></div></Shell>;
  if (q.error || !q.data) {
    return (
      <Shell>
        <div className="py-16 text-center animate-fade-up">
          <h1 className="text-xl font-semibold">This link isn’t valid</h1>
          <p className="mt-2 text-muted">It may have expired. Please reply to your confirmation email if you need help.</p>
        </div>
      </Shell>
    );
  }
  const a = q.data;
  const z = zone ?? a.time_zone;
  const start = DateTime.fromISO(a.starts_at, { zone: z });
  const end = DateTime.fromISO(a.ends_at, { zone: z });
  const cancelled = a.status === 'cancelled';
  const onDone = (data: PublicAppointment, message: string) => {
    qc.setQueryData(key, data);
    setMode('view');
    setNotice(message);
  };

  return (
    <Shell business={a.business_name}>
      {notice && <div role="status" key={notice} className="mb-4 rounded-lg border border-success/40 bg-success/10 p-3 text-sm animate-pop">{notice}</div>}
      <p className="text-sm text-muted">{a.first_name ? `Hi ${a.first_name},` : 'Hello,'} here are your appointment details.</p>
      <div className="mt-4 rounded-xl border border-border bg-surface p-5 shadow-sm animate-fade-up">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-muted">{a.appointment_type}</p>
            <h1 className={cx('mt-1 text-2xl font-semibold leading-tight', cancelled && 'line-through text-muted')}>{start.toFormat('cccc, LLLL d')}</h1>
            <p className={cx('text-lg', cancelled && 'line-through text-muted')}>{start.toFormat('h:mm a')} – {end.toFormat('h:mm a')}</p>
          </div>
          <StatusBadge status={a.status} />
        </div>
        <label className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted">
          Time zone
          <Select className="h-9 max-w-full flex-1" value={z} onChange={(e) => setZone(e.target.value)} aria-label="Time zone">
            {[...new Set([a.time_zone, browserZone, 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'Europe/London'])].map((tz) => (
              <option key={tz} value={tz}>{zoneLabel(tz, a.starts_at)}</option>
            ))}
          </Select>
        </label>
        <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted">Duration</dt><dd>{a.duration_minutes} minutes</dd>
          <dt className="text-muted">With</dt><dd>{a.host_name}</dd>
          <dt className="text-muted">Where</dt><dd className="break-words"><Linkified text={a.location} /></dd>
        </dl>
        {a.join_url && (
          <a
            href={a.join_url}
            target="_blank"
            rel="noreferrer"
            className="mt-5 flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-primary-fg shadow-sm transition-all duration-200 hover:-translate-y-px hover:bg-primary-hover"
          >
            {a.location_type === 'zoom' ? 'Join Zoom meeting' : a.location_type === 'google_meet' ? 'Join Google Meet' : 'Join meeting'}
          </a>
        )}
        {a.description && <p className="mt-4 text-sm text-muted">{a.description}</p>}
        {a.calendar && (
          <div className="mt-5 flex flex-wrap gap-2">
            <a className="rounded-md border border-border px-3 py-2 text-sm hover:bg-surface-2" href={a.calendar.google} target="_blank" rel="noreferrer">Google Calendar</a>
            <a className="rounded-md border border-border px-3 py-2 text-sm hover:bg-surface-2" href={a.calendar.outlook} target="_blank" rel="noreferrer">Outlook</a>
            <a className="rounded-md border border-border px-3 py-2 text-sm hover:bg-surface-2" href={`${API_BASE}/public/appointments/${token}/invite.ics`}>Apple / .ics</a>
          </div>
        )}
      </div>

      {a.can_modify && mode === 'view' && (
        <div className="mt-4 grid grid-cols-2 gap-2 animate-fade-up [animation-delay:80ms]">
          <Button onClick={() => { setNotice(null); setMode('reschedule'); }}>Reschedule</Button>
          <Button variant="ghost" className="text-danger" onClick={() => { setNotice(null); setMode('cancel'); }}>Cancel</Button>
        </div>
      )}
      {!a.can_modify && !cancelled && <p className="mt-4 text-sm text-muted">This appointment can no longer be changed online.</p>}
      {mode === 'reschedule' && <Reschedule token={token} zone={z} current={a.starts_at} onCancel={() => setMode('view')} onDone={(d) => onDone(d, 'Your appointment has been moved. We’ve emailed you the updated details.')} />}
      {mode === 'cancel' && <Cancel token={token} onBack={() => setMode('view')} onDone={(d) => onDone(d, 'Your appointment has been cancelled. We’ve sent you a confirmation email.')} />}
    </Shell>
  );
}

function Shell({ business, children }: { business?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <div className="h-1 w-full bg-primary" />
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-8 animate-page-in">
        {business && <p className="mb-6 font-display text-lg font-extrabold tracking-tight">{business}</p>}
        {children}
      </main>
      <footer className="flex items-center justify-center gap-2 py-6 text-xs text-muted">
        <img src="/brand/mark.png" alt="" aria-hidden className="h-4 w-auto" />
        Powered by Snyder Automation
      </footer>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'cancelled') return <Badge tone="red">Cancelled</Badge>;
  if (status === 'rescheduled') return <Badge tone="blue">Rescheduled</Badge>;
  if (status === 'completed') return <Badge tone="gray">Completed</Badge>;
  return <Badge tone="green">Confirmed</Badge>;
}

function Linkified({ text }: { text: string }) {
  const m = text.match(/https?:\/\/\S+/);
  if (!m) return <>{text}</>;
  const [before, after] = [text.slice(0, m.index), text.slice((m.index ?? 0) + m[0].length)];
  return <>{before}<a className="text-primary underline" href={m[0]} target="_blank" rel="noreferrer">{m[0]}</a>{after}</>;
}

function Reschedule({ token, zone, current, onCancel, onDone }: { token: string; zone: string; current: string; onCancel(): void; onDone(d: PublicAppointment): void }) {
  const slots = useQuery({ queryKey: ['public-slots', token], queryFn: () => api.public.get<{ slots: PublicSlot[] }>(`/public/appointments/${token}/slots`) });
  const byDay = useMemo(() => {
    const map = new Map<string, PublicSlot[]>();
    for (const s of slots.data?.slots ?? []) {
      const d = DateTime.fromISO(s.start_utc, { zone }).toISODate()!;
      map.set(d, [...(map.get(d) ?? []), s]);
    }
    return map;
  }, [slots.data, zone]);
  const days = [...byDay.keys()];
  const [day, setDay] = useState<string | null>(null);
  const [picked, setPicked] = useState<PublicSlot | null>(null);
  const activeDay = day ?? days[0] ?? null;
  const m = useMutation({
    mutationFn: () => api.public.post<PublicAppointment>(`/public/appointments/${token}/reschedule`, { start_utc: picked!.start_utc, host_id: picked!.host_id }),
    onSuccess: onDone,
    meta: { silent: true },
    onError: () => {
      setPicked(null);
      void slots.refetch();
    },
  });
  return (
    <section className="mt-4 rounded-xl border border-border bg-surface p-4 animate-fade-up">
      <h2 className="font-semibold">Pick a new time</h2>
      <p className="text-xs text-muted">Currently {DateTime.fromISO(current, { zone }).toFormat("ccc, LLL d 'at' h:mm a")}</p>
      {slots.isLoading && <div className="py-6 text-center"><Spinner /></div>}
      {!slots.isLoading && days.length === 0 && <p className="py-4 text-sm text-muted">No other times are open right now.</p>}
      {days.length > 0 && (
        <>
          <div className="-mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Days">
            {days.map((d) => {
              const dt = DateTime.fromISO(d, { zone });
              return (
                <button key={d} role="tab" aria-selected={activeDay === d} onClick={() => { setDay(d); setPicked(null); }}
                  className={cx('min-w-16 shrink-0 rounded-lg border px-3 py-2 text-center text-sm transition-colors duration-150 active:scale-95', activeDay === d ? 'border-primary bg-primary text-primary-fg' : 'border-border')}>
                  <span className="block text-xs">{dt.toFormat('ccc')}</span>
                  <span className="block font-semibold">{dt.toFormat('LLL d')}</span>
                </button>
              );
            })}
          </div>
          <div key={activeDay ?? ''} className="mt-3 grid grid-cols-3 gap-2 stagger">
            {(activeDay ? byDay.get(activeDay) ?? [] : []).map((s, i) => (
              <button key={s.start_utc + s.host_id} onClick={() => setPicked(s)} style={{ ['--i' as string]: i }}
                className={cx('rounded-md border px-2 py-2 text-sm transition-colors duration-150 active:scale-95', picked === s ? 'border-primary bg-primary/10 font-semibold' : 'border-border hover:bg-surface-2')}>
                {DateTime.fromISO(s.start_utc, { zone }).toFormat('h:mm a')}
              </button>
            ))}
          </div>
        </>
      )}
      {m.error && <ErrorText error={m.error instanceof ApiError ? m.error.message : m.error} />}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button onClick={onCancel}>Back</Button>
        <Button variant="primary" disabled={!picked} loading={m.isPending} onClick={() => m.mutate()}>
          {picked ? `Move to ${DateTime.fromISO(picked.start_utc, { zone }).toFormat('ccc h:mm a')}` : 'Choose a time'}
        </Button>
      </div>
    </section>
  );
}

function Cancel({ token, onBack, onDone }: { token: string; onBack(): void; onDone(d: PublicAppointment): void }) {
  const [reason, setReason] = useState('');
  const m = useMutation({ mutationFn: () => api.public.post<PublicAppointment>(`/public/appointments/${token}/cancel`, { reason }), onSuccess: onDone, meta: { silent: true } });
  return (
    <section className="mt-4 rounded-xl border border-border bg-surface p-4 animate-fade-up">
      <h2 className="font-semibold">Cancel this appointment?</h2>
      <label className="mt-3 block text-sm">
        <span className="text-muted">Reason (optional)</span>
        <Textarea className="mt-1" rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <ErrorText error={m.error} />
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button onClick={onBack}>Keep it</Button>
        <Button variant="danger" loading={m.isPending} onClick={() => m.mutate()}>Cancel appointment</Button>
      </div>
    </section>
  );
}
