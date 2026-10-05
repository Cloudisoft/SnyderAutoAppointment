import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, Button, Card, ErrorText, Field, Input, Modal, Select, Table, Td } from '../../components/ui';
import { api } from '../../lib/api';

interface TwilioAccount { id: string; label: string; account_sid: string }
export interface PhoneNumber { id: string; e164: string; label: string | null; is_active: boolean; twilio_account_label: string }

export function PhoneNumbersSettings() {
  const qc = useQueryClient();
  const accounts = useQuery({ queryKey: ['twilio-accounts'], queryFn: () => api.get<TwilioAccount[]>('/api/twilio-accounts') });
  const numbers = useQuery({ queryKey: ['phone-numbers'], queryFn: () => api.get<PhoneNumber[]>('/api/phone-numbers') });
  const [acctOpen, setAcctOpen] = useState(false);
  const [acct, setAcct] = useState({ label: '', account_sid: '', auth_token: '' });
  const [importOpen, setImportOpen] = useState(false);
  const [imp, setImp] = useState({ twilio_account_id: '', number: '', label: '' });
  const available = useQuery({
    queryKey: ['twilio-numbers', imp.twilio_account_id],
    enabled: importOpen && !!imp.twilio_account_id,
    queryFn: () => api.get<{ phone_number: string; friendly_name: string }[]>(`/api/twilio-accounts/${imp.twilio_account_id}/numbers`),
  });
  const addAcct = useMutation({
    mutationFn: () => api.post('/api/twilio-accounts', acct),
    onSuccess: () => { setAcctOpen(false); setAcct({ label: '', account_sid: '', auth_token: '' }); qc.invalidateQueries({ queryKey: ['twilio-accounts'] }); },
  });
  const importNumber = useMutation({
    mutationFn: () => api.post('/api/phone-numbers', imp),
    onSuccess: () => { setImportOpen(false); qc.invalidateQueries({ queryKey: ['phone-numbers'] }); },
  });
  const toggle = useMutation({
    mutationFn: (n: PhoneNumber) => api.patch(`/api/phone-numbers/${n.id}`, { is_active: !n.is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['phone-numbers'] }),
  });

  return (
    <div className="space-y-6">
      <Card title="Twilio accounts" actions={<Button size="sm" onClick={() => setAcctOpen(true)}>Connect account</Button>}>
        <p className="mb-3 text-sm text-muted">Auth tokens are stored encrypted in Supabase Vault.</p>
        <ul className="divide-y divide-border text-sm">
          {(accounts.data ?? []).map((a) => <li key={a.id} className="py-2"><span className="font-medium">{a.label}</span> <code className="text-xs text-muted">{a.account_sid}</code></li>)}
        </ul>
      </Card>
      <Card title="Phone numbers (caller ID)" actions={<Button size="sm" variant="primary" disabled={!accounts.data?.length} onClick={() => { setImp({ twilio_account_id: accounts.data?.[0]?.id ?? '', number: '', label: '' }); setImportOpen(true); }}>Import number</Button>}>
        <Table head={['Number', 'Label', 'Twilio account', 'Status', '']}>
          {(numbers.data ?? []).map((n) => (
            <tr key={n.id}>
              <Td className="font-medium whitespace-nowrap">{n.e164}</Td>
              <Td>{n.label ?? '—'}</Td>
              <Td>{n.twilio_account_label}</Td>
              <Td>{n.is_active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</Td>
              <Td className="text-right"><Button size="sm" variant="ghost" onClick={() => toggle.mutate(n)}>{n.is_active ? 'Disable' : 'Enable'}</Button></Td>
            </tr>
          ))}
        </Table>
      </Card>
      <Modal open={acctOpen} onClose={() => setAcctOpen(false)} title="Connect Twilio account" footer={<Button variant="primary" loading={addAcct.isPending} onClick={() => addAcct.mutate()}>Connect</Button>}>
        <Field label="Label"><Input value={acct.label} onChange={(e) => setAcct({ ...acct, label: e.target.value })} /></Field>
        <Field label="Account SID"><Input value={acct.account_sid} onChange={(e) => setAcct({ ...acct, account_sid: e.target.value.trim() })} placeholder="AC…" /></Field>
        <Field label="Auth token"><Input type="password" value={acct.auth_token} onChange={(e) => setAcct({ ...acct, auth_token: e.target.value.trim() })} /></Field>
        <ErrorText error={addAcct.error} />
      </Modal>
      <Modal open={importOpen} onClose={() => setImportOpen(false)} title="Import Twilio number" footer={<Button variant="primary" disabled={!imp.number} loading={importNumber.isPending} onClick={() => importNumber.mutate()}>Import</Button>}>
        <Field label="Twilio account">
          <Select value={imp.twilio_account_id} onChange={(e) => setImp({ ...imp, twilio_account_id: e.target.value })}>
            {(accounts.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </Select>
        </Field>
        <Field label="Number">
          <Select value={imp.number} onChange={(e) => setImp({ ...imp, number: e.target.value })}>
            <option value="">{available.isLoading ? 'Loading…' : 'Choose a number'}</option>
            {(available.data ?? []).map((n) => <option key={n.phone_number} value={n.phone_number}>{n.phone_number} — {n.friendly_name}</option>)}
          </Select>
        </Field>
        <Field label="Label"><Input value={imp.label} onChange={(e) => setImp({ ...imp, label: e.target.value })} /></Field>
        <ErrorText error={importNumber.error ?? available.error} />
      </Modal>
    </div>
  );
}
