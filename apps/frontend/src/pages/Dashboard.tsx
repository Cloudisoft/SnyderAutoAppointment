import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { DailyBars } from '../components/charts/DailyBars';
import { StatTile } from '../components/charts/StatTile';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { GettingStarted } from '../components/GettingStarted';
import { Card, Select, Table, Td } from '../components/ui';
import { api } from '../lib/api';
import { formatDuration } from '../lib/format';

export interface DashboardData {
  kpis: Record<string, number>;
  daily: ({ day: string } & Record<string, number>)[];
  dispositions: { label: string; key: string | null; n: number }[];
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export function DashboardPage() {
  const { org, can } = useAuth();
  const [days, setDays] = useState('30');
  const [campaign, setCampaign] = useState('');
  const campaigns = useQuery({ queryKey: ['campaigns'], queryFn: () => api.get<{ id: string; name: string }[]>('/api/campaigns') });
  const qs = new URLSearchParams({ days });
  if (campaign) qs.set('campaign_id', campaign);
  const q = useQuery({ queryKey: ['dashboard', qs.toString()], queryFn: () => api.get<DashboardData>(`/api/dashboard?${qs}`) });
  const k = q.data?.kpis ?? {};
  const total = (q.data?.dispositions ?? []).reduce((s, d) => s + d.n, 0);
  return (
    <div className="space-y-6">
      <section className="brand-glow relative overflow-hidden rounded-2xl p-6 text-white md:p-8 animate-page-in">
        <img src="/brand/mark-dark.png" alt="" aria-hidden className="pointer-events-none absolute -right-6 -top-6 h-40 w-auto opacity-15 animate-float" />
        <p className="text-sm font-medium text-white/60">{greeting()}</p>
        <h1 className="mt-1 text-2xl font-extrabold md:text-3xl">{org?.name ?? 'Your workspace'}</h1>
        <p className="mt-2 max-w-xl text-white/70">Your AI agents call, qualify, transfer and book. Here is how it is going.</p>
        <div className="mt-5 flex flex-wrap gap-2">
          {can('campaigns.view') && <Link to="/campaigns" className="rounded-lg bg-[#fe5e01] px-4 py-2 text-sm font-semibold text-[#090d0d] transition-all duration-200 hover:-translate-y-px hover:bg-[#ff7a2e]">Campaigns</Link>}
          {can('monitor.view') && <Link to="/monitor" className="rounded-lg border border-white/20 px-4 py-2 text-sm font-semibold text-white transition-all duration-200 hover:-translate-y-px hover:bg-white/10">Watch live calls</Link>}
        </div>
      </section>
      <GettingStarted />
      <div className="flex flex-wrap gap-2">
        <Select className="max-w-40" value={days} onChange={(e) => setDays(e.target.value)} aria-label="Date range">
          <option value="1">Today</option>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </Select>
        <Select className="max-w-60" value={campaign} onChange={(e) => setCampaign(e.target.value)} aria-label="Campaign">
          <option value="">All campaigns</option>
          {(campaigns.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile index={0} label="Calls" value={k.calls ?? 0} />
        <StatTile index={1} label="Connected" value={k.connected ?? 0} hint={`${pct(k.connect_rate ?? 0)} connect rate`} />
        <StatTile index={2} label="Avg talk time" value={k.avg_talk_seconds ?? 0} format={(n) => formatDuration(Math.round(n))} />
        {'appointments_booked' in k && (
          <StatTile index={3} label="Appointments booked" value={k.appointments_booked ?? 0} hint={`${(k.booked_per_100_connected ?? 0).toFixed(1)} per 100 connected calls`} />
        )}
        {'show_rate' in k && <StatTile index={4} label="Show rate" value={k.show_rate == null || k.show_rate < 0 ? '—' : k.show_rate} format={pct} hint="Completed ÷ (completed + no-show)" />}
      </div>
      <Card title="Calls per day">
        <DailyBars label="Calls" data={(q.data?.daily ?? []).map((d) => ({ day: d.day, value: d.calls ?? 0 }))} />
      </Card>
      {'appointments_booked' in k && (
        <Card title="Appointments booked per day">
          <DailyBars label="Appointments" data={(q.data?.daily ?? []).map((d) => ({ day: d.day, value: d.appointments_booked ?? 0 }))} />
        </Card>
      )}
      <Card title="Dispositions">
        <Table head={['Disposition', 'Calls', 'Share']}>
          {(q.data?.dispositions ?? []).map((d) => (
            <tr key={d.label}>
              <Td>{d.label}</Td>
              <Td className="tabular-nums">{d.n}</Td>
              <Td>
                <div className="flex items-center gap-2">
                  <div className="h-2 w-32 rounded-full bg-surface-2"><div className="h-2 rounded-full bg-primary transition-[width] duration-500 ease-out" style={{ width: `${total ? (d.n / total) * 100 : 0}%` }} /></div>
                  <span className="text-xs text-muted tabular-nums">{total ? pct(d.n / total) : '—'}</span>
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
