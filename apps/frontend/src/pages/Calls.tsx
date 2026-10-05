import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { DateTime } from 'luxon';
import { Link, useSearchParams } from 'react-router-dom';
import { CallEventStream, type CallEvent } from '../components/calls/CallEvents';
import { useAuth } from '../auth/AuthProvider';
import { BulkBar, Checkbox, SelectAllCheckbox, useSelection, type BulkResult } from '../components/bulk';
import { ExportButtons } from '../components/ExportButtons';
import { Badge, Button, Card, ConfirmModal, Drawer, EmptyState, Input, PageHeader, Select, SkeletonRows, Table, Td, cx } from '../components/ui';
import { toast } from '../lib/toast';
import { api } from '../lib/api';
import { formatDateTime, formatDuration, formatEndedReason } from '../lib/format';

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
  transcript: string | null;
  recording_url: string | null;
  ended_reason: string | null;
  campaign_version: number | null;
  email: string | null;
  lead_status: string | null;
  events: CallEvent[];
}

export const dispositionTone = (k: string | null) =>
  k === 'appointment_booked' ? 'green' : k === 'do_not_call' ? 'red' : k === 'call_connected' || k === 'transferred' ? 'blue' : 'gray';

const PAGE = 100;

export function CallsPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [campaign, setCampaign] = useState('');
  const [disposition, setDisposition] = useState('');
  const [page, setPage] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const openId = params.get('call');
  const campaigns = useQuery({ queryKey: ['campaigns'], queryFn: () => api.get<{ id: string; name: string }[]>('/api/campaigns') });
  const dispositions = useQuery({ queryKey: ['dispositions'], queryFn: () => api.get<{ key: string; label: string }[]>('/api/dispositions') });
  const filters = new URLSearchParams();
  if (q) filters.set('q', q);
  if (campaign) filters.set('campaign_id', campaign);
  if (disposition) filters.set('disposition', disposition);
  const qs = new URLSearchParams(filters);
  qs.set('limit', String(PAGE));
  qs.set('offset', String(page * PAGE));
  const calls = useQuery({ queryKey: ['calls', qs.toString()], queryFn: () => api.get<{ rows: CallListRow[]; total: number }>(`/api/calls?${qs}`) });
  const rows = calls.data?.rows ?? [];
  const sel = useSelection(rows.map((c) => c.id), filters.toString());
  const canDelete = can('calls.manage');
  const exportQuery = new URLSearchParams(filters);
  if (sel.count && !sel.allMatching) exportQuery.set('ids', sel.ids.slice(0, 1000).join(','));

  const del = useMutation({
    mutationFn: () => api.post<BulkResult>('/api/calls/bulk-delete', { ids: sel.ids }),
    onSuccess: (r) => {
      toast.success(r.message);
      sel.clear();
      setConfirmDelete(false);
      void qc.invalidateQueries({ queryKey: ['calls'] });
    },
  });
  const resetPage = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); setPage(0); };

  return (
    <div>
      <PageHeader
        title="Call records"
        description={calls.data ? `${calls.data.total.toLocaleString()} calls · recordings, transcripts and outcomes` : undefined}
        actions={<ExportButtons path="/api/calls/export" query={filters} name="call-records" />}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Input className="max-w-xs" placeholder="Search name, email or phone" value={q} onChange={(e) => resetPage(setQ)(e.target.value)} />
        <Select className="max-w-52" value={campaign} onChange={(e) => resetPage(setCampaign)(e.target.value)} aria-label="Campaign">
          <option value="">All campaigns</option>
          {(campaigns.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select className="max-w-52" value={disposition} onChange={(e) => resetPage(setDisposition)(e.target.value)} aria-label="Disposition">
          <option value="">All dispositions</option>
          {(dispositions.data ?? []).map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
        </Select>
      </div>
      {calls.isLoading ? <SkeletonRows /> : rows.length === 0 ? (
        <EmptyState title={filters.toString() ? 'No calls match these filters' : 'No calls yet'}>
          {filters.toString() ? 'Try clearing the search or filters.' : 'Calls appear here as soon as a campaign starts dialing.'}
        </EmptyState>
      ) : (
        <Table head={[<SelectAllCheckbox key="all" sel={sel} />, 'When', 'Lead', 'Number', 'Campaign', 'Duration', 'Disposition']}>
          {rows.map((c) => (
            <tr key={c.id} className={cx('cursor-pointer', sel.has(c.id) && 'bg-primary-soft')} onClick={() => setParams({ call: c.id })}>
              <Td className="w-8"><Checkbox label="Select call" checked={sel.has(c.id)} onChange={() => sel.toggle(c.id)} /></Td>
              <Td className="whitespace-nowrap">{formatDateTime(c.created_at)}</Td>
              <Td className="font-medium">{[c.first_name, c.last_name].filter(Boolean).join(' ') || '—'}</Td>
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
      {calls.data && calls.data.total > PAGE && (
        <div className="mt-3 flex items-center justify-end gap-2 text-sm">
          <span className="text-muted">{page * PAGE + 1}–{Math.min((page + 1) * PAGE, calls.data.total)} of {calls.data.total.toLocaleString()}</span>
          <Button size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
          <Button size="sm" disabled={(page + 1) * PAGE >= calls.data.total} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
      <BulkBar sel={sel} noun="call">
        <ExportButtons path="/api/calls/export" query={exportQuery} name="selected-calls" />
        {canDelete && <Button size="sm" variant="danger" disabled={del.isPending} onClick={() => setConfirmDelete(true)}>Delete</Button>}
      </BulkBar>
      <ConfirmModal
        open={confirmDelete}
        title={`Delete ${sel.count} call record${sel.count === 1 ? '' : 's'}?`}
        loading={del.isPending}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => del.mutate()}
      >
        Transcripts and activity for these calls are deleted. Leads and appointments are kept. Calls that are still live are skipped.
      </ConfirmModal>
      <Drawer open={!!openId} onClose={() => setParams({})} title="Call details">
        {openId && <CallDetails id={openId} />}
      </Drawer>
    </div>
  );
}

function CallDetails({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['call', id], queryFn: () => api.get<CallDetail>(`/api/calls/${id}`) });
  const c = q.data;
  if (q.isError) return <EmptyState title="This call could not be loaded." />;
  if (!c) return <SkeletonRows rows={4} />;
  const hasTranscriptEvents = c.events.some((e) => e.type === 'transcript');
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
        <dt className="text-muted">Ended reason</dt><dd>{formatEndedReason(c.ended_reason)}</dd>
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
      {c.recording_url ? (
        <Card title="Recording" actions={<a className="text-sm font-medium text-primary hover:underline" href={c.recording_url} target="_blank" rel="noreferrer" download>Download</a>}>
          <audio controls preload="metadata" src={c.recording_url} className="w-full" />
        </Card>
      ) : (
        c.status === 'ended' && <p className="text-sm text-muted">No recording for this call (it may not have connected).</p>
      )}
      <Card title="Transcript & activity">
        {c.events.length ? <CallEventStream events={c.events} /> : null}
        {!hasTranscriptEvents && c.transcript && <pre className="mt-2 whitespace-pre-wrap font-sans text-sm">{c.transcript}</pre>}
        {!c.events.length && !c.transcript && <p className="text-sm text-muted">No transcript yet.</p>}
      </Card>
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
