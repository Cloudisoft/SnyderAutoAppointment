import { APPOINTMENT_STATUSES, APPOINTMENT_STATUS_LABELS, type AppointmentStatus } from '@snyder/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { Badge, Button, Card, Drawer, EmptyState, ErrorText, Field, Input, Modal, PageHeader, Select, SkeletonRows, Table, Tabs, Td, Textarea, cx, type BadgeTone } from '../components/ui';
import { ExportButtons } from '../components/ExportButtons';
import { api } from '../lib/api';
import { titleCase } from '../lib/format';
import type { Host } from './settings/AppointmentSettings';

export interface AppointmentListRow {
  id: string;
  status: AppointmentStatus;
  starts_at: string;
  ends_at: string;
  lead_time_zone: string;
  source: string;
  attendee_name: string | null;
  attendee_email: string | null;
  first_name: string | null;
  last_name: string | null;
  lead_email: string | null;
  phone_e164: string | null;
  campaign_name: string | null;
  host_id: string;
  host_name: string;
  type_name: string;
  duration_minutes: number;
  call_id: string | null;
}
interface AppointmentDetail extends AppointmentListRow {
  notes: string | null;
  company: string | null;
  call_summary: string | null;
  cancel_reason: string | null;
  location_type: string;
  location_details: string | null;
  version: number;
  events: { id: number; type: string; actor_type: string; actor_email: string | null; metadata: Record<string, unknown>; created_at: string }[];
  notifications: { id: string; type: string; channel: string; status: string; recipient: string | null; attempts: number; last_error: string | null; sent_at: string | null; send_after: string }[];
}

export const appointmentTone = (s: string): BadgeTone =>
  ({ confirmed: 'green', rescheduled: 'blue', pending: 'amber', needs_review: 'purple', cancelled: 'red', completed: 'gray', no_show: 'red' })[s] as BadgeTone ?? 'gray';

const leadName = (a: Pick<AppointmentListRow, 'first_name' | 'last_name' | 'attendee_name'>) =>
  [a.first_name, a.last_name].filter(Boolean).join(' ') || a.attendee_name || 'Unknown';

