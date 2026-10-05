import { LOCATION_TYPES } from '@snyder/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { useEffect, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorText, Field, Input, Modal, Select, Table, Tabs, Td, Textarea, Toggle } from '../../components/ui';
import { TimeZoneSelect } from '../../components/TimeZoneSelect';
import { api } from '../../lib/api';
import { titleCase } from '../../lib/format';

export interface AppointmentType {
  id: string;
  name: string;
  duration_minutes: number;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  location_type: (typeof LOCATION_TYPES)[number];
  location_details: string | null;
  description: string | null;
  is_active: boolean;
}
interface Rule { weekday: number; start_time: string; end_time: string }
interface Exception { id: string; starts_at: string; ends_at: string; type: 'blocked' | 'extra_open'; reason: string | null }
export interface Host { id: string; display_name: string; email: string; time_zone: string; is_active: boolean; user_id: string | null; rules: Rule[]; exceptions: Exception[] }

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
type Kind = 'confirmation' | 'reschedule' | 'cancellation' | 'reminder' | 'host_notice';
const PLACEHOLDERS = ['first_name', 'agent_name', 'campaign_name', 'business_name', 'appointment_date', 'appointment_time', 'time_zone', 'host_name', 'location', 'appointment_link', 'duration'];

export function AppointmentSettingsPage() {
  const [tab, setTab] = useState<'types' | 'hosts' | 'templates'>('types');
  return (
    <div>
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'types', label: 'Appointment types' }, { value: 'hosts', label: 'Hosts & availability' }, { value: 'templates', label: 'Email templates' }]} />
      {tab === 'types' && <TypesTab />}
      {tab === 'hosts' && <HostsTab />}
      {tab === 'templates' && <TemplatesTab />}
    </div>
  );
}

const blankType: Omit<AppointmentType, 'id'> = { name: '', duration_minutes: 30, buffer_before_minutes: 0, buffer_after_minutes: 10, location_type: 'phone', location_details: '', description: '', is_active: true };

