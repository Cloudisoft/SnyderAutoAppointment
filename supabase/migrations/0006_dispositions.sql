-- 0006 Disposition rules. Evaluated in ascending priority; the first matching rule wins.

create table public.dispositions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  label text not null,
  priority integer not null,
  -- All present conditions must match. Keys: connected, voicemail, no_answer, busy, failed, dnc_requested,
  -- transferred, appointment_booked (booleans), ended_reasons (text[]), min_duration_seconds, max_duration_seconds.
  conditions jsonb not null default '{}'::jsonb,
  -- Lead status to set (null = leave unchanged).
  lead_status text,
  -- Whether the lead may be dialed again (subject to max attempts).
  retry boolean not null default false,
  is_system boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, key)
);
create index dispositions_org_priority_idx on public.dispositions(organization_id, priority);

create table public.default_dispositions (
  key text primary key,
  label text not null,
  priority integer not null,
  conditions jsonb not null,
  lead_status text,
  retry boolean not null
);

-- Priorities leave gaps so feature rules can slot in (e.g. "Appointment booked" at 30).
insert into public.default_dispositions(key, label, priority, conditions, lead_status, retry) values
  ('do_not_call',    'Do not call',    10,  '{"dnc_requested": true}', 'do_not_call', false),
  ('voicemail',      'Voicemail',      20,  '{"voicemail": true}',     null,          true),
  ('transferred',    'Transferred',    40,  '{"transferred": true}',   'contacted',   false),
  ('call_connected', 'Call connected', 50,  '{"connected": true}',     'contacted',   false),
  ('no_answer',      'No answer',      60,  '{"no_answer": true}',     null,          true),
  ('busy',           'Busy',           70,  '{"busy": true}',          null,          true),
  ('failed',         'Call failed',    80,  '{"failed": true}',        null,          true),
  ('other',          'Other',          1000, '{}',                     null,          true);

create or replace function public.seed_default_dispositions(org uuid) returns void
language sql security definer set search_path = public as $$
  insert into dispositions(organization_id, key, label, priority, conditions, lead_status, retry, is_system)
  select org, key, label, priority, conditions, lead_status, retry, true from default_dispositions
  on conflict (organization_id, key) do nothing
$$;

create or replace function public.organizations_seed_dispositions() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform seed_default_dispositions(new.id);
  return new;
end $$;
create trigger organizations_seed_dispositions after insert on public.organizations
  for each row execute function public.organizations_seed_dispositions();

select public.seed_default_dispositions(id) from public.organizations;

alter table public.dispositions enable row level security;
alter table public.default_dispositions enable row level security;
create policy dispositions_select on public.dispositions for select to authenticated
  using (public.is_org_member(organization_id));
create policy dispositions_write on public.dispositions for all to authenticated
  using (public.has_permission(organization_id, 'settings.manage'))
  with check (public.has_permission(organization_id, 'settings.manage'));
