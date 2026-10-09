import { useQuery } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { AreaTrend } from '../components/charts/AreaTrend';
import { StatTile } from '../components/charts/StatTile';
import { GettingStarted } from '../components/GettingStarted';
import { Badge, Select, Skeleton, cx } from '../components/ui';
import { api } from '../lib/api';
import { formatDuration } from '../lib/format';

export interface DashboardData {
  kpis: Record<string, number>;
  previous?: Record<string, number>;
  daily: ({ day: string } & Record<string, number>)[];
  dispositions: { label: string; key: string | null; n: number }[];
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const RANGES = [
  { value: '1', label: 'Today' },
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
];

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

const icon = (d: string) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>
);
const ICONS = {
  calls: 'M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1.9.4 1.8.7 2.7a2 2 0 01-.5 2.1L8 9.8a16 16 0 006 6l1.3-1.3a2 2 0 012.1-.4c.9.3 1.8.6 2.7.7a2 2 0 011.7 2z',
  connected: 'M20 6L9 17l-5-5',
  time: 'M12 7v5l3 2M12 21a9 9 0 100-18 9 9 0 000 18z',
  booked: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2zm4 10l2 2 4-4',
  show: 'M12 15a3 3 0 100-6 3 3 0 000 6zM2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z',
};

/** Pill-style range picker with a sliding highlight. */
function RangeTabs({ value, onChange }: { value: string; onChange(v: string): void }) {
  const i = Math.max(0, RANGES.findIndex((r) => r.value === value));
  return (
    <div className="relative inline-grid grid-cols-4 rounded-xl border border-border bg-surface p-1 text-sm" role="tablist" aria-label="Date range">
      <span
        aria-hidden
        className="absolute inset-y-1 left-1 rounded-lg bg-primary shadow-sm transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
        style={{ width: 'calc((100% - 0.5rem) / 4)', transform: `translateX(${i * 100}%)` }}
      />
      {RANGES.map((r) => (
        <button
          key={r.value}
          role="tab"
          aria-selected={r.value === value}
          onClick={() => onChange(r.value)}
          className={cx('relative z-10 rounded-lg px-3 py-1.5 font-semibold transition-colors duration-200', r.value === value ? 'text-primary-fg' : 'text-muted hover:text-fg')}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}

/** Calls → connected → booked → completed, as one-hue bars with step conversion. */
function Funnel({ k }: { k: Record<string, number> }) {
  const steps = [
    { label: 'Calls placed', n: k.calls ?? 0 },
    { label: 'Connected', n: k.connected ?? 0 },
    ...('appointments_booked' in k ? [{ label: 'Appointments booked', n: k.appointments_booked ?? 0 }] : []),
    ...('appointments_completed' in k ? [{ label: 'Attended', n: k.appointments_completed ?? 0 }] : []),
  ];
  const top = Math.max(1, steps[0]?.n ?? 0);
  return (
    <ol className="space-y-3">
      {steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1]!.n : null;
        return (
          <li key={s.label} className="space-y-1">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="font-medium">{s.label}</span>
              <span className="tabular-nums">
                <span className="font-display font-bold">{s.n.toLocaleString()}</span>
                {prev !== null && <span className="ml-2 text-xs text-muted">{prev ? pct(s.n / prev) : '—'} of previous</span>}
              </span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full bg-primary bar-grow-x"
                style={{ width: `${Math.max(s.n ? 2 : 0, (s.n / top) * 100)}%`, opacity: 1 - i * 0.18, animationDelay: `${i * 120}ms` }}
              />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Outcomes({ rows }: { rows: DashboardData['dispositions'] }) {
  const total = rows.reduce((s, d) => s + d.n, 0);
  const max = Math.max(1, ...rows.map((r) => r.n));
  if (!rows.length) return <p className="py-6 text-center text-sm text-muted">No call outcomes yet.</p>;
  return (
    <ul className="space-y-2.5 stagger">
      {rows.slice(0, 7).map((d, i) => (
        <li key={d.label} className="group" title={`${d.label}: ${d.n} calls (${total ? pct(d.n / total) : '—'})`}>
          <div className="mb-1 flex justify-between gap-2 text-sm">
            <span className="truncate">{d.label}</span>
            <span className="shrink-0 tabular-nums text-muted"><span className="font-semibold text-fg">{d.n.toLocaleString()}</span> · {total ? pct(d.n / total) : '—'}</span>
          </div>
          <div className="h-2 rounded-full bg-surface-2">
            <div className="h-2 rounded-full bg-primary bar-grow-x transition-opacity group-hover:opacity-80" style={{ width: `${(d.n / max) * 100}%`, animationDelay: `${i * 70}ms` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

interface LiveCall { id: string; first_name: string | null; last_name: string | null; to_number: string; campaign_name: string | null; status: string }
interface Upcoming { id: string; starts_at: string; lead_time_zone: string; first_name: string | null; last_name: string | null; attendee_name: string | null; type_name: string; host_name: string; status: string }

function Panel({ title, action, children, style }: { title: string; action?: ReactNode; children: ReactNode; style?: CSSProperties }) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-4 animate-page-in lift" style={style}>
      <header className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-display font-bold">{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

export function DashboardPage() {
  const { org, can } = useAuth();
  const [days, setDays] = useState('30');
  const [campaign, setCampaign] = useState('');
  const campaigns = useQuery({ queryKey: ['campaigns'], queryFn: () => api.get<{ id: string; name: string }[]>('/api/campaigns') });
  const qs = new URLSearchParams({ days });
  if (campaign) qs.set('campaign_id', campaign);
  const q = useQuery({ queryKey: ['dashboard', qs.toString()], queryFn: () => api.get<DashboardData>(`/api/dashboard?${qs}`) });
  const live = useQuery({ queryKey: ['monitor-live'], queryFn: () => api.get<LiveCall[]>('/api/monitor/live'), enabled: can('monitor.view'), refetchInterval: 10_000, meta: { silent: true } });
  const upcoming = useQuery({
    queryKey: ['upcoming-appointments'],
    enabled: can('appointments.view'),
    meta: { silent: true },
    queryFn: () => api.get<{ rows: Upcoming[] }>(`/api/appointments?from=${encodeURIComponent(new Date().toISOString())}&status=confirmed,rescheduled&limit=5`),
  });
  const k = q.data?.kpis ?? {};
  const p = q.data?.previous;
  const daily = q.data?.daily ?? [];
  const series = (key: string) => daily.map((d) => d[key] ?? 0);
  const liveCalls = (live.data ?? []).filter((c) => c.status === 'in_progress' || c.status === 'ringing');
  const hasAppts = 'appointments_booked' in k;

  return (
    <div className="space-y-6">
      <section className="brand-glow hero-sheen relative overflow-hidden rounded-3xl p-6 text-white md:p-8 animate-page-in">
        <img src="/brand/mark-dark.png" alt="" aria-hidden className="pointer-events-none absolute -right-8 -top-8 h-48 w-auto opacity-15 animate-float" />
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="text-sm font-medium text-white/60">{greeting()}</p>
            <h1 className="mt-1 text-2xl font-extrabold md:text-4xl">{org?.name ?? 'Your workspace'}</h1>
            <p className="mt-2 max-w-xl text-white/70">Your AI agents call, qualify, transfer and book. Here is how it is going.</p>
            <div className="mt-5 flex flex-wrap gap-2">
              {can('campaigns.view') && <Link to="/campaigns" className="rounded-xl bg-[#fe5e01] px-4 py-2 text-sm font-semibold text-[#090d0d] shadow-lg shadow-[#fe5e01]/20 transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#ff7a2e]">Campaigns</Link>}
              {can('monitor.view') && <Link to="/monitor" className="rounded-xl border border-white/20 px-4 py-2 text-sm font-semibold text-white transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/10">Watch live calls</Link>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:min-w-80">
            {can('monitor.view') && (
              <Link to="/monitor" className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur transition-colors hover:bg-white/10">
                <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-white/60">
                  <span className={cx('h-2 w-2 rounded-full', liveCalls.length ? 'bg-[#4ade80] animate-live' : 'bg-white/30')} />Live now
                </p>
                <p className="mt-1 font-display text-3xl font-extrabold tabular-nums">{liveCalls.length}</p>
                <p className="text-xs text-white/60">{liveCalls.length === 1 ? 'call in progress' : 'calls in progress'}</p>
              </Link>
            )}
            {hasAppts && (
              <Link to="/appointments" className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur transition-colors hover:bg-white/10">
                <p className="text-xs font-semibold uppercase tracking-wide text-white/60">Booked · {RANGES.find((r) => r.value === days)?.label.toLowerCase()}</p>
                <p className="mt-1 font-display text-3xl font-extrabold tabular-nums">{(k.appointments_booked ?? 0).toLocaleString()}</p>
                <p className="text-xs text-white/60">appointments</p>
              </Link>
            )}
          </div>
        </div>
      </section>

      <GettingStarted />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <RangeTabs value={days} onChange={setDays} />
        <Select className="max-w-60" value={campaign} onChange={(e) => setCampaign(e.target.value)} aria-label="Campaign">
          <option value="">All campaigns</option>
          {(campaigns.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </div>

      {q.isLoading ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-36 rounded-2xl" />)}</div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile index={0} label="Calls" value={k.calls ?? 0} previous={p?.calls} trend={series('calls')} icon={icon(ICONS.calls)} />
          <StatTile index={1} label="Connected" value={k.connected ?? 0} previous={p?.connected} trend={series('connected')} hint={`${pct(k.connect_rate ?? 0)} connect rate`} icon={icon(ICONS.connected)} />
          <StatTile index={2} label="Avg talk time" value={k.avg_talk_seconds ?? 0} previous={p?.avg_talk_seconds} format={(n) => formatDuration(Math.round(n))} icon={icon(ICONS.time)} />
          {hasAppts ? (
            <StatTile index={3} label="Appointments" value={k.appointments_booked ?? 0} previous={p?.appointments_booked} trend={series('appointments_booked')} hint={`${(k.booked_per_100_connected ?? 0).toFixed(1)} per 100 connected`} icon={icon(ICONS.booked)} />
          ) : (
            <StatTile index={3} label="Connect rate" value={k.connect_rate ?? 0} format={pct} icon={icon(ICONS.show)} />
          )}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
        <Panel title="Calls per day" action={<Badge tone="gray">{(k.calls ?? 0).toLocaleString()} total</Badge>}>
          {q.isLoading ? <Skeleton className="h-56" /> : <AreaTrend label="Calls" data={daily.map((d) => ({ day: d.day, value: d.calls ?? 0 }))} />}
        </Panel>
        <Panel title="Conversion" action={'show_rate' in k && (k.show_rate ?? -1) >= 0 ? <Badge tone="green">{pct(k.show_rate!)} show rate</Badge> : undefined} style={{ animationDelay: '80ms' }}>
          <Funnel k={k} />
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {hasAppts && (
          <Panel title="Appointments booked per day" style={{ animationDelay: '120ms' }}>
            <AreaTrend label="Appointments" height={160} data={daily.map((d) => ({ day: d.day, value: d.appointments_booked ?? 0 }))} />
          </Panel>
        )}
        <Panel title="Call outcomes" action={<Link className="text-sm font-semibold text-primary hover:underline" to="/calls">Call records</Link>} style={{ animationDelay: '160ms' }}>
          <Outcomes rows={q.data?.dispositions ?? []} />
        </Panel>
        {can('appointments.view') && (
          <Panel title="Coming up" action={<Link className="text-sm font-semibold text-primary hover:underline" to="/appointments">All</Link>} style={{ animationDelay: '200ms' }}>
            {(upcoming.data?.rows ?? []).length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">No upcoming appointments.</p>
            ) : (
              <ul className="space-y-2 stagger">
                {upcoming.data!.rows.slice(0, 5).map((a) => {
                  const start = DateTime.fromISO(a.starts_at);
                  return (
                    <li key={a.id}>
                      <Link to={`/appointments?id=${a.id}`} className="flex items-center gap-3 rounded-xl p-2 transition-colors hover:bg-surface-2">
                        <span className="grid w-12 shrink-0 place-items-center rounded-lg bg-primary-soft py-1 text-primary">
                          <span className="text-[10px] font-bold uppercase">{start.toFormat('LLL')}</span>
                          <span className="font-display text-lg font-extrabold leading-none">{start.toFormat('d')}</span>
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold">{[a.first_name, a.last_name].filter(Boolean).join(' ') || a.attendee_name || 'Prospect'}</span>
                          <span className="block truncate text-xs text-muted">{start.toFormat('ccc h:mm a')} · {a.type_name} · {a.host_name}</span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        )}
      </div>
    </div>
  );
}
