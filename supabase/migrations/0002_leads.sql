-- 0002 Leads, lead lists, custom fields, email suppressions and DNC numbers.

create table public.lead_lists (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create index lead_lists_org_idx on public.lead_lists(organization_id);

create table public.lead_custom_field_defs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]*$'),
  label text not null,
  field_type text not null default 'text' check (field_type in ('text', 'number', 'date', 'boolean')),
  created_at timestamptz not null default now(),
  unique (organization_id, key)
);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_list_id uuid references public.lead_lists(id) on delete set null,
  first_name text,
  last_name text,
  email text,
  phone_e164 text not null,
  phone_digits text generated always as (regexp_replace(phone_e164, '\D', '', 'g')) stored,
  company text,
  -- Optional IANA time zone for the lead; otherwise derived from the phone number.
  time_zone text,
  custom_fields jsonb not null default '{}'::jsonb,
  status text not null default 'new',
  last_disposition text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leads_status_check check (status in (
    'new', 'queued', 'in_progress', 'contacted', 'callback', 'not_interested',
    'do_not_call', 'bad_number', 'completed'
  ))
);
create index leads_org_idx on public.leads(organization_id, created_at desc);
create index leads_list_idx on public.leads(lead_list_id);
create index leads_phone_digits_idx on public.leads(organization_id, phone_digits);
create index leads_email_idx on public.leads(organization_id, lower(email));
create trigger leads_updated_at before update on public.leads
  for each row execute function public.set_updated_at();

create table public.email_suppressions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  reason text not null default 'manual',
  created_at timestamptz not null default now()
);
create unique index email_suppressions_unique on public.email_suppressions(organization_id, lower(email));

create table public.dnc_numbers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  phone_e164 text not null,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  unique (organization_id, phone_e164)
);

alter table public.lead_lists enable row level security;
alter table public.lead_custom_field_defs enable row level security;
alter table public.leads enable row level security;
alter table public.email_suppressions enable row level security;
alter table public.dnc_numbers enable row level security;

create policy lead_lists_select on public.lead_lists for select to authenticated
  using (public.has_permission(organization_id, 'leads.view'));
create policy lead_lists_write on public.lead_lists for all to authenticated
  using (public.has_permission(organization_id, 'leads.manage'))
  with check (public.has_permission(organization_id, 'leads.manage'));

create policy lead_custom_field_defs_select on public.lead_custom_field_defs for select to authenticated
  using (public.has_permission(organization_id, 'leads.view'));
create policy lead_custom_field_defs_write on public.lead_custom_field_defs for all to authenticated
  using (public.has_permission(organization_id, 'leads.manage'))
  with check (public.has_permission(organization_id, 'leads.manage'));

create policy leads_select on public.leads for select to authenticated
  using (public.has_permission(organization_id, 'leads.view'));
create policy leads_write on public.leads for all to authenticated
  using (public.has_permission(organization_id, 'leads.manage'))
  with check (public.has_permission(organization_id, 'leads.manage'));

create policy email_suppressions_select on public.email_suppressions for select to authenticated
  using (public.has_permission(organization_id, 'leads.view'));
create policy email_suppressions_write on public.email_suppressions for all to authenticated
  using (public.has_permission(organization_id, 'leads.manage'))
  with check (public.has_permission(organization_id, 'leads.manage'));

create policy dnc_numbers_select on public.dnc_numbers for select to authenticated
  using (public.has_permission(organization_id, 'leads.view'));
create policy dnc_numbers_write on public.dnc_numbers for all to authenticated
  using (public.has_permission(organization_id, 'leads.manage'))
  with check (public.has_permission(organization_id, 'leads.manage'));
