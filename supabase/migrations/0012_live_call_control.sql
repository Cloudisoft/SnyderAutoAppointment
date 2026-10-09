-- 0012 Live call supervision: per-call listen/control URLs and the permission to take over calls.

-- Listen/control URLs grant access to a live call, so they live in their own table with no
-- client policies: only the backend (service role) can read them, and only while the call is live.
create table public.call_monitors (
  call_id uuid primary key references public.calls(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  listen_url text,
  control_url text,
  -- Set when the server completed a transfer/hang-up the assistant announced but did not perform.
  auto_transfer_at timestamptz,
  auto_end_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.call_monitors enable row level security;

insert into public.permissions(key, description) values
  ('monitor.control', 'Listen to live calls, speak into them, transfer or end them')
on conflict (key) do nothing;

insert into public.default_role_permissions(role_key, permission_key) values
  ('owner', 'monitor.control'), ('admin', 'monitor.control'), ('supervisor', 'monitor.control')
on conflict do nothing;

select public.grant_default_permissions(id) from public.organizations;