function TypesTab() {
  const qc = useQueryClient();
  const types = useQuery({ queryKey: ['appointment-types'], queryFn: () => api.get<AppointmentType[]>('/api/appointment-types') });
  const [editing, setEditing] = useState<(Omit<AppointmentType, 'id'> & { id?: string }) | null>(null);
  const save = useMutation({
    mutationFn: (t: Omit<AppointmentType, 'id'> & { id?: string }) => {
      const { id, ...body } = t;
      return id ? api.put(`/api/appointment-types/${id}`, body) : api.post('/api/appointment-types', body);
    },
    onSuccess: () => { setEditing(null); qc.invalidateQueries({ queryKey: ['appointment-types'] }); },
  });
  const num = (k: 'duration_minutes' | 'buffer_before_minutes' | 'buffer_after_minutes') => (
    <Input type="number" min={0} value={editing?.[k] ?? 0} onChange={(e) => editing && setEditing({ ...editing, [k]: Number(e.target.value) })} />
  );
  return (
    <Card title="Appointment types" actions={<Button size="sm" variant="primary" onClick={() => setEditing({ ...blankType })}>New type</Button>}>
      {types.data?.length === 0 ? <EmptyState title="No appointment types yet" /> : (
        <Table head={['Name', 'Duration', 'Buffers', 'Location', 'Status', '']}>
          {(types.data ?? []).map((t) => (
            <tr key={t.id}>
              <Td className="font-medium">{t.name}</Td>
              <Td>{t.duration_minutes} min</Td>
              <Td>{t.buffer_before_minutes} / {t.buffer_after_minutes} min</Td>
              <Td>{titleCase(t.location_type)}{t.location_details && <span className="block text-xs text-muted truncate max-w-56">{t.location_details}</span>}</Td>
              <Td>{t.is_active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</Td>
              <Td className="text-right"><Button size="sm" variant="ghost" onClick={() => setEditing(t)}>Edit</Button></Td>
            </tr>
          ))}
        </Table>
      )}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit appointment type' : 'New appointment type'} footer={<Button variant="primary" loading={save.isPending} onClick={() => editing && save.mutate(editing)}>Save</Button>}>
        {editing && (
          <>
            <Field label="Name"><Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Duration (min)">{num('duration_minutes')}</Field>
              <Field label="Buffer before">{num('buffer_before_minutes')}</Field>
              <Field label="Buffer after">{num('buffer_after_minutes')}</Field>
            </div>
            <Field label="Location">
              <Select value={editing.location_type} onChange={(e) => setEditing({ ...editing, location_type: e.target.value as AppointmentType['location_type'] })}>
                {LOCATION_TYPES.map((l) => <option key={l} value={l}>{titleCase(l)}</option>)}
              </Select>
            </Field>
            <Field label="Location details" hint="Video link, address, dial-in, or leave blank for 'host will call you'.">
              <Input value={editing.location_details ?? ''} onChange={(e) => setEditing({ ...editing, location_details: e.target.value })} />
            </Field>
            <Field label="Description (shown to the prospect)"><Textarea rows={3} value={editing.description ?? ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></Field>
            <Toggle checked={editing.is_active} onChange={(v) => setEditing({ ...editing, is_active: v })} label="Active" />
            <ErrorText error={save.error} />
          </>
        )}
      </Modal>
    </Card>
  );
}

function HostsTab() {
  const qc = useQueryClient();
  const hosts = useQuery({ queryKey: ['appointment-hosts'], queryFn: () => api.get<Host[]>('/api/appointment-hosts') });
  const users = useQuery({ queryKey: ['org-users'], queryFn: () => api.get<{ id: string; email: string; full_name: string | null }[]>('/api/organization/users'), retry: false });
  const [editing, setEditing] = useState<Partial<Host> | null>(null);
  const [scheduleFor, setScheduleFor] = useState<Host | null>(null);
  const save = useMutation({
    mutationFn: (h: Partial<Host>) => {
      const body = { display_name: h.display_name, email: h.email, time_zone: h.time_zone, is_active: h.is_active ?? true, user_id: h.user_id || null };
      return h.id ? api.put(`/api/appointment-hosts/${h.id}`, body) : api.post('/api/appointment-hosts', body);
    },
    onSuccess: () => { setEditing(null); qc.invalidateQueries({ queryKey: ['appointment-hosts'] }); },
  });
  return (
    <div className="space-y-4">
      <Card title="Hosts" actions={<Button size="sm" variant="primary" onClick={() => setEditing({ time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone, is_active: true })}>Add host</Button>}>
        <p className="mb-3 text-sm text-muted">A host is a team member or a shared calendar that prospects meet with.</p>
        {hosts.data?.length === 0 ? <EmptyState title="No hosts yet" /> : (
          <Table head={['Host', 'Time zone', 'Weekly hours', 'Status', '']}>
            {(hosts.data ?? []).map((h) => (
              <tr key={h.id}>
                <Td><span className="font-medium">{h.display_name}</span><span className="block text-xs text-muted">{h.email}{!h.user_id && ' · shared calendar'}</span></Td>
                <Td>{h.time_zone.replace(/_/g, ' ')}</Td>
                <Td>{h.rules.length ? summarizeRules(h.rules) : <Badge tone="amber">No availability</Badge>}</Td>
                <Td>{h.is_active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</Td>
                <Td className="text-right whitespace-nowrap">
                  <Button size="sm" variant="ghost" onClick={() => setScheduleFor(h)}>Availability</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(h)}>Edit</Button>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit host' : 'Add host'} footer={<Button variant="primary" loading={save.isPending} onClick={() => editing && save.mutate(editing)}>Save</Button>}>
        {editing && (
          <>
            <Field label="Linked user (optional)" hint="Leave empty for a shared calendar.">
              <Select
                value={editing.user_id ?? ''}
                onChange={(e) => {
                  const u = users.data?.find((x) => x.id === e.target.value);
                  setEditing({ ...editing, user_id: e.target.value || null, ...(u ? { email: editing.email || u.email, display_name: editing.display_name || u.full_name || u.email } : {}) });
                }}
              >
                <option value="">Shared calendar</option>
                {(users.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.full_name ?? u.email}</option>)}
              </Select>
            </Field>
            <Field label="Display name" hint="Shown to prospects and spoken by the AI."><Input value={editing.display_name ?? ''} onChange={(e) => setEditing({ ...editing, display_name: e.target.value })} /></Field>
            <Field label="Email" hint="Receives the host notice for each booking."><Input type="email" value={editing.email ?? ''} onChange={(e) => setEditing({ ...editing, email: e.target.value })} /></Field>
            <Field label="Time zone"><TimeZoneSelect value={editing.time_zone ?? 'America/New_York'} onChange={(v) => setEditing({ ...editing, time_zone: v })} /></Field>
            <Toggle checked={editing.is_active ?? true} onChange={(v) => setEditing({ ...editing, is_active: v })} label="Active" />
            <ErrorText error={save.error} />
          </>
        )}
      </Modal>
      {scheduleFor && <AvailabilityModal host={scheduleFor} onClose={() => setScheduleFor(null)} />}
    </div>
  );
}

function summarizeRules(rules: Rule[]) {
  const byDay = new Map<number, string[]>();
  for (const r of rules) byDay.set(r.weekday, [...(byDay.get(r.weekday) ?? []), `${r.start_time}–${r.end_time}`]);
  return [...byDay.entries()].map(([d, ranges]) => `${DAYS[d - 1]!.slice(0, 3)} ${ranges.join(', ')}`).join(' · ');
}

function AvailabilityModal({ host, onClose }: { host: Host; onClose(): void }) {
  const qc = useQueryClient();
  const [rules, setRules] = useState<Rule[]>(host.rules);
  const [ex, setEx] = useState({ date: '', start: '09:00', end: '17:00', type: 'blocked' as 'blocked' | 'extra_open', reason: '', allDay: true });
  useEffect(() => setRules(host.rules), [host]);
  const invalidate = () => qc.invalidateQueries({ queryKey: ['appointment-hosts'] });
  const saveRules = useMutation({ mutationFn: () => api.put(`/api/appointment-hosts/${host.id}/availability`, { rules }), onSuccess: invalidate });
  const addEx = useMutation({
    mutationFn: () => {
      const start = DateTime.fromISO(`${ex.date}T${ex.allDay ? '00:00' : ex.start}`, { zone: host.time_zone });
      const end = ex.allDay ? start.plus({ days: 1 }) : DateTime.fromISO(`${ex.date}T${ex.end}`, { zone: host.time_zone });
      return api.post(`/api/appointment-hosts/${host.id}/exceptions`, { starts_at: start.toISO(), ends_at: end.toISO(), type: ex.type, reason: ex.reason || undefined });
    },
    onSuccess: () => { setEx({ ...ex, date: '', reason: '' }); invalidate(); onClose(); },
  });
  const delEx = useMutation({ mutationFn: (id: string) => api.del(`/api/availability-exceptions/${id}`), onSuccess: () => { invalidate(); onClose(); } });
  const setRule = (i: number, patch: Partial<Rule>) => setRules(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <Modal open onClose={onClose} title={`Availability · ${host.display_name}`} footer={<Button variant="primary" loading={saveRules.isPending} onClick={() => saveRules.mutate(undefined, { onSuccess: onClose })}>Save weekly hours</Button>}>
      <p className="text-sm text-muted">Weekly hours in {host.time_zone.replace(/_/g, ' ')}.</p>
      <div className="space-y-3">
        {DAYS.map((day, i) => {
          const weekday = i + 1;
          const dayRules = rules.map((r, idx) => ({ r, idx })).filter((x) => x.r.weekday === weekday);
          return (
            <div key={day} className="flex flex-wrap items-start gap-2">
              <span className="w-24 pt-2 text-sm font-medium">{day}</span>
              <div className="flex flex-1 flex-col gap-2">
                {dayRules.length === 0 && <span className="pt-2 text-sm text-muted">Unavailable</span>}
                {dayRules.map(({ r, idx }) => (
                  <div key={idx} className="flex items-center gap-2">
                    <Input type="time" className="w-28" value={r.start_time} onChange={(e) => setRule(idx, { start_time: e.target.value })} />
                    <span className="text-muted">–</span>
                    <Input type="time" className="w-28" value={r.end_time} onChange={(e) => setRule(idx, { end_time: e.target.value })} />
                    <button aria-label="Remove" className="text-muted hover:text-danger" onClick={() => setRules(rules.filter((_, j) => j !== idx))}>✕</button>
                  </div>
                ))}
              </div>
              <Button size="sm" variant="ghost" onClick={() => setRules([...rules, { weekday, start_time: '09:00', end_time: '17:00' }])}>+ Add</Button>
            </div>
          );
        })}
      </div>
      <ErrorText error={saveRules.error} />
      <div className="border-t border-border pt-4">
        <p className="mb-2 font-medium">Date exceptions</p>
        <ul className="mb-3 space-y-1 text-sm">
          {host.exceptions.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-2">
              <span>
                <Badge tone={e.type === 'blocked' ? 'red' : 'green'}>{e.type === 'blocked' ? 'Blocked' : 'Extra hours'}</Badge>{' '}
                {DateTime.fromISO(e.starts_at, { zone: host.time_zone }).toFormat('LLL d, h:mm a')} – {DateTime.fromISO(e.ends_at, { zone: host.time_zone }).toFormat('LLL d, h:mm a')}
                {e.reason && <span className="text-muted"> · {e.reason}</span>}
              </span>
              <button className="text-muted hover:text-danger" onClick={() => delEx.mutate(e.id)} aria-label="Delete exception">✕</button>
            </li>
          ))}
        </ul>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Date"><Input type="date" value={ex.date} onChange={(e) => setEx({ ...ex, date: e.target.value })} /></Field>
          <Field label="Type">
            <Select value={ex.type} onChange={(e) => setEx({ ...ex, type: e.target.value as 'blocked' | 'extra_open' })}>
              <option value="blocked">Blocked (time off)</option>
              <option value="extra_open">Extra open hours</option>
            </Select>
          </Field>
        </div>
        <Toggle checked={ex.allDay} onChange={(v) => setEx({ ...ex, allDay: v })} label="All day" />
        {!ex.allDay && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Input type="time" value={ex.start} onChange={(e) => setEx({ ...ex, start: e.target.value })} />
            <Input type="time" value={ex.end} onChange={(e) => setEx({ ...ex, end: e.target.value })} />
          </div>
        )}
        <Input className="mt-2" placeholder="Reason (optional)" value={ex.reason} onChange={(e) => setEx({ ...ex, reason: e.target.value })} />
        <Button className="mt-2" size="sm" disabled={!ex.date} loading={addEx.isPending} onClick={() => addEx.mutate()}>Add exception</Button>
        <ErrorText error={addEx.error} />
      </div>
    </Modal>
  );
}

function TemplatesTab() {
  const qc = useQueryClient();
  const templates = useQuery({ queryKey: ['appointment-templates'], queryFn: () => api.get<Record<Kind, { subject: string; body: string; is_default?: boolean }>>('/api/appointment-email-templates') });
  const [kind, setKind] = useState<Kind>('confirmation');
  const [draft, setDraft] = useState({ subject: '', body: '' });
  const [testTo, setTestTo] = useState('');
  useEffect(() => {
    const t = templates.data?.[kind];
    if (t) setDraft({ subject: t.subject, body: t.body });
  }, [templates.data, kind]);
  const preview = useQuery({
    queryKey: ['template-preview', kind, draft.subject, draft.body],
    enabled: !!draft.subject && !!draft.body,
    queryFn: () => api.post<{ subject: string; html: string }>('/api/appointment-email-templates/preview', { kind, ...draft }),
  });
  const save = useMutation({ mutationFn: () => api.put(`/api/appointment-email-templates/${kind}`, draft), onSuccess: () => qc.invalidateQueries({ queryKey: ['appointment-templates'] }) });
  const reset = useMutation({ mutationFn: () => api.del(`/api/appointment-email-templates/${kind}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['appointment-templates'] }) });
  const test = useMutation({ mutationFn: () => api.post<{ to: string }>('/api/appointment-email-templates/test', { kind, ...draft, ...(testTo ? { to: testTo } : {}) }) });
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Default email templates">
        <div className="space-y-3">
          <Select value={kind} onChange={(e) => setKind(e.target.value as Kind)} aria-label="Template">
            <option value="confirmation">Confirmation (campaigns can override)</option>
            <option value="reschedule">Reschedule</option>
            <option value="cancellation">Cancellation</option>
            <option value="reminder">Reminder</option>
            <option value="host_notice">Host notice</option>
          </Select>
          {templates.data?.[kind]?.is_default && <Badge>Using built-in default</Badge>}
          <Field label="Subject"><Input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} /></Field>
          <Field label="Body" hint={<>Placeholders: {PLACEHOLDERS.map((p) => `{{${p}}}`).join(', ')} and lead custom fields. Unknown placeholders are removed.</>}>
            <Textarea rows={12} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
            <Button variant="ghost" loading={reset.isPending} onClick={() => reset.mutate()}>Reset to default</Button>
          </div>
          <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
            <Field label="Send test email to"><Input type="email" placeholder="Your email" value={testTo} onChange={(e) => setTestTo(e.target.value)} /></Field>
            <Button loading={test.isPending} onClick={() => test.mutate()}>Send test</Button>
          </div>
          {test.data && <p className="text-sm text-success">Test sent to {test.data.to}.</p>}
          <ErrorText error={save.error ?? test.error} />
        </div>
      </Card>
      <Card title="Preview">
        {preview.data ? (
          <>
            <p className="mb-2 text-sm"><span className="text-muted">Subject:</span> {preview.data.subject}</p>
            <iframe title="Email preview" sandbox="" className="h-[560px] w-full rounded-md border border-border bg-white" srcDoc={preview.data.html} />
          </>
        ) : <p className="text-sm text-muted">Edit the template to see a preview with sample data.</p>}
      </Card>
    </div>
  );
}
