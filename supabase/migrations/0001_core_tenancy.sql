-- 0001 Core tenancy: organizations, profiles, roles, permissions, memberships.
-- Every tenant table in later migrations carries organization_id and uses the RLS helpers below.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  time_zone text not null default 'America/New_York',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger organizations_updated_at before update on public.organizations
  for each row execute function public.set_updated_at();

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  created_at timestamptz not null default now()
);

create table public.permissions (
  key text primary key,
  description text not null
);

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  name text not null,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  unique (organization_id, key)
);

create table public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_key text not null references public.permissions(key) on delete cascade,
  primary key (role_id, permission_key)
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role_id uuid not null references public.roles(id),
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);
create index memberships_user_idx on public.memberships(user_id);

-- Default grants for system roles. Later migrations add rows here and call
-- grant_default_permissions() so existing organizations pick them up.
create table public.default_role_permissions (
  role_key text not null,
  permission_key text not null references public.permissions(key) on delete cascade,
  primary key (role_key, permission_key)
);

insert into public.permissions(key, description) values
  ('org.manage', 'Edit organization settings'),
  ('users.manage', 'Invite users and assign roles'),
  ('leads.view', 'View leads and lead lists'),
  ('leads.manage', 'Create, import and edit leads'),
  ('campaigns.view', 'View campaigns'),
  ('campaigns.manage', 'Create, edit and publish campaigns'),
  ('calls.view', 'View call records, recordings and transcripts'),
  ('monitor.view', 'View the live call monitor'),
  ('settings.manage', 'Manage voices, numbers, agents and dispositions'),
  ('dashboard.view', 'View dashboard and analytics');

insert into public.default_role_permissions(role_key, permission_key)
select r.role_key, p.key
from (values ('owner'), ('admin')) r(role_key)
cross join public.permissions p;

insert into public.default_role_permissions(role_key, permission_key) values
  ('supervisor', 'leads.view'), ('supervisor', 'leads.manage'),
  ('supervisor', 'campaigns.view'), ('supervisor', 'calls.view'),
  ('supervisor', 'monitor.view'), ('supervisor', 'dashboard.view'),
  ('viewer', 'leads.view'), ('viewer', 'campaigns.view'),
  ('viewer', 'calls.view'), ('viewer', 'dashboard.view');

-- Creates the system roles for an organization and (re)applies default grants. Idempotent.
create or replace function public.grant_default_permissions(org uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into roles(organization_id, key, name, is_system) values
    (org, 'owner', 'Owner', true),
    (org, 'admin', 'Admin', true),
    (org, 'supervisor', 'Supervisor', true),
    (org, 'viewer', 'Viewer', true)
  on conflict (organization_id, key) do nothing;

  insert into role_permissions(role_id, permission_key)
  select r.id, d.permission_key
  from roles r join default_role_permissions d on d.role_key = r.key
  where r.organization_id = org and r.is_system
  on conflict do nothing;
end $$;

create or replace function public.organizations_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform grant_default_permissions(new.id);
  return new;
end $$;
create trigger organizations_seed after insert on public.organizations
  for each row execute function public.organizations_after_insert();

-- ---------------------------------------------------------------------------
-- RLS helpers. SECURITY DEFINER so policies can read memberships without recursion.
-- ---------------------------------------------------------------------------
create or replace function public.is_org_member(org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m where m.organization_id = org and m.user_id = auth.uid())
$$;

create or replace function public.has_permission(org uuid, perm text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from memberships m
    join role_permissions rp on rp.role_id = m.role_id
    where m.organization_id = org and m.user_id = auth.uid() and rp.permission_key = perm
  )
$$;

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.permissions enable row level security;
alter table public.roles enable row level security;
alter table public.role_permissions enable row level security;
alter table public.memberships enable row level security;
alter table public.default_role_permissions enable row level security;

create policy organizations_select on public.organizations for select to authenticated
  using (public.is_org_member(id));
create policy organizations_update on public.organizations for update to authenticated
  using (public.has_permission(id, 'org.manage')) with check (public.has_permission(id, 'org.manage'));

create policy profiles_select on public.profiles for select to authenticated
  using (
    id = auth.uid() or exists (
      select 1 from public.memberships mine
      join public.memberships theirs on theirs.organization_id = mine.organization_id
      where mine.user_id = auth.uid() and theirs.user_id = profiles.id
    )
  );
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy permissions_select on public.permissions for select to authenticated using (true);

create policy roles_select on public.roles for select to authenticated
  using (public.is_org_member(organization_id));
create policy roles_manage on public.roles for all to authenticated
  using (public.has_permission(organization_id, 'users.manage'))
  with check (public.has_permission(organization_id, 'users.manage'));

create policy role_permissions_select on public.role_permissions for select to authenticated
  using (exists (select 1 from public.roles r where r.id = role_id and public.is_org_member(r.organization_id)));
create policy role_permissions_manage on public.role_permissions for all to authenticated
  using (exists (select 1 from public.roles r where r.id = role_id and public.has_permission(r.organization_id, 'users.manage')))
  with check (exists (select 1 from public.roles r where r.id = role_id and public.has_permission(r.organization_id, 'users.manage')));

create policy memberships_select on public.memberships for select to authenticated
  using (public.is_org_member(organization_id));
create policy memberships_manage on public.memberships for all to authenticated
  using (public.has_permission(organization_id, 'users.manage'))
  with check (public.has_permission(organization_id, 'users.manage'));

-- ---------------------------------------------------------------------------
-- In-app notifications. user_id null = everyone in the org holding `permission`.
-- ---------------------------------------------------------------------------
create table public.in_app_notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  permission text references public.permissions(key),
  type text not null,
  title text not null,
  body text,
  link text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index in_app_notifications_org_idx on public.in_app_notifications(organization_id, created_at desc);

create table public.in_app_notification_reads (
  notification_id uuid not null references public.in_app_notifications(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (notification_id, user_id)
);

alter table public.in_app_notifications enable row level security;
alter table public.in_app_notification_reads enable row level security;

create policy in_app_notifications_select on public.in_app_notifications for select to authenticated
  using (
    public.is_org_member(organization_id)
    and (user_id = auth.uid() or (user_id is null and (permission is null or public.has_permission(organization_id, permission))))
  );
create policy in_app_notification_reads_own on public.in_app_notification_reads for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
