import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { BulkBar, Checkbox, SelectAllCheckbox, useSelection, type BulkResult } from '../../components/bulk';
import { Badge, Button, Card, ConfirmModal, EmptyState, ErrorText, Field, Input, Modal, SkeletonRows, Table, Td } from '../../components/ui';
import { api } from '../../lib/api';
import { toast } from '../../lib/toast';

export interface Voice { id: string; voice_id: string; name: string; model: string; language: string; is_active: boolean }
interface CartesiaVoice { id: string; name: string; description?: string; language?: string }

/** First word of a Cartesia voice name, used as the agent's spoken name ("Katie - Friendly" -> "Katie"). */
const spokenName = (name: string) => name.split(/[\s-]/)[0] || name;

export function VoicesSettings() {
  const qc = useQueryClient();
  const voices = useQuery({ queryKey: ['voices'], queryFn: () => api.get<Voice[]>('/api/voices') });
  const rows = voices.data ?? [];
  const sel = useSelection(rows.map((v) => v.id));
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['voices'] });

  const toggle = useMutation({
    mutationFn: (v: Voice) => api.patch(`/api/voices/${v.id}`, { is_active: !v.is_active }),
    onSuccess: (_d, v) => { toast.success(`${v.name} ${v.is_active ? 'disabled' : 'enabled'}`); void refresh(); },
  });
  const bulk = useMutation({
    mutationFn: (action: 'activate' | 'deactivate' | 'delete') => api.post<BulkResult>('/api/voices/bulk', { ids: sel.ids, action }),
    onSuccess: (r) => { toast.success(r.message); sel.clear(); setConfirmDelete(false); void refresh(); },
  });

  return (
    <Card title="Voices" actions={<Button size="sm" variant="primary" onClick={() => setOpen(true)}>Add voices</Button>}>
      <p className="mb-4 text-sm text-muted">The voice name is how the AI introduces itself ({'{{agent_name}}'}).</p>
      {voices.isLoading ? <SkeletonRows rows={3} /> : rows.length === 0 ? (
        <EmptyState title="No voices yet">
          Add one or more voices, then pick one for each agent.
          <div className="mt-4"><Button variant="primary" onClick={() => setOpen(true)}>Browse voices</Button></div>
        </EmptyState>
      ) : (
        <Table head={[<SelectAllCheckbox key="all" sel={sel} />, 'Name', 'Voice ID', 'Status', '']}>
          {rows.map((v) => (
            <tr key={v.id} className={sel.has(v.id) ? 'bg-primary-soft' : undefined}>
              <Td className="w-8"><Checkbox label={`Select ${v.name}`} checked={sel.has(v.id)} onChange={() => sel.toggle(v.id)} /></Td>
              <Td className="font-medium">{v.name}</Td>
              <Td><code className="text-xs">{v.voice_id}</code></Td>
              <Td>{v.is_active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</Td>
              <Td className="text-right"><Button size="sm" variant="ghost" disabled={toggle.isPending} onClick={() => toggle.mutate(v)}>{v.is_active ? 'Disable' : 'Enable'}</Button></Td>
            </tr>
          ))}
        </Table>
      )}
      <BulkBar sel={sel} noun="voice">
        <Button size="sm" disabled={bulk.isPending} onClick={() => bulk.mutate('activate')}>Enable</Button>
        <Button size="sm" disabled={bulk.isPending} onClick={() => bulk.mutate('deactivate')}>Disable</Button>
        <Button size="sm" variant="danger" disabled={bulk.isPending} onClick={() => setConfirmDelete(true)}>Delete</Button>
      </BulkBar>
      <ConfirmModal open={confirmDelete} title={`Delete ${sel.count} voice${sel.count === 1 ? '' : 's'}?`} loading={bulk.isPending} onClose={() => setConfirmDelete(false)} onConfirm={() => bulk.mutate('delete')}>
        Voices that an agent still uses are kept; disable them or switch the agent's voice first.
      </ConfirmModal>
      <AddVoicesModal open={open} onClose={() => setOpen(false)} existing={rows} onDone={() => void refresh()} />
    </Card>
  );
}

