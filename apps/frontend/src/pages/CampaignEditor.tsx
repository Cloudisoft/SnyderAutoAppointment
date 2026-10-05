import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { TimeZoneSelect } from '../components/TimeZoneSelect';
import { Badge, Button, Card, EmptyState, ErrorText, Field, Input, Modal, PageHeader, Select, SkeletonRows, Tabs, Table, Td } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { errorMessage, toast } from '../lib/toast';
import { campaignStatusTone } from './Campaigns';
import type { Agent } from './settings/Agents';
import type { PhoneNumber } from './settings/PhoneNumbers';
import { AppointmentsSection } from './campaign/AppointmentsSection';

export type CampaignConfigDraft = Record<string, unknown> & {
  agent_id: string | null;
  phone_number_ids: string[];
  business_name: string;
  time_zone: string;
  concurrency: number;
  calling_window: { days: number[]; start: string; end: string };
  max_attempts: number;
  retry_delay_minutes: number;
};

interface CampaignDetail {
  id: string;
  name: string;
  status: string;
  draft: CampaignConfigDraft;
  current_version_id: string | null;
  has_unpublished_changes: boolean;
  versions: { id: string; version: number; published_at: string; published_by_email: string | null }[];
  lead_states: Record<string, number>;
}

export interface SectionProps {
  config: CampaignConfigDraft;
  setConfig(c: CampaignConfigDraft): void;
  readOnly: boolean;
}

