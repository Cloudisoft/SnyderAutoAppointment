import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, Button, Card, ErrorText, Field, Input, Modal, Table, Td } from '../../components/ui';
import { api } from '../../lib/api';

export interface Voice { id: string; voice_id: string; name: string; model: string; language: string; is_active: boolean }

export function VoicesSettings() {
  const qc = useQueryClient();
  const voices = useQuery({ queryKey: ['voices'], queryFn: () => api.get<Voice[]>('/api/voices') });
  const [open, setOpen] = useState(false);
  const [browse, setBrowse] = useState(false);
  const [voiceId, setVoiceId] = useState('');
  const [name, setName] = useState('');
  const cartesia = useQuery({ queryKey: ['cartesia-voices'], enabled: browse, queryFn: () => api.get<{ id: string; name: string; description?: string }[]>('/api/voices/cartesia') });
  const add = useMutation({
    mutationFn: () => api.post('/api/voices', { voice_id: voiceId, name }),
    onSuccess: () => { setOpen(false); setVoiceId(''); setName(''); qc.invalidateQueries({ queryKey: ['voices'] }); },
  });
  const toggle = useMutation({
    mutationFn: (v: Voice) => api.patch(`/api/voices/${v.id}`, { is_active: !v.is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['voices'] }),
  });
  return (
    <Card title="Cartesia voices" actions={<Button size="sm" variant="primary" onClick={() => setOpen(true)}>Add voice</Button>}>
      <p className="mb-4 text-sm text-muted">Voices use Cartesia sonic-3. The voice name is how the AI introduces itself ({'{{agent_name}}'}).</p>
      <Table head={['Name', 'Voice ID', 'Model', 'Status', '']}>
        {(voices.data ?? []).map((v) => (
          <tr key={v.id}>
            <Td className="font-medium">{v.name}</Td>
            <Td><code className="text-xs">{v.voice_id}</code></Td>
            <Td>{v.model}</Td>
            <Td>{v.is_active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</Td>
            <Td className="text-right"><Button size="sm" variant="ghost" onClick={() => toggle.mutate(v)}>{v.is_active ? 'Disable' : 'Enable'}</Button></Td>
          </tr>
        ))}
      </Table>
      <Modal open={open} onClose={() => setOpen(false)} title="Add Cartesia voice" footer={<Button variant="primary" disabled={!voiceId || !name} loading={add.isPending} onClick={() => add.mutate()}>Add</Button>}>
        <Field label="Cartesia voice ID"><Input value={voiceId} onChange={(e) => setVoiceId(e.target.value)} /></Field>
        <Field label="Agent name" hint="Spoken by the AI, e.g. “Katie”."><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Button size="sm" onClick={() => setBrowse(true)}>Browse Cartesia voices</Button>
        {browse && (
          <ul className="max-h-60 overflow-auto divide-y divide-border rounded-md border border-border">
            {cartesia.isLoading && <li className="p-2 text-sm text-muted">Loading…</li>}
            {(cartesia.data ?? []).map((v) => (
              <li key={v.id}>
                <button type="button" className="w-full p-2 text-left text-sm hover:bg-surface-2" onClick={() => { setVoiceId(v.id); setName(v.name.split(/[\s-]/)[0] ?? v.name); }}>
                  <span className="font-medium">{v.name}</span> <span className="text-muted">{v.description}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <ErrorText error={add.error ?? cartesia.error} />
      </Modal>
    </Card>
  );
}
