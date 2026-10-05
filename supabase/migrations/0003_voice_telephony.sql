-- 0003 Cartesia voices, Twilio accounts (credentials in Supabase Vault) and phone numbers imported into Vapi.

create table public.voices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null default 'cartesia' check (provider in ('cartesia')),
  model text not null default 'sonic-3',
  voice_id text not null,
  -- The voice name is what the AI introduces itself as ({{agent_name}}).
  name text not null,
  language text not null default 'en',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, provider, voice_id)
);

create table public.twilio_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  label text not null,
  account_sid text not null,
  -- Auth token lives encrypted in vault.secrets; only its id is stored here.
  auth_token_secret_id uuid not null,
  created_at timestamptz not null default now(),
  unique (organization_id, account_sid)
);

create table public.phone_numbers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  twilio_account_id uuid not null references public.twilio_accounts(id) on delete restrict,
  e164 text not null,
  label text,
  vapi_phone_number_id text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, e164)
);

alter table public.voices enable row level security;
alter table public.twilio_accounts enable row level security;
alter table public.phone_numbers enable row level security;

create policy voices_select on public.voices for select to authenticated
  using (public.is_org_member(organization_id));
create policy voices_write on public.voices for all to authenticated
  using (public.has_permission(organization_id, 'settings.manage'))
  with check (public.has_permission(organization_id, 'settings.manage'));

create policy twilio_accounts_select on public.twilio_accounts for select to authenticated
  using (public.has_permission(organization_id, 'settings.manage'));
create policy twilio_accounts_write on public.twilio_accounts for all to authenticated
  using (public.has_permission(organization_id, 'settings.manage'))
  with check (public.has_permission(organization_id, 'settings.manage'));

create policy phone_numbers_select on public.phone_numbers for select to authenticated
  using (public.is_org_member(organization_id));
create policy phone_numbers_write on public.phone_numbers for all to authenticated
  using (public.has_permission(organization_id, 'settings.manage'))
  with check (public.has_permission(organization_id, 'settings.manage'));
