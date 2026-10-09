-- 0013 Google Calendar / Google Meet and Zoom: organization connections and per-appointment meetings.

alter table public.appointment_types drop constraint if exists appointment_types_location_type_check;
alter table public.appointment_types add constraint appointment_types_location_type_check
  check (location_type in ('phone', 'video', 'in_person', 'custom', 'google_meet', 'zoom'));

-- One connected account per provider per organization. Tokens are in Vault; no client policies
-- (the backend reads this table, the app sees it only through the API).
create table public.organization_integrations (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null check (provider in ('google', 'zoom')),
  account_email text,
  account_name text,
  refresh_token_secret_id uuid not null,
  scopes text,
  status text not null default 'connected' check (status in ('connected', 'error')),
  last_error text,
  connected_by uuid references auth.users(id) on delete set null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, provider)
);
alter table public.organization_integrations enable row level security;
create trigger organization_integrations_updated_at before update on public.organization_integrations
  for each row execute function public.set_updated_at();

-- The calendar event / video meeting behind each appointment, kept in sync on reschedule/cancel.
create table public.appointment_meetings (
  appointment_id uuid primary key references public.appointments(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text check (provider in ('google_meet', 'zoom')),
  join_url text,
  zoom_meeting_id text,
  google_event_id text,
  -- appointments.version this meeting reflects; lower means it needs updating.
  synced_version integer not null default 0,
  status text not null default 'pending' check (status in ('pending', 'synced', 'failed', 'deleted')),
  attempts integer not null default 0,
  last_error text,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index appointment_meetings_retry_idx on public.appointment_meetings(next_attempt_at) where status in ('pending', 'failed');
alter table public.appointment_meetings enable row level security;
create policy appointment_meetings_select on public.appointment_meetings for select to authenticated
  using (public.has_permission(organization_id, 'appointments.view'));
create trigger appointment_meetings_updated_at before update on public.appointment_meetings
  for each row execute function public.set_updated_at();

alter table public.appointment_events drop constraint if exists appointment_events_type_check;
alter table public.appointment_events add constraint appointment_events_type_check check (type in (
  'booked', 'confirmed', 'rescheduled', 'cancelled', 'completed', 'no_show',
  'email_sent', 'email_failed', 'hold_released', 'needs_review', 'notification_skipped',
  'meeting_created', 'meeting_updated', 'meeting_failed'
));