export function AppointmentsPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<'list' | 'week' | 'day'>('list');
  const [anchor, setAnchor] = useState(() => DateTime.local().startOf('day'));
  const [filters, setFilters] = useState({ campaign_id: '', host_id: '', status: '', q: '', from: '', to: '' });
  const campaigns = useQuery({ queryKey: ['campaigns'], queryFn: () => api.get<{ id: string; name: string }[]>('/api/campaigns') });
  const hosts = useQuery({ queryKey: ['appointment-hosts'], queryFn: () => api.get<Host[]>('/api/appointment-hosts') });

  const range = useMemo(() => {
    if (view === 'week') return { from: anchor.startOf('week'), to: anchor.startOf('week').plus({ weeks: 1 }) };
    if (view === 'day') return { from: anchor, to: anchor.plus({ days: 1 }) };
    return {
      from: filters.from ? DateTime.fromISO(filters.from) : null,
      to: filters.to ? DateTime.fromISO(filters.to).plus({ days: 1 }) : null,
    };
  }, [view, anchor, filters.from, filters.to]);

  const qs = new URLSearchParams({ limit: '500' });
  for (const k of ['campaign_id', 'host_id', 'status', 'q'] as const) if (filters[k]) qs.set(k, filters[k]);
  if (range.from) qs.set('from', range.from.toISO()!);
  if (range.to) qs.set('to', range.to.toISO()!);
  const list = useQuery({ queryKey: ['appointments', qs.toString()], queryFn: () => api.get<{ rows: AppointmentListRow[]; total: number }>(`/api/appointments?${qs}`) });
  const openId = params.get('id');
  const emailHealth = useQuery({
    queryKey: ['notification-summary'],
    queryFn: () => api.get<{ failed: number; waiting: number }>('/api/appointment-notifications/summary'),
    refetchInterval: 60_000,
  });
  const retryAll = useMutation({
    mutationFn: () => api.post<{ requeued: number }>('/api/appointment-notifications/retry-failed'),
    onSuccess: () => emailHealth.refetch(),
  });
  const exportQs = new URLSearchParams(qs);
  exportQs.delete('limit');

  return (
    <div>
      <PageHeader
        title="Appointments"
        description={list.data ? `${list.data.total} appointments` : undefined}
        actions={
          <ExportButtons path="/api/appointments/export" query={exportQs} name="appointments" />
        }
      />
      {emailHealth.data && (emailHealth.data.waiting > 0 || emailHealth.data.failed > 0) && (
        <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm animate-fade-up">
          <span>
            {emailHealth.data.waiting > 0 && (
              <>
                <strong>{emailHealth.data.waiting}</strong> email{emailHealth.data.waiting === 1 ? ' is' : 's are'} waiting because email isn’t set up. They’ll send automatically once it is.{' '}
                <Link className="underline" to="/settings/email">Set up email</Link>
              </>
            )}
            {emailHealth.data.waiting > 0 && emailHealth.data.failed > 0 && ' · '}
            {emailHealth.data.failed > 0 && (
              <>
                <strong>{emailHealth.data.failed}</strong> email{emailHealth.data.failed === 1 ? '' : 's'} failed to send.
              </>
            )}
          </span>
          {emailHealth.data.failed > 0 && can('appointments.manage') && (
            <Button size="sm" loading={retryAll.isPending} onClick={() => retryAll.mutate()}>Retry all failed emails</Button>
          )}
        </div>
      )}
      {retryAll.data && <p className="mb-3 text-sm text-success animate-fade-in">Retrying {retryAll.data.requeued} emails.</p>}
      <div className="mb-3 flex flex-wrap gap-2">
        <Input className="max-w-xs" placeholder="Search name, email or phone" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
        <Select className="max-w-48" value={filters.campaign_id} onChange={(e) => setFilters({ ...filters, campaign_id: e.target.value })} aria-label="Campaign">
          <option value="">All campaigns</option>
          {(campaigns.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select className="max-w-48" value={filters.host_id} onChange={(e) => setFilters({ ...filters, host_id: e.target.value })} aria-label="Host">
          <option value="">All hosts</option>
          {(hosts.data ?? []).map((h) => <option key={h.id} value={h.id}>{h.display_name}</option>)}
        </Select>
        <Select className="max-w-44" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} aria-label="Status">
          <option value="">All statuses</option>
          {APPOINTMENT_STATUSES.map((s) => <option key={s} value={s}>{APPOINTMENT_STATUS_LABELS[s]}</option>)}
        </Select>
        {view === 'list' && (
          <>
            <Input type="date" className="max-w-40" aria-label="From date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
            <Input type="date" className="max-w-40" aria-label="To date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
          </>
        )}
      </div>
      <Tabs value={view} onChange={setView} tabs={[{ value: 'list', label: 'List' }, { value: 'week', label: 'Week' }, { value: 'day', label: 'Day' }]} />
      {view !== 'list' && (
        <div className="mb-3 flex items-center gap-2">
          <Button size="sm" onClick={() => setAnchor(anchor.minus(view === 'week' ? { weeks: 1 } : { days: 1 }))}>‹</Button>
          <Button size="sm" onClick={() => setAnchor(DateTime.local().startOf('day'))}>Today</Button>
          <Button size="sm" onClick={() => setAnchor(anchor.plus(view === 'week' ? { weeks: 1 } : { days: 1 }))}>›</Button>
          <span className="text-sm font-medium">
            {view === 'week' ? `${range.from!.toFormat('LLL d')} – ${range.to!.minus({ days: 1 }).toFormat('LLL d, yyyy')}` : anchor.toFormat('cccc, LLL d, yyyy')}
          </span>
        </div>
      )}
      {view === 'list' ? (
        list.isLoading ? <SkeletonRows /> : list.data?.rows.length === 0 ? <EmptyState title="No appointments match" /> : (
          <Table head={['When (your time)', 'Lead', 'Host', 'Campaign', 'Status', 'Source']}>
            {(list.data?.rows ?? []).map((a) => (
              <tr key={a.id} className="cursor-pointer hover:bg-surface-2" onClick={() => setParams({ id: a.id })}>
                <Td className="whitespace-nowrap">{DateTime.fromISO(a.starts_at).toFormat('ccc LLL d, h:mm a')}</Td>
                <Td><span className="font-medium">{leadName(a)}</span><span className="block text-xs text-muted">{a.attendee_email ?? a.lead_email ?? a.phone_e164}</span></Td>
                <Td>{a.host_name}</Td>
                <Td>{a.campaign_name ?? '—'}</Td>
                <Td><Badge tone={appointmentTone(a.status)}>{APPOINTMENT_STATUS_LABELS[a.status]}</Badge></Td>
                <Td className="text-xs text-muted">{titleCase(a.source)}</Td>
              </tr>
            ))}
          </Table>
        )
      ) : (
        <CalendarGrid days={view === 'week' ? 7 : 1} from={range.from!} rows={list.data?.rows ?? []} onOpen={(id) => setParams({ id })} />
      )}
      <Drawer open={!!openId} onClose={() => setParams({})} title="Appointment">
        {openId && <AppointmentDetails id={openId} canManage={can('appointments.manage')} />}
      </Drawer>
    </div>
  );
}

