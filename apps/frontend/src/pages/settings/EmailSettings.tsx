import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { Badge, Button, Card, ErrorText, Field, Input, Select } from '../../components/ui';
import { api } from '../../lib/api';
import { formatRelative } from '../../lib/format';

interface SmtpView {
  configured: boolean;
  platform_fallback: boolean;
  host?: string;
  port?: number;
  secure?: boolean;
  username?: string | null;
  has_password?: boolean;
  from_email?: string;
  from_name?: string | null;
  reply_to?: string | null;
  last_tested_at?: string | null;
  last_test_ok?: boolean | null;
  last_test_error?: string | null;
}

const PRESETS: { label: string; host: string; port: number; secure: boolean; hint?: string }[] = [
  { label: 'Google Workspace / Gmail', host: 'smtp.gmail.com', port: 587, secure: false, hint: 'Use an app password.' },
  { label: 'Microsoft 365 / Outlook', host: 'smtp.office365.com', port: 587, secure: false },
  { label: 'SendGrid', host: 'smtp.sendgrid.net', port: 587, secure: false, hint: 'Username is literally "apikey"; password is your API key.' },
  { label: 'Postmark', host: 'smtp.postmarkapp.com', port: 587, secure: false, hint: 'Username and password are your server token.' },
  { label: 'Amazon SES (us-east-1)', host: 'email-smtp.us-east-1.amazonaws.com', port: 587, secure: false },
  { label: 'Mailgun', host: 'smtp.mailgun.org', port: 587, secure: false },
];

const empty = { host: '', port: 587, secure: false, username: '', password: '', from_email: '', from_name: '', reply_to: '' };

/** Settings > Email: the organization's own SMTP server for appointment emails. */
export function EmailSettings() {
  const qc = useQueryClient();
  const { session } = useAuth();
  const q = useQuery({ queryKey: ['smtp-settings'], queryFn: () => api.get<SmtpView>('/api/settings/smtp') });
  const [form, setForm] = useState(empty);
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [hint, setHint] = useState<string | undefined>();
  const [testTo, setTestTo] = useState('');

  useEffect(() => {
    const s = q.data;
    if (s?.configured) {
      setForm({ host: s.host ?? '', port: s.port ?? 587, secure: !!s.secure, username: s.username ?? '', password: '', from_email: s.from_email ?? '', from_name: s.from_name ?? '', reply_to: s.reply_to ?? '' });
      setPasswordTouched(false);
    }
  }, [q.data]);
  useEffect(() => setTestTo((t) => t || session?.user.email || ''), [session]);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm({ ...form, [k]: v });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['smtp-settings'] });
  const save = useMutation({
    mutationFn: () => {
      const { password, ...rest } = form;
      return api.put<SmtpView>('/api/settings/smtp', { ...rest, ...(passwordTouched ? { password } : {}) });
    },
    onSuccess: invalidate,
  });
  const test = useMutation({ mutationFn: () => api.post<{ to: string }>('/api/settings/smtp/test', { to: testTo || undefined }), onSettled: invalidate });
  const remove = useMutation({ mutationFn: () => api.del('/api/settings/smtp'), onSuccess: () => { setForm(empty); invalidate(); } });
  const s = q.data;

  return (
    <div className="space-y-4">
      <Card
        title="Email (SMTP)"
        actions={
          s?.configured ? (
            s.last_test_ok ? <Badge tone="green">Working</Badge> : s.last_test_ok === false ? <Badge tone="red">Test failed</Badge> : <Badge tone="amber">Not tested</Badge>
          ) : (
            <Badge tone={s?.platform_fallback ? 'blue' : 'amber'}>{s?.platform_fallback ? 'Using platform email' : 'Not set up'}</Badge>
          )
        }
      >
        <p className="mb-4 text-sm text-muted">
          Appointment confirmations, reminders, reschedules, cancellations and host notices are sent through this server, from your address.
          {!s?.configured && !s?.platform_fallback && ' Until it is set up, those emails wait in the queue and send once it works.'}
        </p>
        <form className="grid max-w-3xl gap-4 md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <div className="md:col-span-2">
            <Field label="Provider preset" hint={hint}>
              <Select
                value=""
                onChange={(e) => {
                  const p = PRESETS.find((x) => x.label === e.target.value);
                  if (p) {
                    setForm({ ...form, host: p.host, port: p.port, secure: p.secure });
                    setHint(p.hint);
                  }
                }}
              >
                <option value="">Fill in from a common provider…</option>
                {PRESETS.map((p) => <option key={p.label} value={p.label}>{p.label}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="SMTP host"><Input required value={form.host} onChange={(e) => set('host', e.target.value.trim())} placeholder="smtp.example.com" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Port"><Input required type="number" min={1} max={65535} value={form.port} onChange={(e) => set('port', Number(e.target.value))} /></Field>
            <Field label="Security">
              <Select value={form.secure ? 'tls' : 'starttls'} onChange={(e) => set('secure', e.target.value === 'tls')}>
                <option value="starttls">STARTTLS (587)</option>
                <option value="tls">SSL/TLS (465)</option>
              </Select>
            </Field>
          </div>
          <Field label="Username"><Input value={form.username} autoComplete="off" onChange={(e) => set('username', e.target.value)} /></Field>
          <Field label="Password" hint={s?.has_password && !passwordTouched ? 'Saved. Leave blank to keep it.' : 'Stored encrypted.'}>
            <Input type="password" autoComplete="new-password" value={form.password} placeholder={s?.has_password ? '••••••••' : ''} onChange={(e) => { set('password', e.target.value); setPasswordTouched(true); }} />
          </Field>
          <Field label="From email"><Input required type="email" value={form.from_email} onChange={(e) => set('from_email', e.target.value)} placeholder="appointments@yourcompany.com" /></Field>
          <Field label="From name" hint="Defaults to the campaign’s business name."><Input value={form.from_name} onChange={(e) => set('from_name', e.target.value)} /></Field>
          <Field label="Reply-to (optional)"><Input type="email" value={form.reply_to} onChange={(e) => set('reply_to', e.target.value)} /></Field>
          <div className="flex flex-wrap items-end gap-2 md:col-span-2">
            <Button variant="primary" loading={save.isPending}>Save</Button>
            {s?.configured && <Button type="button" variant="ghost" className="text-danger" loading={remove.isPending} onClick={() => remove.mutate()}>Remove</Button>}
          </div>
          <div className="md:col-span-2"><ErrorText error={save.error ?? remove.error} /></div>
        </form>
      </Card>

      {s?.configured && (
        <Card title="Send a test email">
          <div className="flex max-w-xl flex-wrap items-end gap-2">
            <Field label="Send to"><Input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} /></Field>
            <Button loading={test.isPending} onClick={() => test.mutate()}>Send test</Button>
          </div>
          {test.isSuccess && <p className="mt-3 text-sm text-success animate-fade-in">Test email sent to {test.data.to}. Check the inbox (and spam folder).</p>}
          <ErrorText error={test.error} />
          {s.last_tested_at && (
            <p className="mt-3 text-xs text-muted">
              Last tested {formatRelative(s.last_tested_at)}: {s.last_test_ok ? 'working' : <span className="text-danger">{s.last_test_error}</span>}
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