function AddVoicesModal({ open, onClose, existing, onDone }: { open: boolean; onClose(): void; existing: Voice[]; onDone(): void }) {
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Map<string, CartesiaVoice>>(new Map());
  const [manualId, setManualId] = useState('');
  const [manualName, setManualName] = useState('');
  const cartesia = useQuery({ queryKey: ['cartesia-voices'], enabled: open, staleTime: 5 * 60_000, queryFn: () => api.get<CartesiaVoice[]>('/api/voices/cartesia'), meta: { silent: true } });
  const have = useMemo(() => new Set(existing.map((v) => v.voice_id)), [existing]);
  const list = (cartesia.data ?? []).filter((v) => `${v.name} ${v.description ?? ''} ${v.language ?? ''}`.toLowerCase().includes(search.toLowerCase()));

  const add = useMutation({
    mutationFn: async () => {
      const items = [...picked.values()].map((v) => ({ voice_id: v.id, name: spokenName(v.name), language: v.language || 'en' }));
      if (manualId.trim()) items.push({ voice_id: manualId.trim(), name: manualName.trim() || 'Agent', language: 'en' });
      const results = await Promise.allSettled(items.map((i) => api.post('/api/voices', i)));
      const failed = results.flatMap((r, i) => (r.status === 'rejected' ? [`${items[i]!.name}: ${(r.reason as Error).message}`] : []));
      if (failed.length === items.length) throw new Error(failed.join('; '));
      return { added: items.length - failed.length, failed };
    },
    onSuccess: (r) => {
      if (r.failed.length) toast.error(`Added ${r.added}; failed: ${r.failed.join('; ')}`);
      else toast.success(`Added ${r.added} voice${r.added === 1 ? '' : 's'}`);
      setPicked(new Map());
      setManualId('');
      setManualName('');
      onDone();
      onClose();
    },
  });
  const count = picked.size + (manualId.trim() ? 1 : 0);
  const togglePick = (v: CartesiaVoice) =>
    setPicked((prev) => {
      const next = new Map(prev);
      if (next.has(v.id)) next.delete(v.id);
      else next.set(v.id, v);
      return next;
    });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add voices"
      footer={<Button variant="primary" disabled={!count} loading={add.isPending} onClick={() => add.mutate()}>{count ? `Add ${count} voice${count === 1 ? '' : 's'}` : 'Add voices'}</Button>}
    >
      <Input placeholder="Search voices by name, style or language" value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="max-h-72 overflow-auto rounded-lg border border-border">
        {cartesia.isLoading && <div className="space-y-2 p-3"><SkeletonRows rows={4} /></div>}
        {cartesia.isError && <p className="p-3 text-sm text-danger">Could not load the voice library: {(cartesia.error as Error).message}. You can still add a voice by ID below.</p>}
        {!cartesia.isLoading && !cartesia.isError && list.length === 0 && <p className="p-3 text-sm text-muted">No voices match “{search}”.</p>}
        <ul className="divide-y divide-border">
          {list.map((v) => {
            const already = have.has(v.id);
            return (
              <li key={v.id}>
                <label className={`flex cursor-pointer items-start gap-3 p-2.5 text-sm transition-colors hover:bg-surface-2 ${picked.has(v.id) ? 'bg-primary-soft' : ''} ${already ? 'opacity-60' : ''}`}>
                  <span className="pt-0.5"><Checkbox label={`Pick ${v.name}`} checked={picked.has(v.id) || already} onChange={() => !already && togglePick(v)} /></span>
                  <span className="min-w-0">
                    <span className="font-medium">{v.name}</span>
                    {v.language && <span className="ml-2 text-xs uppercase text-muted">{v.language}</span>}
                    {already && <span className="ml-2 text-xs text-muted">(added)</span>}
                    {v.description && <span className="block truncate text-muted">{v.description}</span>}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted hover:text-fg">Add by voice ID instead</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Voice ID"><Input value={manualId} onChange={(e) => setManualId(e.target.value)} /></Field>
          <Field label="Agent name" hint="Spoken by the AI, e.g. “Katie”."><Input value={manualName} onChange={(e) => setManualName(e.target.value)} /></Field>
        </div>
      </details>
      <ErrorText error={add.error} />
    </Modal>
  );
}
