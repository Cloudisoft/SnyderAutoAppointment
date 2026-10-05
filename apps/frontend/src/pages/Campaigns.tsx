import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { Badge, Button, EmptyState, ErrorText, Field, Input, Modal, PageHeader, Table, Td } from '../components/ui';
import { api } from '../lib/api';
import { formatDate } from '../lib/format';

interface CampaignRow { id: string; name: string; status: string; current_version: number | null; has_unpublished_changes: boolean; lead_count: number; remaining_count: number; created_at: string }

export const campaignStatusTone = (s: string) => (s === 'active' ? 'green' : s === 'paused' ? 'amber' : 'gray');

export function CampaignsPage() {
  const { can } = useAuth();
  const nav = useNavigate();
  const list = useQuery({ queryKey: ['campaigns'], queryFn: () => api.get<CampaignRow[]>('/api/campaigns') });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const create = useMutation({ mutationFn: () => api.post<{ id: string }>('/api/campaigns', { name }), onSuccess: (c) => nav(`/campaigns/${c.id}`) });
  return (
    <div>
      <PageHeader title="Campaigns" actions={can('campaigns.manage') && <Button variant="primary" onClick={() => setOpen(true)}>New campaign</Button>} />
      {list.data?.length === 0 ? (
        <EmptyState title="No campaigns yet" />
      ) : (
        <Table head={['Name', 'Status', 'Version', 'Leads', 'Remaining', 'Created']}>
          {(list.data ?? []).map((c) => (
            <tr key={c.id}>
              <Td><Link className="font-medium hover:underline" to={`/campaigns/${c.id}`}>{c.name}</Link></Td>
              <Td><Badge tone={campaignStatusTone(c.status)}>{c.status}</Badge></Td>
              <Td>{c.current_version ? `v${c.current_version}` : '—'} {c.has_unpublished_changes && c.current_version && <Badge tone="amber">Unpublished changes</Badge>}</Td>
              <Td>{c.lead_count}</Td>
              <Td>{c.remaining_count}</Td>
              <Td>{formatDate(c.created_at)}</Td>
            </tr>
          ))}
        </Table>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="New campaign" footer={<Button variant="primary" disabled={!name} loading={create.isPending} onClick={() => create.mutate()}>Create</Button>}>
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <ErrorText error={create.error} />
      </Modal>
    </div>
  );
}
