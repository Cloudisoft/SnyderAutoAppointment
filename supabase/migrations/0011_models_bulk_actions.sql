-- 0011 New agents default to Claude Haiku 4.5 (Vapi model id; existing agents keep theirs) and calls.manage for bulk deletes.
alter table public.agents alter column model set default 'claude-haiku-4-5-20251001';

-- Deleting call records is separate from viewing them.
insert into public.permissions(key, description) values
  ('calls.manage', 'Delete call records')
on conflict (key) do nothing;

insert into public.default_role_permissions(role_key, permission_key) values
  ('owner', 'calls.manage'), ('admin', 'calls.manage')
on conflict do nothing;

select public.grant_default_permissions(id) from public.organizations;
