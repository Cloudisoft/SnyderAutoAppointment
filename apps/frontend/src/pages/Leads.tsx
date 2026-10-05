import { LEAD_STATUSES, LEAD_STATUS_LABELS, type LeadStatus } from '@snyder/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { Badge, Button, Card, EmptyState, ErrorText, Field, Input, Modal, PageHeader, Select, Table, Tabs, Td } from '../components/ui';
import { api } from '../lib/api';
import { formatDate } from '../lib/format';

interface Lead {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone_e164: string;
  company: string | null;
  status: LeadStatus;
  time_zone: string | null;
  custom_fields: Record<string, unknown>;
  created_at: string;
}
interface LeadList { id: string; name: string; lead_count: number }

const statusTone = (s: LeadStatus) =>
  s === 'appointment_booked' ? 'green' : s === 'do_not_call' || s === 'bad_number' ? 'red' : s === 'appointment_cancelled' ? 'amber' : s === 'new' ? 'blue' : 'gray';

export function LeadsPage() {
  const [tab, setTab] = useState<'leads' | 'suppressions' | 'dnc'>('leads');
  return (
    <div>
      <PageHeader title="Leads" />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'leads', label: 'Leads' }, { value: 'suppressions', label: 'Email suppressions' }, { value: 'dnc', label: 'Do not call' }]} />
      {tab === 'leads' && <LeadsTab />}
      {tab === 'suppressions' && <SimpleList kind="suppressions" />}
      {tab === 'dnc' && <SimpleList kind="dnc" />}
    </div>
  );
}

function LeadsTab() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [listId, setListId] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const lists = useQuery({ queryKey: ['lead-lists'], queryFn: () => api.get<LeadList[]>('/api/lead-lists') });
  const params = new URLSearchParams({ limit: '50', offset: String(page * 50) });
  if (listId) params.set('list_id', listId);
  if (status) params.set('status', status);
  if (q) params.set('q', q);
  const leads = useQuery({ queryKey: ['leads', params.toString()], queryFn: () => api.get<{ rows: Lead[]; total: number }>(`/api/leads?${params}`) });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Input className="max-w-xs" placeholder="Search name, email or phone" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
        <Select className="max-w-48" value={listId} onChange={(e) => { setListId(e.target.value); setPage(0); }}>
          <option value="">All lists</option>
          {(lists.data ?? []).map((l) => <option key={l.id} value={l.id}>{l.name} ({l.lead_count})</option>)}
        </Select>
        <Select className="max-w-48" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}>
          <option value="">All statuses</option>
          {LEAD_STATUSES.map((s) => <option key={s} value={s}>{LEAD_STATUS_LABELS[s]}</option>)}
        </Select>
        {can('leads.manage') && (
          <div className="ml-auto flex gap-2">
            <Button onClick={() => setAddOpen(true)}>Add lead</Button>
            <Button variant="primary" onClick={() => setImportOpen(true)}>Import CSV</Button>
          </div>
        )}
      </div>
      {leads.data && leads.data.rows.length === 0 ? (
        <EmptyState title="No leads found">Import a CSV with at least a phone column.</EmptyState>
      ) : (
        <Table head={['Name', 'Phone', 'Email', 'Company', 'Status', 'Added']}>
          {(leads.data?.rows ?? []).map((l) => (
            <tr key={l.id}>
              <Td>{[l.first_name, l.last_name].filter(Boolean).join(' ') || '—'}</Td>
              <Td className="whitespace-nowrap">{l.phone_e164}</Td>
              <Td>{l.email ?? '—'}</Td>
              <Td>{l.company ?? '—'}</Td>
              <Td><Badge tone={statusTone(l.status)}>{LEAD_STATUS_LABELS[l.status] ?? l.status}</Badge></Td>
              <Td className="whitespace-nowrap">{formatDate(l.created_at)}</Td>
            </tr>
          ))}
        </Table>
      )}
      {leads.data && leads.data.total > 50 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <span className="text-muted">{page * 50 + 1}–{Math.min((page + 1) * 50, leads.data.total)} of {leads.data.total}</span>
          <Button size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
          <Button size="sm" disabled={(page + 1) * 50 >= leads.data.total} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} lists={lists.data ?? []} onDone={() => { qc.invalidateQueries({ queryKey: ['leads'] }); qc.invalidateQueries({ queryKey: ['lead-lists'] }); }} />
      <AddLeadModal open={addOpen} onClose={() => setAddOpen(false)} lists={lists.data ?? []} onDone={() => qc.invalidateQueries({ queryKey: ['leads'] })} />
    </div>
  );
}

