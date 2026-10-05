import { LEAD_STATUSES, LEAD_STATUS_LABELS, type LeadStatus } from '@snyder/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { BulkBar, Checkbox, SelectAllCheckbox, useSelection, type BulkResult } from '../components/bulk';
import { ExportButtons } from '../components/ExportButtons';
import { Badge, Button, Card, ConfirmModal, EmptyState, ErrorText, Field, Input, Modal, PageHeader, Select, SkeletonRows, Table, Tabs, Td } from '../components/ui';
import { toast } from '../lib/toast';
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
interface LeadList { id: string; name: string; lead_count: number; created_at?: string }

const statusTone = (s: LeadStatus) =>
  s === 'appointment_booked' ? 'green' : s === 'do_not_call' || s === 'bad_number' ? 'red' : s === 'appointment_cancelled' ? 'amber' : s === 'new' ? 'blue' : 'gray';

export function LeadsPage() {
  const [tab, setTab] = useState<'leads' | 'lists' | 'suppressions' | 'dnc'>('leads');
  return (
    <div>
      <PageHeader title="Leads" description="Upload, organise and send leads to campaigns." />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'leads', label: 'Leads' },
          { value: 'lists', label: 'Lists' },
          { value: 'suppressions', label: 'Email suppressions' },
          { value: 'dnc', label: 'Do not call' },
        ]}
      />
      {tab === 'leads' && <LeadsTab />}
      {tab === 'lists' && <ListsTab />}
      {tab === 'suppressions' && <SimpleList kind="suppressions" />}
      {tab === 'dnc' && <SimpleList kind="dnc" />}
    </div>
  );
}

type LeadBulkAction =
  | { action: 'delete' }
  | { action: 'move_to_list'; lead_list_id: string }
  | { action: 'remove_from_list' }
  | { action: 'set_status'; status: string }
  | { action: 'add_to_campaign'; campaign_id: string }
  | { action: 'remove_from_campaign'; campaign_id: string };

const BULK_STATUSES = ['new', 'callback', 'contacted', 'not_interested', 'do_not_call', 'bad_number', 'completed'] as const;

