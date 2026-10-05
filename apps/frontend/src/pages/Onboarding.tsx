import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { Logo } from '../components/Brand';
import { Button, ErrorText, Field, Input } from '../components/ui';
import { TimeZoneSelect } from '../components/TimeZoneSelect';
import { api } from '../lib/api';

export function OnboardingPage() {
  const { refresh, signOut } = useAuth();
  const [name, setName] = useState('');
  const [tz, setTz] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const create = useMutation({
    mutationFn: () => api.post('/api/organizations', { name, time_zone: tz }),
    onSuccess: () => refresh(),
    meta: { silent: true },
  });
  return (
    <main className="min-h-screen grid place-items-center p-4">
      <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="w-full max-w-sm space-y-4 rounded-2xl border border-border bg-surface p-7 shadow-xl shadow-primary/5 animate-page-in">
        <Logo className="h-11 self-start" />
        <div>
          <h1 className="text-2xl font-extrabold">Create your organization</h1>
          <p className="mt-1 text-sm text-muted">You can invite your team once it is set up.</p>
        </div>
        <Field label="Organization name"><Input required value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Time zone"><TimeZoneSelect value={tz} onChange={setTz} /></Field>
        <ErrorText error={create.error} />
        <Button variant="primary" className="w-full" loading={create.isPending}>Continue</Button>
        <button type="button" className="w-full text-sm text-muted" onClick={() => void signOut()}>Sign out</button>
      </form>
    </main>
  );
}
