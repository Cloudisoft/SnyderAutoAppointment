-- 0004 Agents, knowledge bases, campaigns with immutable published versions, campaign leads.

create table public.knowledge_bases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  -- Id of the Vapi "query" tool that searches this knowledge base.
  vapi_tool_id text not null,
  created_at timestamptz not null default now()
);

create table public.agents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  voice_id uuid references public.voices(id) on delete set null,
  system_prompt text not null default '',
  first_message text not null default '',
  model text not null default 'gpt-4o',
  temperature numeric(3,2) not null default 0.5 check (temperature between 0 and 2),
  transfer_number text,
  end_call_message text,
  knowledge_base_id uuid references public.knowledge_bases(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger agents_updated_at before update on public.agents
  for each row execute function public.set_updated_at();

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'archived')),
  -- Editable configuration. Publishing freezes it (plus resolved agent/voice/numbers) into a version.
  draft jsonb not null default '{}'::jsonb,
  current_version_id uuid,
  has_unpublished_changes boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index campaigns_org_idx on public.campaigns(organization_id);
create trigger campaigns_updated_at before update on public.campaigns
  for each row execute function public.set_updated_at();

create table public.campaign_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  version integer not null,
  snapshot jsonb not null,
  published_by uuid references auth.users(id),
  published_at timestamptz not null default now(),
  unique (campaign_id, version)
);
alter table public.campaigns
  add constraint campaigns_current_version_fk foreign key (current_version_id)
  references public.campaign_versions(id) on delete set null;

-- Versions are immutable once published.
create or replace function public.campaign_versions_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'campaign_versions are immutable';
end $$;
create trigger campaign_versions_no_update before update on public.campaign_versions
  for each row execute function public.campaign_versions_immutable();

create table public.campaign_leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  state text not null default 'queued' check (state in ('queued', 'dialing', 'retry_wait', 'done', 'removed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_call_id uuid,
  last_disposition text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, lead_id)
);
create index campaign_leads_due_idx on public.campaign_leads(campaign_id, state, next_attempt_at);
create trigger campaign_leads_updated_at before update on public.campaign_leads
  for each row execute function public.set_updated_at();

alter table public.knowledge_bases enable row level security;
alter table public.agents enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_versions enable row level security;
alter table public.campaign_leads enable row level security;

create policy knowledge_bases_select on public.knowledge_bases for select to authenticated
  using (public.is_org_member(organization_id));
create policy knowledge_bases_write on public.knowledge_bases for all to authenticated
  using (public.has_permission(organization_id, 'settings.manage'))
  with check (public.has_permission(organization_id, 'settings.manage'));

create policy agents_select on public.agents for select to authenticated
  using (public.is_org_member(organization_id));
create policy agents_write on public.agents for all to authenticated
  using (public.has_permission(organization_id, 'settings.manage'))
  with check (public.has_permission(organization_id, 'settings.manage'));

create policy campaigns_select on public.campaigns for select to authenticated
  using (public.has_permission(organization_id, 'campaigns.view'));
create policy campaigns_write on public.campaigns for all to authenticated
  using (public.has_permission(organization_id, 'campaigns.manage'))
  with check (public.has_permission(organization_id, 'campaigns.manage'));

create policy campaign_versions_select on public.campaign_versions for select to authenticated
  using (public.has_permission(organization_id, 'campaigns.view'));

create policy campaign_leads_select on public.campaign_leads for select to authenticated
  using (public.has_permission(organization_id, 'campaigns.view'));
create policy campaign_leads_write on public.campaign_leads for all to authenticated
  using (public.has_permission(organization_id, 'campaigns.manage'))
  with check (public.has_permission(organization_id, 'campaigns.manage'));