function LeadsTab() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [listId, setListId] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const lists = useQuery({ queryKey: ['lead-lists'], queryFn: () => api.get<LeadList[]>('/api/lead-lists') });
  const campaigns = useQuery({ queryKey: ['campaigns'], queryFn: () => api.get<{ id: string; name: string }[]>('/api/campaigns'), enabled: can('leads.manage') });
  const filters = new URLSearchParams();
  if (listId) filters.set('list_id', listId);
  if (status) filters.set('status', status);
  if (q) filters.set('q', q);
  const params = new URLSearchParams(filters);
  params.set('limit', '50');
  params.set('offset', String(page * 50));
  const leads = useQuery({ queryKey: ['leads', params.toString()], queryFn: () => api.get<{ rows: Lead[]; total: number }>(`/api/leads?${params}`) });
  const rows = leads.data?.rows ?? [];
  const sel = useSelection(rows.map((l) => l.id), filters.toString());
  const manage = can('leads.manage');

  const bulk = useMutation({
    mutationFn: (a: LeadBulkAction) =>
      api.post<BulkResult>('/api/leads/bulk', {
        ...a,
        selection: sel.allMatching ? { filter: { list_id: listId || undefined, status: status || undefined, q: q || undefined } } : { ids: sel.ids },
      }),
    onSuccess: (r) => {
      toast.success(r.message);
      sel.clear();
      setConfirmDelete(false);
      void qc.invalidateQueries({ queryKey: ['leads'] });
      void qc.invalidateQueries({ queryKey: ['lead-lists'] });
    },
  });
  const selectedCount = sel.allMatching ? leads.data?.total ?? sel.count : sel.count;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Input className="max-w-xs" placeholder="Search name, email or phone" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
        <Select className="max-w-48" value={listId} onChange={(e) => { setListId(e.target.value); setPage(0); }} aria-label="List">
          <option value="">All lists</option>
          {(lists.data ?? []).map((l) => <option key={l.id} value={l.id}>{l.name} ({l.lead_count})</option>)}
        </Select>
        <Select className="max-w-48" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }} aria-label="Status">
          <option value="">All statuses</option>
          {LEAD_STATUSES.map((s) => <option key={s} value={s}>{LEAD_STATUS_LABELS[s]}</option>)}
        </Select>
        <div className="ml-auto flex flex-wrap gap-2">
          <ExportButtons path="/api/leads/export" query={filters} name="leads" />
          {manage && (
            <>
              <Button onClick={() => setAddOpen(true)}>Add lead</Button>
              <Button variant="primary" onClick={() => setImportOpen(true)}>Upload leads</Button>
            </>
          )}
        </div>
      </div>
      {leads.isLoading ? <SkeletonRows /> : leads.data && rows.length === 0 ? (
        <EmptyState title={filters.toString() ? 'No leads match these filters' : 'No leads yet'}>
          {filters.toString() ? 'Try clearing the search or filters.' : 'Upload a CSV with at least a phone column to get started.'}
          {manage && !filters.toString() && <div className="mt-4"><Button variant="primary" onClick={() => setImportOpen(true)}>Upload leads</Button></div>}
        </EmptyState>
      ) : (
        <Table head={[...(manage ? [<SelectAllCheckbox key="all" sel={sel} />] : []), 'Name', 'Phone', 'Email', 'Company', 'Status', 'Added']}>
          {rows.map((l) => (
            <tr key={l.id} className={sel.has(l.id) ? 'bg-primary-soft' : undefined} onClick={manage ? () => sel.toggle(l.id) : undefined}>
              {manage && <Td className="w-8"><Checkbox label={`Select ${l.first_name ?? l.phone_e164}`} checked={sel.has(l.id)} onChange={() => sel.toggle(l.id)} /></Td>}
              <Td className="font-medium">{[l.first_name, l.last_name].filter(Boolean).join(' ') || '—'}</Td>
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
      {manage && (
        <BulkBar sel={sel} total={leads.data?.total} noun="lead">
          <ActionSelect label="Move to list" disabled={bulk.isPending} options={(lists.data ?? []).map((l) => [l.id, l.name])} onPick={(id) => bulk.mutate({ action: 'move_to_list', lead_list_id: id })} />
          <Button size="sm" disabled={bulk.isPending} onClick={() => bulk.mutate({ action: 'remove_from_list' })}>Remove from list</Button>
          <ActionSelect label="Add to campaign" disabled={bulk.isPending} options={(campaigns.data ?? []).map((c) => [c.id, c.name])} onPick={(id) => bulk.mutate({ action: 'add_to_campaign', campaign_id: id })} />
          <ActionSelect label="Remove from campaign" disabled={bulk.isPending} options={(campaigns.data ?? []).map((c) => [c.id, c.name])} onPick={(id) => bulk.mutate({ action: 'remove_from_campaign', campaign_id: id })} />
          <ActionSelect label="Set status" disabled={bulk.isPending} options={BULK_STATUSES.map((s) => [s, LEAD_STATUS_LABELS[s]])} onPick={(s) => bulk.mutate({ action: 'set_status', status: s })} />
          <Button size="sm" variant="danger" disabled={bulk.isPending} onClick={() => setConfirmDelete(true)}>Delete</Button>
        </BulkBar>
      )}
      <ConfirmModal
        open={confirmDelete}
        title={`Delete ${selectedCount.toLocaleString()} lead${selectedCount === 1 ? '' : 's'}?`}
        loading={bulk.isPending}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => bulk.mutate({ action: 'delete' })}
      >
        The leads are removed from every list and campaign. Their past call records are kept. Leads on a live call right now are skipped.
      </ConfirmModal>
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} lists={lists.data ?? []} onDone={() => { void qc.invalidateQueries({ queryKey: ['leads'] }); void qc.invalidateQueries({ queryKey: ['lead-lists'] }); }} />
      <AddLeadModal open={addOpen} onClose={() => setAddOpen(false)} lists={lists.data ?? []} onDone={() => { void qc.invalidateQueries({ queryKey: ['leads'] }); void qc.invalidateQueries({ queryKey: ['lead-lists'] }); }} />
    </div>
  );
}

/** A compact select that runs an action as soon as an option is picked. */
function ActionSelect({ label, options, onPick, disabled }: { label: string; options: [string, string][]; onPick(v: string): void; disabled?: boolean }) {
  return (
    <Select
      className="h-8 w-auto max-w-44 py-0 text-sm"
      value=""
      disabled={disabled || options.length === 0}
      aria-label={label}
      onChange={(e) => e.target.value && onPick(e.target.value)}
    >
      <option value="">{options.length ? `${label}…` : `${label} (none yet)`}</option>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </Select>
  );
}

function ListsTab() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const manage = can('leads.manage');
  const lists = useQuery({ queryKey: ['lead-lists'], queryFn: () => api.get<LeadList[]>('/api/lead-lists') });
  const rows = lists.data ?? [];
  const sel = useSelection(rows.map((l) => l.id));
  const [name, setName] = useState('');
  const [confirm, setConfirm] = useState<null | { deleteLeads: boolean }>(null);
  const create = useMutation({
    mutationFn: () => api.post('/api/lead-lists', { name }),
    onSuccess: () => { setName(''); toast.success('List created'); void qc.invalidateQueries({ queryKey: ['lead-lists'] }); },
  });
  const del = useMutation({
    mutationFn: (deleteLeads: boolean) => api.post<BulkResult>('/api/lead-lists/bulk-delete', { ids: sel.ids, delete_leads: deleteLeads }),
    onSuccess: (r) => {
      toast.success(r.message);
      sel.clear();
      setConfirm(null);
      void qc.invalidateQueries({ queryKey: ['lead-lists'] });
      void qc.invalidateQueries({ queryKey: ['leads'] });
    },
  });
  return (
    <div className="space-y-4">
      {manage && (
        <form className="flex max-w-md gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate(); }}>
          <Input placeholder="New list name" value={name} onChange={(e) => setName(e.target.value)} />
          <Button variant="primary" disabled={!name.trim()} loading={create.isPending}>Create list</Button>
        </form>
      )}
      {lists.isLoading ? <SkeletonRows rows={3} /> : rows.length === 0 ? (
        <EmptyState title="No lists yet">Lists are created when you upload leads, or here.</EmptyState>
      ) : (
        <Table head={[...(manage ? [<SelectAllCheckbox key="all" sel={sel} />] : []), 'List', 'Leads', 'Created']}>
          {rows.map((l) => (
            <tr key={l.id} className={sel.has(l.id) ? 'bg-primary-soft' : undefined} onClick={manage ? () => sel.toggle(l.id) : undefined}>
              {manage && <Td className="w-8"><Checkbox label={`Select ${l.name}`} checked={sel.has(l.id)} onChange={() => sel.toggle(l.id)} /></Td>}
              <Td className="font-medium">{l.name}</Td>
              <Td>{l.lead_count.toLocaleString()}</Td>
              <Td>{l.created_at ? formatDate(l.created_at) : '—'}</Td>
            </tr>
          ))}
        </Table>
      )}
      {manage && (
        <BulkBar sel={sel} noun="list">
          <Button size="sm" disabled={del.isPending} onClick={() => setConfirm({ deleteLeads: false })}>Delete lists, keep leads</Button>
          <Button size="sm" variant="danger" disabled={del.isPending} onClick={() => setConfirm({ deleteLeads: true })}>Delete lists and leads</Button>
        </BulkBar>
      )}
      <ConfirmModal
        open={!!confirm}
        title={confirm?.deleteLeads ? `Delete ${sel.count} list(s) and all their leads?` : `Delete ${sel.count} list(s)?`}
        loading={del.isPending}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm && del.mutate(confirm.deleteLeads)}
      >
        {confirm?.deleteLeads
          ? 'Every lead in these lists is deleted too (leads on a live call are kept). Call records stay.'
          : 'The leads stay and simply no longer belong to a list.'}
      </ConfirmModal>
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
  const manage = can('leads.manage');
  const path = kind === 'suppressions' ? '/api/email-suppressions' : '/api/dnc';
  const [value, setValue] = useState('');
  const list = useQuery({ queryKey: [kind], queryFn: () => api.get<{ id: string; email?: string; phone_e164?: string; reason?: string; source?: string; created_at: string }[]>(path) });
  const rows = list.data ?? [];
  const sel = useSelection(rows.map((r) => r.id));
  const add = useMutation({
    mutationFn: () => api.post(path, kind === 'suppressions' ? { email: value } : { phone: value }),
    onSuccess: () => { setValue(''); toast.success('Added'); void qc.invalidateQueries({ queryKey: [kind] }); },
  });
  const remove = useMutation({
    mutationFn: async (ids: string[]) => {
      const results = await Promise.allSettled(ids.map((id) => api.del(`${path}/${id}`)));
      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed === ids.length) throw new Error(`Could not remove ${failed} entr${failed === 1 ? 'y' : 'ies'}`);
      return { removed: ids.length - failed, failed };
    },
    onSuccess: (r) => {
      if (r.failed) toast.error(`Removed ${r.removed}; ${r.failed} could not be removed`);
      else toast.success(`Removed ${r.removed} entr${r.removed === 1 ? 'y' : 'ies'}`);
      sel.clear();
      void qc.invalidateQueries({ queryKey: [kind] });
    },
  });
  return (
    <Card>
      {manage && (
        <form className="mb-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
          <Input placeholder={kind === 'suppressions' ? 'email@example.com' : '+1 555 123 4567'} value={value} onChange={(e) => setValue(e.target.value)} />
          <Button disabled={!value} loading={add.isPending}>Add</Button>
        </form>
      )}
      <ErrorText error={add.error} />
      {list.isLoading ? <SkeletonRows rows={3} /> : rows.length === 0 ? (
        <EmptyState title={kind === 'suppressions' ? 'No suppressed emails' : 'No do-not-call numbers'} />
      ) : (
        <Table head={[...(manage ? [<SelectAllCheckbox key="all" sel={sel} />] : []), kind === 'suppressions' ? 'Email' : 'Phone', 'Source', 'Added', '']}>
          {rows.map((r) => (
            <tr key={r.id} className={sel.has(r.id) ? 'bg-primary-soft' : undefined}>
              {manage && <Td className="w-8"><Checkbox label="Select" checked={sel.has(r.id)} onChange={() => sel.toggle(r.id)} /></Td>}
              <Td>{r.email ?? r.phone_e164}</Td>
              <Td>{r.reason ?? r.source}</Td>
              <Td>{formatDate(r.created_at)}</Td>
              <Td className="text-right">{manage && <Button size="sm" variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate([r.id])}>Remove</Button>}</Td>
            </tr>
          ))}
        </Table>
      )}
      {manage && (
        <BulkBar sel={sel} noun="entry">
          <Button size="sm" variant="danger" loading={remove.isPending} onClick={() => remove.mutate(sel.ids)}>Remove selected</Button>
        </BulkBar>
      )}
    </Card>
  );
}
