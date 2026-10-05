import { DEFAULT_CONFIRMATION_BODY, DEFAULT_CONFIRMATION_SUBJECT, HOST_STRATEGIES, parseAppointmentSettings, type AppointmentSettings } from '@snyder/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Card, Field, Input, Select, Textarea, Toggle } from '../../components/ui';
import { api } from '../../lib/api';
import type { SectionProps } from '../CampaignEditor';
import type { AppointmentType, Host } from '../settings/AppointmentSettings';

const STRATEGY_LABELS: Record<(typeof HOST_STRATEGIES)[number], string> = {
  specific_host: 'Specific host',
  round_robin: 'Round robin',
  least_booked: 'Least booked',
};

function offsetLabel(m: number) {
  return m % 1440 === 0 ? `${m / 1440}d` : m % 60 === 0 ? `${m / 60}h` : `${m}m`;
}

/** Campaign editor section; saved into the draft and frozen into the version on Save & publish. */
export function AppointmentsSection({ config, setConfig, readOnly }: SectionProps) {
  const s = parseAppointmentSettings(config.appointments ?? {});
  const set = (patch: Partial<AppointmentSettings>) => setConfig({ ...config, appointments: { ...s, ...patch } });
  const types = useQuery({ queryKey: ['appointment-types'], queryFn: () => api.get<AppointmentType[]>('/api/appointment-types') });
  const hosts = useQuery({ queryKey: ['appointment-hosts'], queryFn: () => api.get<Host[]>('/api/appointment-hosts') });
  const [newOffset, setNewOffset] = useState('');
  const pool = s.host_assignment.strategy === 'specific_host' ? s.host_assignment.host_ids.slice(0, 1) : s.host_assignment.host_ids;
  const poolHasHours = (hosts.data ?? []).some((h) => pool.includes(h.id) && h.is_active && h.rules.length > 0);
  const n = (k: 'min_notice_minutes' | 'max_days_ahead' | 'slots_to_offer' | 'hold_minutes', min = 0) => (
    <Input type="number" min={min} disabled={readOnly} value={s[k]} onChange={(e) => set({ [k]: Number(e.target.value) } as Partial<AppointmentSettings>)} />
  );

  return (
    <div className="space-y-4">
      <Card>
        <Toggle checked={s.booking_enabled} onChange={(v) => !readOnly && set({ booking_enabled: v })} label="Let the AI book appointments on calls" />
        <p className="mt-2 text-sm text-muted">
          When on, each call gets check_availability and book_appointment tools plus booking rules. Campaigns with booking off behave exactly as before.
        </p>
        {s.booking_enabled && !poolHasHours && hosts.data && (
          <p className="mt-3 rounded-md border border-warning/40 bg-warning/10 p-2 text-sm">
            No active host in the pool has weekly availability yet, so the AI would have no slots to offer. <Link className="underline" to="/settings/appointments">Set up hosts</Link>
          </p>
        )}
      </Card>
      {s.booking_enabled && (
        <>
          <Card title="What and who">
            <div className="grid gap-4 md:grid-cols-2 max-w-3xl">
              <Field label="Appointment type">
                <Select disabled={readOnly} value={s.appointment_type_id ?? ''} onChange={(e) => set({ appointment_type_id: e.target.value || null })}>
                  <option value="">Choose a type</option>
                  {(types.data ?? []).filter((t) => t.is_active || t.id === s.appointment_type_id).map((t) => <option key={t.id} value={t.id}>{t.name} ({t.duration_minutes} min)</option>)}
                </Select>
              </Field>
              <Field label="Host assignment">
                <Select disabled={readOnly} value={s.host_assignment.strategy} onChange={(e) => set({ host_assignment: { ...s.host_assignment, strategy: e.target.value as AppointmentSettings['host_assignment']['strategy'] } })}>
                  {HOST_STRATEGIES.map((k) => <option key={k} value={k}>{STRATEGY_LABELS[k]}</option>)}
                </Select>
              </Field>
            </div>
            <div className="mt-4">
              <p className="text-sm font-medium">{s.host_assignment.strategy === 'specific_host' ? 'Host (first selected)' : 'Host pool'}</p>
              <div className="mt-2 space-y-1">
                {(hosts.data ?? []).map((h) => (
                  <label key={h.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      disabled={readOnly}
                      checked={s.host_assignment.host_ids.includes(h.id)}
                      onChange={(e) => set({ host_assignment: { ...s.host_assignment, host_ids: e.target.checked ? [...s.host_assignment.host_ids, h.id] : s.host_assignment.host_ids.filter((x) => x !== h.id) } })}
                    />
                    {h.display_name}
                    {!h.is_active && <Badge>Inactive</Badge>}
                    {h.rules.length === 0 && <Badge tone="amber">No hours</Badge>}
                  </label>
                ))}
                {hosts.data?.length === 0 && <p className="text-sm text-muted">No hosts yet. <Link className="underline" to="/settings/appointments">Add one</Link>.</p>}
              </div>
            </div>
          </Card>
          <Card title="Booking rules">
            <div className="grid gap-4 md:grid-cols-4 max-w-4xl">
              <Field label="Minimum notice (min)" hint="Default 120">{n('min_notice_minutes')}</Field>
              <Field label="Max days ahead" hint="Default 14">{n('max_days_ahead', 1)}</Field>
              <Field label="Slots to offer" hint="Default 3">{n('slots_to_offer', 1)}</Field>
              <Field label="Hold (min)" hint="Until the call ends. Default 15">{n('hold_minutes', 1)}</Field>
            </div>
            <div className="mt-4 flex flex-col gap-3">
              <Toggle checked={s.require_email} onChange={(v) => !readOnly && set({ require_email: v })} label="Require an email address" />
              <Toggle checked={s.requeue_on_cancel} onChange={(v) => !readOnly && set({ requeue_on_cancel: v })} label="Re-queue the lead for calling if the prospect cancels" />
              <div>
                <Toggle checked={s.sms_enabled} onChange={(v) => !readOnly && set({ sms_enabled: v })} label="Also send SMS confirmations and reminders" />
                <p className="mt-1 text-xs text-muted">Only takes effect once SMS is switched on for the platform (SMS_APPOINTMENTS_ENABLED). Email is always sent.</p>
              </div>
            </div>
            <div className="mt-4">
              <p className="text-sm font-medium">Reminders before the appointment</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {s.reminder_offsets_minutes.map((m) => (
                  <span key={m} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-3 py-1 text-sm">
                    {offsetLabel(m)}
                    {!readOnly && <button aria-label={`Remove ${offsetLabel(m)} reminder`} className="text-muted hover:text-danger" onClick={() => set({ reminder_offsets_minutes: s.reminder_offsets_minutes.filter((x) => x !== m) })}>✕</button>}
                  </span>
                ))}
                {!readOnly && s.reminder_offsets_minutes.length < 5 && (
                  <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); const v = Number(newOffset); if (v >= 5 && !s.reminder_offsets_minutes.includes(v)) set({ reminder_offsets_minutes: [...s.reminder_offsets_minutes, v].sort((a, b) => b - a) }); setNewOffset(''); }}>
                    <Input className="h-8 w-28" type="number" min={5} placeholder="minutes" value={newOffset} onChange={(e) => setNewOffset(e.target.value)} />
                  </form>
                )}
              </div>
            </div>
          </Card>
          <Card title="Confirmation email">
            <div className="max-w-3xl space-y-3">
              <Field label="Subject"><Input disabled={readOnly} value={s.confirmation_email.subject} onChange={(e) => set({ confirmation_email: { ...s.confirmation_email, subject: e.target.value } })} /></Field>
              <Field label="Body" hint="{{first_name}}, {{agent_name}}, {{campaign_name}}, {{appointment_date}}, {{appointment_time}}, {{time_zone}}, {{host_name}}, {{location}}, {{appointment_link}} and lead custom fields.">
                <Textarea rows={10} disabled={readOnly} value={s.confirmation_email.body} onChange={(e) => set({ confirmation_email: { ...s.confirmation_email, body: e.target.value } })} />
              </Field>
              {!readOnly && (
                <button className="text-sm text-muted underline" onClick={() => set({ confirmation_email: { subject: DEFAULT_CONFIRMATION_SUBJECT, body: DEFAULT_CONFIRMATION_BODY } })}>
                  Use the organization default
                </button>
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