type Tab = 'general' | 'agent' | 'calling' | 'appointments' | 'leads' | 'versions';
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function CampaignEditorPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const readOnly = !can('campaigns.manage');
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['campaign', id], queryFn: () => api.get<CampaignDetail>(`/api/campaigns/${id}`) });
  const [tab, setTab] = useState<Tab>('general');
  const [name, setName] = useState('');
  const [config, setConfig] = useState<CampaignConfigDraft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [publishModal, setPublishModal] = useState<{ errors: string[]; warnings: string[] } | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; errors: string[]; warnings: string[]; model?: string; voice?: string; tools?: string[]; recording?: boolean } | null>(null);

  useEffect(() => {
    if (q.data && !dirty) {
      setName(q.data.name);
      setConfig(q.data.draft);
    }
  }, [q.data, dirty]);

  const update = (c: CampaignConfigDraft) => {
    setConfig(c);
    setDirty(true);
  };
  const invalidate = () => {
    setDirty(false);
    qc.invalidateQueries({ queryKey: ['campaign', id] });
    qc.invalidateQueries({ queryKey: ['campaigns'] });
  };
  const saveDraft = useMutation({ mutationFn: () => api.put(`/api/campaigns/${id}/draft`, { name, config }), onSuccess: invalidate });
  const check = useMutation({
    mutationFn: async () => {
      await api.put(`/api/campaigns/${id}/draft`, { name, config });
      return api.get<{ errors: string[]; warnings: string[] }>(`/api/campaigns/${id}/publish-check`);
    },
    onSuccess: (r) => setPublishModal(r),
  });
  const publish = useMutation({
    mutationFn: () => api.post<{ version: number; warnings: string[] }>(`/api/campaigns/${id}/publish`, { name, config }),
    onSuccess: () => {
      setPublishModal(null);
      invalidate();
    },
    meta: { silent: true },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 422) setPublishModal(e.body as { errors: string[]; warnings: string[] });
      else toast.error(errorMessage(e));
    },
  });
  const testConfig = useMutation({
    mutationFn: async () => {
      if (dirty) await saveDraft.mutateAsync();
      return api.post<{ ok: boolean; errors: string[]; warnings: string[]; model?: string; voice?: string; tools?: string[]; recording?: boolean }>(`/api/campaigns/${id}/test-config`);
    },
    onSuccess: (r) => {
      setTestResult(r);
      if (r.ok) toast.success('Call setup verified');
      else toast.error(r.errors[0] ?? 'This call setup was rejected');
    },
  });
  const setStatus = useMutation({ mutationFn: (status: string) => api.post(`/api/campaigns/${id}/status`, { status }), onSuccess: invalidate });

  if (q.isError) return <EmptyState title="This campaign could not be loaded.">{errorMessage(q.error)}</EmptyState>;
  if (!q.data || !config) return <SkeletonRows rows={6} />;
  const c = q.data;
  const sectionProps: SectionProps = { config, setConfig: update, readOnly };

  return (
    <div>
      <PageHeader
        title={c.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={campaignStatusTone(c.status)}>{c.status}</Badge>
            {c.versions[0] ? <span>Published v{c.versions[0].version}</span> : <span>Never published</span>}
            {(dirty || c.has_unpublished_changes) && c.versions[0] && <Badge tone="amber">Unpublished changes</Badge>}
          </span>
        }
        actions={
          !readOnly && (
            <>
              {c.status === 'active' ? (
                <Button onClick={() => setStatus.mutate('paused')}>Pause</Button>
              ) : (
                <Button disabled={!c.current_version_id} onClick={() => setStatus.mutate('active')}>Start</Button>
              )}
              <Button loading={testConfig.isPending} onClick={() => testConfig.mutate()} title="Checks model, voice, tools and recording without placing a call">Test call setup</Button>
              <Button loading={saveDraft.isPending} onClick={() => saveDraft.mutate()} disabled={!dirty}>Save draft</Button>
              <Button variant="primary" loading={check.isPending || publish.isPending} onClick={() => check.mutate()}>Save &amp; publish</Button>
            </>
          )
        }
      />
      <ErrorText error={saveDraft.error ?? setStatus.error ?? check.error} />
      {testResult && (
        <div className={`mb-4 rounded-xl border p-4 text-sm animate-page-in ${testResult.ok ? 'border-success/30 bg-success/5' : 'border-danger/30 bg-danger/5'}`}>
          <div className="flex items-start justify-between gap-3">
            <p className="font-semibold">{testResult.ok ? '✓ Call setup verified' : '✕ This call setup will not work yet'}</p>
            <button className="text-muted hover:text-fg" onClick={() => setTestResult(null)} aria-label="Dismiss">✕</button>
          </div>
          {testResult.errors.map((e) => <p key={e} className="mt-1 text-danger">{e}</p>)}
          {testResult.warnings.map((w) => <p key={w} className="mt-1 text-warning">{w}</p>)}
          {testResult.model && (
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-muted">
              <dt>Model</dt><dd>{testResult.model}</dd>
              <dt>Voice</dt><dd>{testResult.voice}</dd>
              <dt>Tools</dt><dd>{testResult.tools?.join(', ')}</dd>
              <dt>Recording</dt><dd>{testResult.recording ? 'On' : 'Off'}</dd>
            </dl>
          )}
        </div>
      )}
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'general', label: 'General' },
          { value: 'agent', label: 'Agent & numbers' },
          { value: 'calling', label: 'Calling' },
          { value: 'appointments', label: 'Appointments' },
          { value: 'leads', label: 'Leads' },
          { value: 'versions', label: 'Versions' },
        ]}
      />
      {tab === 'general' && (
        <Card>
          <div className="grid gap-4 md:grid-cols-2 max-w-3xl">
            <Field label="Campaign name"><Input disabled={readOnly} value={name} onChange={(e) => { setName(e.target.value); setDirty(true); }} /></Field>
            <Field label="Business / intro name" hint="Used in emails and as {{business_name}} in prompts.">
              <Input disabled={readOnly} value={config.business_name} onChange={(e) => update({ ...config, business_name: e.target.value })} />
            </Field>
            <Field label="Campaign time zone" hint="Fallback when a lead's time zone can't be determined.">
              <TimeZoneSelect value={config.time_zone} onChange={(v) => update({ ...config, time_zone: v })} />
            </Field>
          </div>
        </Card>
      )}
      {tab === 'agent' && <AgentSection {...sectionProps} />}
      {tab === 'calling' && <CallingSection {...sectionProps} />}
      {tab === 'appointments' && <AppointmentsSection {...sectionProps} />}
      {tab === 'leads' && <LeadsSection campaignId={c.id} states={c.lead_states} readOnly={readOnly} onChange={invalidate} />}
      {tab === 'versions' && (
        <Table head={['Version', 'Published', 'By']}>
          {c.versions.map((v) => (
            <tr key={v.id}>
              <Td>v{v.version} {v.id === c.current_version_id && <Badge tone="green">Live</Badge>}</Td>
              <Td>{formatDateTime(v.published_at)}</Td>
              <Td>{v.published_by_email ?? '—'}</Td>
            </tr>
          ))}
        </Table>
      )}

      <Modal
        open={!!publishModal}
        onClose={() => setPublishModal(null)}
        title="Publish campaign"
        footer={
          <Button variant="primary" disabled={!!publishModal?.errors.length} loading={publish.isPending} onClick={() => publish.mutate()}>
            {publishModal?.warnings.length ? 'Publish anyway' : 'Publish'}
          </Button>
        }
      >
        {publishModal?.errors.length ? (
          <div>
            <p className="font-medium text-danger">Fix these before publishing:</p>
            <ul className="list-disc pl-5 text-sm">{publishModal.errors.map((e) => <li key={e}>{e}</li>)}</ul>
          </div>
        ) : null}
        {publishModal?.warnings.length ? (
          <div>
            <p className="font-medium text-warning">Warnings</p>
            <ul className="list-disc pl-5 text-sm">{publishModal.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          </div>
        ) : null}
        {!publishModal?.errors.length && !publishModal?.warnings.length && <p className="text-sm">This creates a new version. Live calls switch to it immediately.</p>}
      </Modal>
    </div>
  );
}

