import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, Button, Card, ErrorText, Field, Input, Modal, Select, Table, Td } from '../../components/ui';
import { api } from '../../lib/api';

interface Role { id: string; key: string; name: string; is_system: boolean; permissions: string[] }
interface Permission { key: string; description: string }
interface OrgUser { id: string; email: string; full_name: string | null; role_id: string; role_name: string }

export function UsersRoles() {
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ['org-users'], queryFn: () => api.get<OrgUser[]>('/api/organization/users') });
  const roles = useQuery({ queryKey: ['org-roles'], queryFn: () => api.get<{ roles: Role[]; permissions: Permission[] }>('/api/organization/roles') });
  const [invite, setInvite] = useState(false);
  const [email, setEmail] = useState('');
  const [roleId, setRoleId] = useState('');
  const [editing, setEditing] = useState<Role | null>(null);
  const [newRole, setNewRole] = useState('');

  const inviteM = useMutation({
    mutationFn: () => api.post('/api/organization/users', { email, role_id: roleId }),
    onSuccess: () => { setInvite(false); setEmail(''); qc.invalidateQueries({ queryKey: ['org-users'] }); },
  });
  const changeRole = useMutation({
    mutationFn: (v: { userId: string; roleId: string }) => api.patch(`/api/organization/users/${v.userId}`, { role_id: v.roleId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org-users'] }),
  });
  const savePerms = useMutation({
    mutationFn: (r: Role) => api.put(`/api/organization/roles/${r.id}/permissions`, { permissions: r.permissions }),
    onSuccess: () => { setEditing(null); qc.invalidateQueries({ queryKey: ['org-roles'] }); },
  });
  const createRole = useMutation({
    mutationFn: () => api.post('/api/organization/roles', { name: newRole }),
    onSuccess: () => { setNewRole(''); qc.invalidateQueries({ queryKey: ['org-roles'] }); },
  });
  const roleList = roles.data?.roles ?? [];

  return (
    <div className="space-y-6">
      <Card title="Users" actions={<Button size="sm" variant="primary" onClick={() => { setRoleId(roleList[0]?.id ?? ''); setInvite(true); }}>Invite user</Button>}>
        <Table head={['Email', 'Name', 'Role']}>
          {(users.data ?? []).map((u) => (
            <tr key={u.id}>
              <Td>{u.email}</Td>
              <Td>{u.full_name ?? '—'}</Td>
              <Td>
                <Select value={u.role_id} onChange={(e) => changeRole.mutate({ userId: u.id, roleId: e.target.value })} className="max-w-48">
                  {roleList.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </Select>
              </Td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card title="Roles & permissions">
        <ul className="divide-y divide-border">
          {roleList.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div>
                <span className="font-medium">{r.name}</span> {r.is_system && <Badge>System</Badge>}
                <p className="text-xs text-muted">{r.permissions.length} permissions</p>
              </div>
              {r.key !== 'owner' && <Button size="sm" onClick={() => setEditing({ ...r })}>Edit permissions</Button>}
            </li>
          ))}
        </ul>
        <form className="mt-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); createRole.mutate(); }}>
          <Input placeholder="New role name" value={newRole} onChange={(e) => setNewRole(e.target.value)} />
          <Button disabled={!newRole} loading={createRole.isPending}>Add role</Button>
        </form>
      </Card>

      <Modal open={invite} onClose={() => setInvite(false)} title="Invite user" footer={<Button variant="primary" loading={inviteM.isPending} onClick={() => inviteM.mutate()}>Send invite</Button>}>
        <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Role">
          <Select value={roleId} onChange={(e) => setRoleId(e.target.value)}>{roleList.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>
        </Field>
        <ErrorText error={inviteM.error} />
      </Modal>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={`Permissions: ${editing?.name ?? ''}`} footer={<Button variant="primary" loading={savePerms.isPending} onClick={() => editing && savePerms.mutate(editing)}>Save</Button>}>
        <div className="space-y-2">
          {(roles.data?.permissions ?? []).map((p) => (
            <label key={p.key} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={!!editing?.permissions.includes(p.key)}
                onChange={(e) => editing && setEditing({ ...editing, permissions: e.target.checked ? [...editing.permissions, p.key] : editing.permissions.filter((k) => k !== p.key) })}
              />
              <span><code className="text-xs">{p.key}</code><br /><span className="text-muted">{p.description}</span></span>
            </label>
          ))}
        </div>
        <ErrorText error={savePerms.error} />
      </Modal>
    </div>
  );
}
