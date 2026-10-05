import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Card, ErrorText, Field, Input, Modal, Select, Table, Td, Textarea } from '../../components/ui';
import { AGENT_MODELS, DEFAULT_AGENT_MODEL } from '@snyder/shared';
import { api } from '../../lib/api';
import { toast } from '../../lib/toast';
import type { Voice } from './Voices';

export interface Agent {
  id: string;
  name: string;
  voice_id: string | null;
  voice_name?: string | null;
  system_prompt: string;
  first_message: string;
  model: string;
  temperature: number;
  transfer_number: string | null;
  end_call_message: string | null;
  knowledge_base_id: string | null;
}
const blank: Omit<Agent, 'id'> = { name: '', voice_id: null, system_prompt: '', first_message: '', model: DEFAULT_AGENT_MODEL, temperature: 0.5, transfer_number: null, end_call_message: null, knowledge_base_id: null };

export function AgentsSettings() {
  const qc = useQueryClient();
  const agents = useQuery({ queryKey: ['agents'], queryFn: () => api.get<Agent[]>('/api/agents') });
  const voices = useQuery({ queryKey: ['voices'], queryFn: () => api.get<Voice[]>('/api/voices') });
  const kbs = useQuery({ queryKey: ['kbs'], queryFn: () => api.get<{ id: string; name: string }[]>('/api/knowledge-bases') });
  const [editing, setEditing] = useState<(Omit<Agent, 'id'> & { id?: string }) | null>(null);
  const [kbOpen, setKbOpen] = useState(false);
  const [kb, setKb] = useState({ name: '', vapi_tool_id: '' });
  const save = useMutation({
    mutationFn: (a: Omit<Agent, 'id'> & { id?: string }) => {
      const { id, voice_name: _v, ...body } = a as Agent;
      return id ? api.put(`/api/agents/${id}`, body) : api.post('/api/agents', body);
    },
    onSuccess: () => { setEditing(null); toast.success('Agent saved'); qc.invalidateQueries({ queryKey: ['agents'] }); },
  });
  const modelLabel = (id: string) => AGENT_MODELS.find((m) => m.id === id)?.label ?? id;
  const addKb = useMutation({ mutationFn: () => api.post('/api/knowledge-bases', kb), onSuccess: () => { setKbOpen(false); qc.invalidateQueries({ queryKey: ['kbs'] }); } });
  const set = <K extends keyof Agent>(k: K, v: Agent[K]) => editing && setEditing({ ...editing, [k]: v });

  return (
    <div className="space-y-6">
      <Card title="Agents" actions={<Button size="sm" variant="primary" onClick={() => setEditing({ ...blank })}>New agent</Button>}>
        <Table head={['Name', 'Voice', 'Model', '']}>
          {(agents.data ?? []).map((a) => (
            <tr key={a.id}>
              <Td className="font-medium">{a.name}</Td>
              <Td>{a.voice_name ?? '—'}</Td>
              <Td>{modelLabel(a.model)}</Td>
              <Td className="text-right"><Button size="sm" variant="ghost" onClick={() => setEditing({ ...a, temperature: Number(a.temperature) })}>Edit</Button></Td>
            </tr>
          ))}
        </Table>
      </Card>
      <Card title="Knowledge bases" actions={<Button size="sm" onClick={() => setKbOpen(true)}>Add</Button>}>
        <ul className="text-sm divide-y divide-border">{(kbs.data ?? []).map((k) => <li key={k.id} className="py-2">{k.name}</li>)}</ul>
      </Card>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit agent' : 'New agent'} footer={<Button variant="primary" loading={save.isPending} onClick={() => editing && save.mutate(editing)}>Save</Button>}>
        {editing && (
          <>
            <Field label="Name"><Input value={editing.name} onChange={(e) => set('name', e.target.value)} /></Field>
            <Field label="Cartesia voice" hint="The voice name becomes {{agent_name}}.">
              <Select value={editing.voice_id ?? ''} onChange={(e) => set('voice_id', e.target.value || null)}>
                <option value="">Choose a voice</option>
                {(voices.data ?? []).filter((v) => v.is_active).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </Select>
            </Field>
            <Field label="First message"><Input value={editing.first_message} onChange={(e) => set('first_message', e.target.value)} placeholder="Hi {{first_name}}, this is {{agent_name}} from {{business_name}}." /></Field>
            <Field label="Prompt" hint="Placeholders: {{first_name}}, {{agent_name}}, {{campaign_name}}, {{business_name}}, lead custom fields.">
              <Textarea rows={10} value={editing.system_prompt} onChange={(e) => set('system_prompt', e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="AI model" hint={AGENT_MODELS.find((m) => m.id === editing.model)?.hint}>
                <Select value={editing.model} onChange={(e) => set('model', e.target.value)}>
                  {!AGENT_MODELS.some((m) => m.id === editing.model) && <option value={editing.model}>{editing.model} (no longer supported)</option>}
                  {AGENT_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </Select>
              </Field>
              <Field label="Temperature"><Input type="number" step="0.1" min={0} max={2} value={editing.temperature} onChange={(e) => set('temperature', Number(e.target.value))} /></Field>
            </div>
            <Field label="Live transfer number (optional)" hint="When the person asks for a human, the agent warm-transfers the call here."><Input type="tel" value={editing.transfer_number ?? ''} onChange={(e) => set('transfer_number', e.target.value || null)} placeholder="+1 555 123 4567" /></Field>
            <Field label="Knowledge base">
              <Select value={editing.knowledge_base_id ?? ''} onChange={(e) => set('knowledge_base_id', e.target.value || null)}>
                <option value="">None</option>
                {(kbs.data ?? []).map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
              </Select>
            </Field>
            <ErrorText error={save.error} />
          </>
        )}
      </Modal>
      <Modal open={kbOpen} onClose={() => setKbOpen(false)} title="Add knowledge base" footer={<Button variant="primary" loading={addKb.isPending} onClick={() => addKb.mutate()}>Add</Button>}>
        <Field label="Name"><Input value={kb.name} onChange={(e) => setKb({ ...kb, name: e.target.value })} /></Field>
        <Field label="Vapi query tool ID"><Input value={kb.vapi_tool_id} onChange={(e) => setKb({ ...kb, vapi_tool_id: e.target.value })} /></Field>
        <ErrorText error={addKb.error} />
      </Modal>
    </div>
  );
}