function AgentSection({ config, setConfig, readOnly }: SectionProps) {
  const agents = useQuery({ queryKey: ['agents'], queryFn: () => api.get<Agent[]>('/api/agents') });
  const numbers = useQuery({ queryKey: ['phone-numbers'], queryFn: () => api.get<PhoneNumber[]>('/api/phone-numbers') });
  return (
    <Card>
      <div className="max-w-xl space-y-4">
        <Field label="Agent">
          <Select disabled={readOnly} value={config.agent_id ?? ''} onChange={(e) => setConfig({ ...config, agent_id: e.target.value || null })}>
            <option value="">Choose an agent</option>
            {(agents.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.name} {a.voice_name ? `(${a.voice_name})` : ''}</option>)}
          </Select>
        </Field>
        <Field label="Caller ID numbers" hint="Calls rotate across the selected Twilio numbers.">
          <div className="space-y-1">
            {(numbers.data ?? []).filter((n) => n.is_active).map((n) => (
              <label key={n.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  disabled={readOnly}
                  checked={config.phone_number_ids.includes(n.id)}
                  onChange={(e) => setConfig({ ...config, phone_number_ids: e.target.checked ? [...config.phone_number_ids, n.id] : config.phone_number_ids.filter((x) => x !== n.id) })}
                />
                {n.e164} {n.label && <span className="text-muted">{n.label}</span>}
              </label>
            ))}
          </div>
        </Field>
      </div>
    </Card>
  );
}

function CallingSection({ config, setConfig, readOnly }: SectionProps) {
  const w = config.calling_window;
  const num = (k: 'concurrency' | 'max_attempts' | 'retry_delay_minutes') => (
    <Input type="number" min={1} disabled={readOnly} value={config[k]} onChange={(e) => setConfig({ ...config, [k]: Number(e.target.value) })} />
  );
  return (
    <Card>
      <div className="grid gap-4 md:grid-cols-3 max-w-3xl">
        <Field label="Concurrent calls">{num('concurrency')}</Field>
        <Field label="Max attempts per lead">{num('max_attempts')}</Field>
        <Field label="Retry delay (minutes)">{num('retry_delay_minutes')}</Field>
      </div>
      <div className="mt-6 max-w-3xl space-y-3">
        <p className="text-sm font-medium">Calling window (lead’s local time)</p>
        <div className="flex flex-wrap gap-2">
          {DAYS.map((d, i) => {
            const day = i + 1;
            const on = w.days.includes(day);
            return (
              <button
                key={d}
                type="button"
                disabled={readOnly}
                onClick={() => setConfig({ ...config, calling_window: { ...w, days: on ? w.days.filter((x) => x !== day) : [...w.days, day].sort() } })}
                className={on ? 'rounded-md bg-primary px-3 py-1 text-sm text-primary-fg' : 'rounded-md border border-border px-3 py-1 text-sm'}
              >
                {d}
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-2 gap-3 max-w-sm">
          <Field label="From"><Input type="time" disabled={readOnly} value={w.start} onChange={(e) => setConfig({ ...config, calling_window: { ...w, start: e.target.value } })} /></Field>
          <Field label="To"><Input type="time" disabled={readOnly} value={w.end} onChange={(e) => setConfig({ ...config, calling_window: { ...w, end: e.target.value } })} /></Field>
        </div>
      </div>
    </Card>
  );
}

function LeadsSection({ campaignId, states, readOnly, onChange }: { campaignId: string; states: Record<string, number>; readOnly: boolean; onChange(): void }) {
  const lists = useQuery({ queryKey: ['lead-lists'], queryFn: () => api.get<{ id: string; name: string; lead_count: number }[]>('/api/lead-lists') });
  const [listId, setListId] = useState('');
  const add = useMutation({ mutationFn: () => api.post<{ added: number }>(`/api/campaigns/${campaignId}/leads`, { lead_list_id: listId }), onSuccess: onChange });
  const stat = (label: string, n: ReactNode) => (
    <div className="rounded-md border border-border p-3"><p className="text-xs text-muted">{label}</p><p className="text-lg font-semibold">{n}</p></div>
  );
  return (
    <Card>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5 mb-6">
        {stat('Queued', states.queued ?? 0)}
        {stat('Dialing', states.dialing ?? 0)}
        {stat('Waiting to retry', states.retry_wait ?? 0)}
        {stat('Done', states.done ?? 0)}
        {stat('Removed', states.removed ?? 0)}
      </div>
      {!readOnly && (
        <div className="flex flex-wrap items-end gap-2 max-w-xl">
          <Field label="Add leads from list">
            <Select value={listId} onChange={(e) => setListId(e.target.value)}>
              <option value="">Choose a list</option>
              {(lists.data ?? []).map((l) => <option key={l.id} value={l.id}>{l.name} ({l.lead_count})</option>)}
            </Select>
          </Field>
          <Button disabled={!listId} loading={add.isPending} onClick={() => add.mutate()}>Add</Button>
        </div>
      )}
      {add.data && <p className="mt-2 text-sm text-success">Added {add.data.added} leads (DNC and finished leads are skipped).</p>}
      <ErrorText error={add.error} />
    </Card>
  );
}
