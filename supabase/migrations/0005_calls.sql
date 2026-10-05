-- 0005 Calls and the live call event stream (transcripts, status, tool activity).

create table public.calls (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete set null,
  campaign_version_id uuid references public.campaign_versions(id) on delete set null,
  campaign_lead_id uuid references public.campaign_leads(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  phone_number_id uuid references public.phone_numbers(id) on delete set null,
  vapi_call_id text unique,
  to_number text not null,
  from_number text,
  status text not null default 'queued' check (status in ('queued', 'ringing', 'in_progress', 'ended', 'failed')),
  ended_reason text,
  connected boolean not null default false,
  voicemail boolean not null default false,
  dnc_requested boolean not null default false,
  transferred boolean not null default false,
  -- Whether the booking tools were sent with this call (false if Vapi rejected them and we retried without).
  booking_tools_enabled boolean not null default false,
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer,
  recording_url text,
  transcript text,
  summary text,
  analysis jsonb not null default '{}'::jsonb,
  cost numeric(10,4),
  disposition_key text,
  error text,
  -- Idempotency markers for the end-of-call pipeline and the post-call summary step.
  end_processed_at timestamptz,
  summary_processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index calls_org_created_idx on public.calls(organization_id, created_at desc);
create index calls_campaign_idx on public.calls(campaign_id, created_at desc);
create index calls_lead_idx on public.calls(lead_id);
create index calls_open_idx on public.calls(status, created_at) where end_processed_at is null;
create index calls_summary_pending_idx on public.calls(end_processed_at) where summary_processed_at is null and end_processed_at is not null;
create trigger calls_updated_at before update on public.calls
  for each row execute function public.set_updated_at();

alter table public.campaign_leads
  add constraint campaign_leads_last_call_fk foreign key (last_call_id) references public.calls(id) on delete set null;

create table public.call_events (
  id bigserial primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  call_id uuid not null references public.calls(id) on delete cascade,
  type text not null check (type in ('status', 'transcript', 'tool', 'booking', 'system')),
  role text,
  content text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index call_events_call_idx on public.call_events(call_id, id);
create index call_events_org_idx on public.call_events(organization_id, created_at desc);

alter table public.calls enable row level security;
alter table public.call_events enable row level security;

create policy calls_select on public.calls for select to authenticated
  using (public.has_permission(organization_id, 'calls.view') or public.has_permission(organization_id, 'monitor.view'));
create policy call_events_select on public.call_events for select to authenticated
  using (public.has_permission(organization_id, 'calls.view') or public.has_permission(organization_id, 'monitor.view'));

-- Live monitor subscribes to these through Supabase Realtime (RLS applies).
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.calls, public.call_events;
  end if;
end $$;