function ImportModal({ open, onClose, lists, onDone }: { open: boolean; onClose(): void; lists: LeadList[]; onDone(): void }) {
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [listId, setListId] = useState('');
  const [newList, setNewList] = useState('');
  const m = useMutation({
    mutationFn: () =>
      api.post<{ inserted: number; skipped: number; errors: { row: number; error: string }[] }>('/api/leads/import', {
        csv,
        ...(listId ? { lead_list_id: listId } : newList ? { lead_list_name: newList } : {}),
      }),
    onSuccess: onDone,
  });
  return (
    <Modal open={open} onClose={onClose} title="Import leads" footer={<Button variant="primary" disabled={!csv} loading={m.isPending} onClick={() => m.mutate()}>Import</Button>}>
      <Field label="CSV file" hint="Columns: first_name, last_name, email, phone, company, time_zone. Other columns become custom fields.">
        <Input type="file" accept=".csv,text/csv" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setFileName(f.name); setCsv(await f.text()); } }} />
      </Field>
      {fileName && <p className="text-xs text-muted">{fileName}</p>}
      <Field label="Add to list">
        <Select value={listId} onChange={(e) => setListId(e.target.value)}>
          <option value="">New list…</option>
          {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </Select>
      </Field>
      {!listId && <Field label="New list name"><Input value={newList} onChange={(e) => setNewList(e.target.value)} placeholder="e.g. October import" /></Field>}
      <ErrorText error={m.error} />
      {m.data && (
        <div className="text-sm">
          <p className="text-success">Imported {m.data.inserted} leads. Skipped {m.data.skipped}.</p>
          {m.data.errors.slice(0, 5).map((e) => <p key={e.row} className="text-muted">Row {e.row}: {e.error}</p>)}
        </div>
      )}
    </Modal>
  );
}

function AddLeadModal({ open, onClose, lists, onDone }: { open: boolean; onClose(): void; lists: LeadList[]; onDone(): void }) {
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', phone: '', company: '', lead_list_id: '' });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const m = useMutation({
    mutationFn: () => api.post('/api/leads', { ...form, lead_list_id: form.lead_list_id || null }),
    onSuccess: () => { onDone(); onClose(); },
  });
  return (
    <Modal open={open} onClose={onClose} title="Add lead" footer={<Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>Save</Button>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="First name"><Input value={form.first_name} onChange={set('first_name')} /></Field>
        <Field label="Last name"><Input value={form.last_name} onChange={set('last_name')} /></Field>
      </div>
      <Field label="Phone"><Input value={form.phone} onChange={set('phone')} required /></Field>
      <Field label="Email"><Input type="email" value={form.email} onChange={set('email')} /></Field>
      <Field label="Company"><Input value={form.company} onChange={set('company')} /></Field>
      <Field label="List">
        <Select value={form.lead_list_id} onChange={set('lead_list_id')}>
          <option value="">None</option>
          {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </Select>
      </Field>
      <ErrorText error={m.error} />
    </Modal>
  );
}

function SimpleList({ kind }: { kind: 'suppressions' | 'dnc' }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const path = kind === 'suppressions' ? '/api/email-suppressions' : '/api/dnc';
  const [value, setValue] = useState('');
  const list = useQuery({ queryKey: [kind], queryFn: () => api.get<{ id: string; email?: string; phone_e164?: string; reason?: string; source?: string; created_at: string }[]>(path) });
  const add = useMutation({
    mutationFn: () => api.post(path, kind === 'suppressions' ? { email: value } : { phone: value }),
    onSuccess: () => { setValue(''); qc.invalidateQueries({ queryKey: [kind] }); },
  });
  const remove = useMutation({ mutationFn: (id: string) => api.del(`${path}/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: [kind] }) });
  return (
    <Card>
      {can('leads.manage') && (
        <form className="mb-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
          <Input placeholder={kind === 'suppressions' ? 'email@example.com' : '+1 555 123 4567'} value={value} onChange={(e) => setValue(e.target.value)} />
          <Button disabled={!value} loading={add.isPending}>Add</Button>
        </form>
      )}
      <ErrorText error={add.error} />
      <Table head={[kind === 'suppressions' ? 'Email' : 'Phone', 'Source', 'Added', '']}>
        {(list.data ?? []).map((r) => (
          <tr key={r.id}>
            <Td>{r.email ?? r.phone_e164}</Td>
            <Td>{r.reason ?? r.source}</Td>
            <Td>{formatDate(r.created_at)}</Td>
            <Td className="text-right">{can('leads.manage') && <Button size="sm" variant="ghost" onClick={() => remove.mutate(r.id)}>Remove</Button>}</Td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}
