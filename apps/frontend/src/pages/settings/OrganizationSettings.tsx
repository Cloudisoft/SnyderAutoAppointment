import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { Button, Card, ErrorText, Field, Input } from '../../components/ui';
import { TimeZoneSelect } from '../../components/TimeZoneSelect';
import { api } from '../../lib/api';

export function OrganizationSettings() {
  const { org, refresh } = useAuth();
  const [name, setName] = useState(org?.name ?? '');
  const [tz, setTz] = useState(org?.time_zone ?? 'America/New_York');
  useEffect(() => {
    if (org) {
      setName(org.name);
      setTz(org.time_zone);
    }
  }, [org]);
  const save = useMutation({ mutationFn: () => api.patch('/api/organization', { name, time_zone: tz }), onSuccess: () => refresh() });
  return (
    <Card title="Organization">
      <form className="space-y-4 max-w-md" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Default time zone"><TimeZoneSelect value={tz} onChange={setTz} /></Field>
        <ErrorText error={save.error} />
        <Button variant="primary" loading={save.isPending}>Save</Button>
      </form>
    </Card>
  );
}
