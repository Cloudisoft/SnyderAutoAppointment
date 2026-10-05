import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { DateTime } from 'luxon';
import { Link, useSearchParams } from 'react-router-dom';
import { CallEventStream, type CallEvent } from '../components/calls/CallEvents';
import { Badge, Card, Drawer, EmptyState, Input, PageHeader, Select, Table, Td } from '../components/ui';
import { api } from '../lib/api';
import { formatDateTime, formatDuration } from '../lib/format';

export interface CallListRow {
  id: string;
  created_at: string;
  duration_seconds: number | null;
  status: string;
  connected: boolean;
  disposition_key: string | null;
  disposition_label: string | null;
  to_number: string;
  campaign_name: string | null;
  first_name: string | null;
  last_name: string | null;
  appointment: { id: string; status: string; starts_at: string; lead_time_zone: string } | null;
}

interface CallDetail extends CallListRow {
  summary: string | null;
  recording_url: string | null;
  ended_reason: string | null;
  campaign_version: number | null;
  email: string | null;
  lead_status: string | null;
  events: CallEvent[];
}

export const dispositionTone = (k: string | null) =>
  k === 'appointment_booked' ? 'green' : k === 'do_not_call' ? 'red' : k === 'call_connected' || k === 'transferred' ? 'blue' : 'gray';

export function CallsPage() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [campaign, setCampaign] = useState('');
  const [disposition, setDisposition] = useState('');
  const openId = params.get('call');
  const campaigns = useQuery({ queryKey: ['campaigns'], queryFn: () => api.get<{ id: string; name: string }[]>('/api/campaigns') });
  const dispositions = useQuery({ queryKey: ['dispositions'], queryFn: () => api.get<{ key: string; label: string }[]>('/api/dispositions') });
  const qs = new URLSearchParams({ limit: '100' });
  if (q) qs.set('q', q);
  if (campaign) qs.set('campaign_id', campaign);
  if (disposition) qs.set('disposition', disposition);
  const calls = useQuery({ queryKey: ['calls', qs.toString()], queryFn: () => api.get<{ rows: CallListRow[]; total: number }>(`/api/calls?${qs}`) });

  return (
    <div>
      <PageHeader title="Call records" description={calls.data ? `${calls.data.total} calls` : undefined} />
      <div className="mb-4 flex flex-wrap gap-2">
        <Input className="max-w-xs" placeholder="Search name, email or phone" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select className="max-w-52" value={campaign} onChange={(e) => setCampaign(e.target.value)}>
          <option value="">All campaigns</option>
          {(campaigns.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select className="max-w-52" value={disposition} onChange={(e) => setDisposition(e.target.value)}>
          <option value="">All dispositions</option>
          {(dispositions.data ?? []).map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
        </Select>
      </div>
      {calls.data?.rows.length === 0 ? (
        <EmptyState title="No calls yet" />
      ) : (
        <Table head={['When', 'Lead', 'Number', 'Campaign', 'Duration', 'Disposition']}>
          {(calls.data?.rows ?? []).map((c) => (
            <tr key={c.id} className="cursor-pointer hover:bg-surface-2" onClick={() => setParams({ call: c.id })}>
              <Td className="whitespace-nowrap">{formatDateTime(c.created_at)}</Td>
              <Td>{[c.first_name, c.last_name].filter(Boolean).join(' ') || '—'}</Td>
              <Td className="whitespace-nowrap">{c.to_number}</Td>
              <Td>{c.campaign_name ?? '—'}</Td>
              <Td>{formatDuration(c.duration_seconds)}</Td>
              <Td>
                {c.disposition_label ? <Badge tone={dispositionTone(c.disposition_key)}>{c.disposition_label}</Badge> : <Badge>{c.status}</Badge>}
                {c.appointment && <AppointmentBadge appt={c.appointment} />}
              </Td>
            </tr>
          ))}
        </Table>
      )}
      <Drawer open={!!openId} onClose={() => setParams({})} title="Call details">
        {openId && <CallDetails id={openId} />}
      </Drawer>
    </div>
  );
}

function CallDetails({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['call', id], queryFn: () => api.get<CallDetail>(`/api/calls/${id}`) });
  const c = q.data;
  if (!c) return null;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {c.disposition_label && <Badge tone={dispositionTone(c.disposition_key)}>{c.disposition_label}</Badge>}
        <span className="text-sm text-muted">{formatDateTime(c.created_at)} · {formatDuration(c.duration_seconds)}</span>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt className="text-muted">Lead</dt><dd>{[c.first_name, c.last_name].filter(Boolean).join(' ') || '—'}</dd>
        <dt className="text-muted">Number</dt><dd>{c.to_number}</dd>
        <dt className="text-muted">Campaign</dt><dd>{c.campaign_name ?? '—'} {c.campaign_version && `(v${c.campaign_version})`}</dd>
        <dt className="text-muted">Ended reason</dt><dd>{c.ended_reason ?? '—'}</dd>
      </dl>
      {c.appointment && (
        <Card title="Appointment booked">
          <p className="text-sm">
            {DateTime.fromISO(c.appointment.starts_at, { zone: c.appointment.lead_time_zone }).toFormat("cccc, LLLL d 'at' h:mm a ZZZZ")}{' '}
            <Badge tone={c.appointment.status === 'needs_review' ? 'purple' : 'green'}>{c.appointment.status.replace('_', ' ')}</Badge>
          </p>
          <Link className="mt-2 inline-block text-sm text-primary underline" to={`/appointments?id=${c.appointment.id}`}>Open appointment</Link>
        </Card>
      )}
      {c.summary && <Card title="Summary"><p className="text-sm">{c.summary}</p></Card>}
      {c.recording_url && <audio controls src={c.recording_url} className="w-full" />}
      <Card title="Transcript & activity"><CallEventStream events={c.events} /></Card>
    </>
  );
}

/** "Appointment booked" badge with the time, linking to the appointment. */
function AppointmentBadge({ appt }: { appt: NonNullable<CallListRow['appointment']> }) {
  return (
    <Link
      to={`/appointments?id=${appt.id}`}
      onClick={(e) => e.stopPropagation()}
      className="ml-1 mt-1 inline-flex items-center gap-1 rounded-full bg-green-500/15 px-2 py-0.5 text-xs font-medium text-green-700 hover:underline dark:text-green-300"
      title="Open appointment"
    >
      {appt.status === 'needs_review' ? 'Appointment to review' : 'Appointment booked'} · {DateTime.fromISO(appt.starts_at).toFormat('LLL d, h:mm a')}
    </Link>
  );
}
