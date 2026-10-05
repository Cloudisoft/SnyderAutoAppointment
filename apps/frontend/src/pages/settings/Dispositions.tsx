import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Card, Table, Td, Toggle } from '../../components/ui';
import { api } from '../../lib/api';
import { titleCase } from '../../lib/format';

interface Disposition { id: string; key: string; label: string; priority: number; conditions: Record<string, unknown>; lead_status: string | null; retry: boolean; is_system: boolean; is_active: boolean }

export function DispositionsSettings() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['dispositions'], queryFn: () => api.get<Disposition[]>('/api/dispositions') });
  const patch = useMutation({
    mutationFn: (v: { id: string; body: Partial<Disposition> }) => api.patch(`/api/dispositions/${v.id}`, v.body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dispositions'] }),
  });
  return (
    <Card title="Dispositions">
      <p className="mb-4 text-sm text-muted">Rules are checked from top to bottom; the first match wins.</p>
      <Table head={['#', 'Disposition', 'When', 'Lead status', 'Retry', 'Active']}>
        {(q.data ?? []).map((d) => (
          <tr key={d.id}>
            <Td>{d.priority}</Td>
            <Td className="font-medium">{d.label} {d.is_system && <Badge>System</Badge>}</Td>
            <Td className="text-xs text-muted">{Object.entries(d.conditions).map(([k, v]) => `${titleCase(k)}: ${String(v)}`).join(', ') || 'Anything else'}</Td>
            <Td>{d.lead_status ? titleCase(d.lead_status) : '—'}</Td>
            <Td><Toggle checked={d.retry} onChange={(v) => patch.mutate({ id: d.id, body: { retry: v } })} /></Td>
            <Td><Toggle checked={d.is_active} onChange={(v) => patch.mutate({ id: d.id, body: { is_active: v } })} /></Td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}