const HOUR_START = 7;
const HOUR_END = 21;
const HOUR_PX = 48;

function CalendarGrid({ days, from, rows, onOpen }: { days: number; from: DateTime; rows: AppointmentListRow[]; onOpen(id: string): void }) {
  const cols = Array.from({ length: days }, (_, i) => from.plus({ days: i }));
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <div className="grid min-w-[640px]" style={{ gridTemplateColumns: `56px repeat(${days}, minmax(0, 1fr))` }}>
        <div />
        {cols.map((d) => (
          <div key={d.toISODate()} className={cx('border-b border-l border-border px-2 py-2 text-center text-xs', d.hasSame(DateTime.local(), 'day') && 'text-primary font-semibold')}>
            {d.toFormat('ccc LLL d')}
          </div>
        ))}
        <div className="relative">
          {Array.from({ length: HOUR_END - HOUR_START }, (_, i) => (
            <div key={i} className="pr-1 text-right text-[10px] text-muted" style={{ height: HOUR_PX }}>{DateTime.fromObject({ hour: HOUR_START + i }).toFormat('h a')}</div>
          ))}
        </div>
        {cols.map((d) => {
          const items = rows.filter((a) => DateTime.fromISO(a.starts_at).hasSame(d, 'day'));
          return (
            <div key={d.toISODate()} className="relative border-l border-border" style={{ height: (HOUR_END - HOUR_START) * HOUR_PX }}>
              {Array.from({ length: HOUR_END - HOUR_START }, (_, i) => <div key={i} className="border-t border-border/60" style={{ height: HOUR_PX }} />)}
              {items.map((a) => {
                const s = DateTime.fromISO(a.starts_at);
                const e = DateTime.fromISO(a.ends_at);
                const top = Math.max(0, (s.hour + s.minute / 60 - HOUR_START) * HOUR_PX);
                const height = Math.max(20, e.diff(s, 'hours').hours * HOUR_PX - 2);
                return (
                  <button
                    key={a.id}
                    onClick={() => onOpen(a.id)}
                    className={cx('absolute left-1 right-1 overflow-hidden rounded-md border px-1.5 py-0.5 text-left text-[11px] leading-tight animate-scale-in transition-shadow hover:shadow-md hover:z-10',
                      a.status === 'cancelled' ? 'border-border bg-surface-2 text-muted line-through' : a.status === 'needs_review' ? 'border-purple-400/50 bg-purple-500/15' : 'border-primary/40 bg-primary/15')}
                    style={{ top, height }}
                    title={`${leadName(a)} · ${a.host_name}`}
                  >
                    <span className="font-semibold">{s.toFormat('h:mm')}</span> {leadName(a)}
                    <span className="block text-muted">{a.host_name}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AppointmentDetails({ id, canManage }: { id: string; canManage: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['appointment', id], queryFn: () => api.get<AppointmentDetail>(`/api/appointments/${id}`) });
  const [modal, setModal] = useState<'reschedule' | 'cancel' | 'confirm' | null>(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['appointment', id] });
    qc.invalidateQueries({ queryKey: ['appointments'] });
    setModal(null);
  };
  const status = useMutation({ mutationFn: (s: 'completed' | 'no_show') => api.post(`/api/appointments/${id}/status`, { status: s }), onSuccess: refresh });
  const resend = useMutation({ mutationFn: () => api.post(`/api/appointments/${id}/resend-confirmation`), onSuccess: refresh });
  const a = q.data;
  if (!a) return null;
  const active = a.status === 'confirmed' || a.status === 'rescheduled';
  const start = DateTime.fromISO(a.starts_at);
  const leadLocal = DateTime.fromISO(a.starts_at, { zone: a.lead_time_zone });

  return (
    <>
      <div className="flex items-center gap-2">
        <Badge tone={appointmentTone(a.status)}>{APPOINTMENT_STATUS_LABELS[a.status]}</Badge>
        <span className="text-xs text-muted">{titleCase(a.source)} · v{a.version}</span>
      </div>
      <div>
        <p className="text-lg font-semibold">{start.toFormat('cccc, LLLL d')} · {start.toFormat('h:mm a')}</p>
        <p className="text-sm text-muted">Prospect’s time: {leadLocal.toFormat("ccc h:mm a ZZZZ")} · {a.duration_minutes} min {a.type_name}</p>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted">Lead</dt><dd>{leadName(a)}{a.company && <span className="text-muted"> · {a.company}</span>}</dd>
        <dt className="text-muted">Email</dt><dd>{a.attendee_email ?? a.lead_email ?? '—'}</dd>
        <dt className="text-muted">Phone</dt><dd>{a.phone_e164 ?? '—'}</dd>
        <dt className="text-muted">Host</dt><dd>{a.host_name}</dd>
        <dt className="text-muted">Campaign</dt><dd>{a.campaign_name ?? '—'}</dd>
        {a.call_id && (<><dt className="text-muted">Call</dt><dd><Link className="text-primary underline" to={`/calls?call=${a.call_id}`}>View call</Link></dd></>)}
        {a.notes && (<><dt className="text-muted">Notes</dt><dd>{a.notes}</dd></>)}
        {a.cancel_reason && (<><dt className="text-muted">Cancel reason</dt><dd>{a.cancel_reason}</dd></>)}
      </dl>
      {a.call_summary && <Card title="Call summary"><p className="text-sm">{a.call_summary}</p></Card>}
      {canManage && (
        <div className="flex flex-wrap gap-2">
          {a.status === 'needs_review' && <Button variant="primary" onClick={() => setModal('confirm')}>Confirm & send email</Button>}
          {active && <Button onClick={() => setModal('reschedule')}>Reschedule</Button>}
          {(active || a.status === 'needs_review' || a.status === 'pending') && <Button variant="ghost" className="text-danger" onClick={() => setModal('cancel')}>Cancel</Button>}
          {(active || a.status === 'no_show') && <Button onClick={() => status.mutate('completed')} loading={status.isPending}>Mark completed</Button>}
          {(active || a.status === 'completed') && <Button onClick={() => status.mutate('no_show')}>Mark no-show</Button>}
          {active && <Button variant="ghost" loading={resend.isPending} onClick={() => resend.mutate()}>Resend confirmation</Button>}
        </div>
      )}
      <ErrorText error={status.error ?? resend.error} />
      <Card title="Emails">
        <ul className="space-y-2 text-sm">
          {a.notifications.length === 0 && <li className="text-muted">None yet.</li>}
          {a.notifications.map((n) => (
            <li key={n.id}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{titleCase(n.type)}</span>
                <Badge tone={n.status === 'sent' ? 'green' : n.status === 'failed' ? 'red' : n.status === 'skipped' || n.status === 'cancelled' ? 'gray' : 'amber'}>{n.status}</Badge>
                <span className="text-xs text-muted">{n.channel} · {n.recipient ?? 'no recipient'}</span>
              </div>
              {n.last_error && <p className="text-xs text-danger">{n.last_error}</p>}
              <p className="text-xs text-muted">{n.sent_at ? `Sent ${DateTime.fromISO(n.sent_at).toRelative()}` : `Due ${DateTime.fromISO(n.send_after).toFormat('LLL d, h:mm a')}`}{n.attempts > 1 && ` · ${n.attempts} attempts`}</p>
            </li>
          ))}
        </ul>
      </Card>
      <Card title="History">
        <ol className="space-y-1 text-sm">
          {a.events.map((e) => (
            <li key={e.id} className="flex justify-between gap-2">
              <span>{titleCase(e.type)} <span className="text-muted">by {e.actor_email ?? e.actor_type}</span>{typeof e.metadata.error === 'string' && <span className="block text-xs text-danger">{e.metadata.error}</span>}</span>
              <span className="whitespace-nowrap text-xs text-muted">{DateTime.fromISO(e.created_at).toFormat('LLL d, h:mm a')}</span>
            </li>
          ))}
        </ol>
      </Card>
      {modal === 'reschedule' && <RescheduleModal appt={a} onClose={() => setModal(null)} onDone={refresh} />}
      {modal === 'cancel' && <CancelModal id={id} onClose={() => setModal(null)} onDone={refresh} />}
      {modal === 'confirm' && <ConfirmModal appt={a} onClose={() => setModal(null)} onDone={refresh} />}
    </>
  );
}

function RescheduleModal({ appt, onClose, onDone }: { appt: AppointmentDetail; onClose(): void; onDone(): void }) {
  const slots = useQuery({ queryKey: ['appointment-slots', appt.id], queryFn: () => api.get<{ hostId: string; startUtc: string; displayLabel: string }[]>(`/api/appointments/${appt.id}/slots`) });
  const [pick, setPick] = useState('');
  const m = useMutation({
    mutationFn: () => {
      const s = slots.data!.find((x) => `${x.hostId}|${x.startUtc}` === pick)!;
      return api.post(`/api/appointments/${appt.id}/reschedule`, { start_utc: s.startUtc, host_id: s.hostId });
    },
    onSuccess: onDone,
  });
  return (
    <Modal open onClose={onClose} title="Reschedule" footer={<Button variant="primary" disabled={!pick} loading={m.isPending} onClick={() => m.mutate()}>Reschedule & email prospect</Button>}>
      <Field label="New time (prospect’s time zone)">
        <Select value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">{slots.isLoading ? 'Loading open times…' : 'Choose an open time'}</option>
          {(slots.data ?? []).map((s) => <option key={`${s.hostId}|${s.startUtc}`} value={`${s.hostId}|${s.startUtc}`}>{s.displayLabel}</option>)}
        </Select>
      </Field>
      <ErrorText error={m.error} />
    </Modal>
  );
}

function CancelModal({ id, onClose, onDone }: { id: string; onClose(): void; onDone(): void }) {
  const [reason, setReason] = useState('');
  const m = useMutation({ mutationFn: () => api.post(`/api/appointments/${id}/cancel`, { reason }), onSuccess: onDone });
  return (
    <Modal open onClose={onClose} title="Cancel appointment" footer={<Button variant="danger" loading={m.isPending} onClick={() => m.mutate()}>Cancel appointment</Button>}>
      <p className="text-sm text-muted">The prospect is emailed a cancellation (with a calendar cancel) if the appointment was confirmed.</p>
      <Field label="Reason (optional)"><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <ErrorText error={m.error} />
    </Modal>
  );
}

function ConfirmModal({ appt, onClose, onDone }: { appt: AppointmentDetail; onClose(): void; onDone(): void }) {
  const [email, setEmail] = useState(appt.attendee_email ?? appt.lead_email ?? '');
  const m = useMutation({ mutationFn: () => api.post(`/api/appointments/${appt.id}/confirm`, email ? { attendee_email: email } : {}), onSuccess: onDone });
  return (
    <Modal open onClose={onClose} title="Confirm appointment" footer={<Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>Confirm & send email</Button>}>
      <p className="text-sm">
        Detected from the call transcript: <strong>{DateTime.fromISO(appt.starts_at, { zone: appt.lead_time_zone }).toFormat("cccc, LLLL d 'at' h:mm a ZZZZ")}</strong>. Check the call before confirming.
      </p>
      <Field label="Prospect email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      <ErrorText error={m.error} />
    </Modal>
  );
}
