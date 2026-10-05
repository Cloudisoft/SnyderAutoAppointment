-- 0009 Auto Appointments: types, hosts, availability, appointments (double-booking prevented in the
-- database), audit events, notifications outbox, access tokens, email templates, disposition,
-- lead statuses, permissions and analytics.

create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- Permissions (wired into the roles system)
-- ---------------------------------------------------------------------------
insert into public.permissions(key, description) values
  ('appointments.view', 'View appointments'),
  ('appointments.manage', 'Confirm, reschedule, cancel and update appointments'),
  ('appointments.settings', 'Manage appointment types, hosts, availability and email templates')
on conflict (key) do nothing;

insert into public.default_role_permissions(role_key, permission_key) values
  ('owner', 'appointments.view'), ('owner', 'appointments.manage'), ('owner', 'appointments.settings'),
  ('admin', 'appointments.view'), ('admin', 'appointments.manage'), ('admin', 'appointments.settings'),
  ('supervisor', 'appointments.view'), ('supervisor', 'appointments.manage'),
  ('viewer', 'appointments.view')
on conflict do nothing;

select public.grant_default_permissions(id) from public.organizations;

-- ---------------------------------------------------------------------------
-- Lead statuses
-- ---------------------------------------------------------------------------
alter table public.leads drop constraint leads_status_check;
alter table public.leads add constraint leads_status_check check (status in (
  'new', 'queued', 'in_progress', 'contacted', 'callback', 'not_interested',
  'do_not_call', 'bad_number', 'completed', 'appointment_booked', 'appointment_cancelled'
));

-- ---------------------------------------------------------------------------
-- Disposition: "Appointment booked" sits below DNC (10) / Voicemail (20) and above
-- Call connected (50) in first-match order. Never retried.
-- ---------------------------------------------------------------------------
insert into public.default_dispositions(key, label, priority, conditions, lead_status, retry) values
  ('appointment_booked', 'Appointment booked', 30, '{"appointment_booked": true}', 'appointment_booked', false)
on conflict (key) do nothing;
select public.seed_default_dispositions(id) from public.organizations;

-- ---------------------------------------------------------------------------
-- Appointment types, hosts, availability
-- ---------------------------------------------------------------------------
create table public.appointment_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  duration_minutes integer not null check (duration_minutes between 5 and 480),
  buffer_before_minutes integer not null default 0 check (buffer_before_minutes between 0 and 240),
  buffer_after_minutes integer not null default 0 check (buffer_after_minutes between 0 and 240),
  location_type text not null default 'phone' check (location_type in ('phone', 'video', 'in_person', 'custom')),
  location_details text,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index appointment_types_org_idx on public.appointment_types(organization_id);
create trigger appointment_types_updated_at before update on public.appointment_types
  for each row execute function public.set_updated_at();

-- Who the prospect meets: an app user, or a named shared calendar (user_id null).
create table public.appointment_hosts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  display_name text not null,
  email text not null,
  time_zone text not null,
  is_active boolean not null default true,
  -- Used by round-robin assignment.
  last_assigned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index appointment_hosts_org_idx on public.appointment_hosts(organization_id);
create trigger appointment_hosts_updated_at before update on public.appointment_hosts
  for each row execute function public.set_updated_at();

-- Weekly hours in the host's time zone. weekday: ISO 1 = Monday ... 7 = Sunday.
create table public.availability_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  host_id uuid not null references public.appointment_hosts(id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7),
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default now(),
  check (end_time > start_time)
);
create index availability_rules_host_idx on public.availability_rules(host_id);

create table public.availability_exceptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  host_id uuid not null references public.appointment_hosts(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  type text not null check (type in ('blocked', 'extra_open')),
  reason text,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index availability_exceptions_host_idx on public.availability_exceptions(host_id, starts_at);

-- ---------------------------------------------------------------------------
-- Appointments
-- ---------------------------------------------------------------------------
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete set null,
  campaign_version_id uuid references public.campaign_versions(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  call_id uuid references public.calls(id) on delete set null,
  appointment_type_id uuid not null references public.appointment_types(id),
  host_id uuid not null references public.appointment_hosts(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  lead_time_zone text not null,
  status text not null default 'pending' check (status in (
    'pending', 'confirmed', 'rescheduled', 'cancelled', 'completed', 'no_show', 'needs_review'
  )),
  hold_expires_at timestamptz,
  -- Latest issued access token (SHA-256 hex). All issued tokens live in appointment_tokens.
  token_hash text unique,
  token_expires_at timestamptz,
  attendee_name text,
  attendee_email text,
  notes text,
  source text not null check (source in ('ai_tool', 'transcript_extraction', 'manual')),
  -- Increments on every reschedule. Used as the .ics SEQUENCE and in notification idempotency.
  version integer not null default 1,
  -- Buffers copied from the type at booking time; the buffered window is what may not overlap.
  buffer_before_minutes integer not null default 0,
  buffer_after_minutes integer not null default 0,
  buffered_starts_at timestamptz not null,
  buffered_ends_at timestamptz not null,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  -- No two active appointments for the same host may overlap, buffers included.
  constraint appointments_no_double_booking exclude using gist (
    host_id with =,
    tstzrange(buffered_starts_at, buffered_ends_at, '[)') with &&
  ) where (status in ('pending', 'confirmed', 'rescheduled'))
);
create index appointments_org_starts_idx on public.appointments(organization_id, starts_at);
create index appointments_call_idx on public.appointments(call_id);
create index appointments_lead_idx on public.appointments(lead_id);
create index appointments_campaign_idx on public.appointments(campaign_id, starts_at);
create index appointments_hold_idx on public.appointments(hold_expires_at) where status = 'pending';
create index appointments_noshow_idx on public.appointments(ends_at) where status in ('confirmed', 'rescheduled');

create or replace function public.appointments_set_buffers() returns trigger
language plpgsql as $$
begin
  new.buffered_starts_at := new.starts_at - make_interval(mins => new.buffer_before_minutes);
  new.buffered_ends_at := new.ends_at + make_interval(mins => new.buffer_after_minutes);
  return new;
end $$;
create trigger appointments_buffers before insert or update of starts_at, ends_at, buffer_before_minutes, buffer_after_minutes
  on public.appointments for each row execute function public.appointments_set_buffers();
create trigger appointments_updated_at before update on public.appointments
  for each row execute function public.set_updated_at();

-- Every link token ever emailed for an appointment. Only SHA-256 hashes are stored.
create table public.appointment_tokens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index appointment_tokens_appt_idx on public.appointment_tokens(appointment_id);

create table public.appointment_events (
  id bigserial primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  type text not null check (type in (
    'booked', 'confirmed', 'rescheduled', 'cancelled', 'completed', 'no_show',
    'email_sent', 'email_failed', 'hold_released', 'needs_review', 'notification_skipped'
  )),
  actor_type text not null check (actor_type in ('system', 'ai', 'user', 'prospect')),
  actor_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index appointment_events_appt_idx on public.appointment_events(appointment_id, id);

-- Outbox. The unique key makes duplicate webhooks / job runs unable to send twice.
create table public.appointment_notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  type text not null check (type ~ '^(confirmation|reschedule|cancellation|host_notice|reminder_[0-9]+[mh])$'),
  channel text not null default 'email' check (channel in ('email', 'sms')),
  appointment_version integer not null,
  recipient text,
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed', 'skipped', 'cancelled')),
  send_after timestamptz not null default now(),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  provider_message text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (appointment_id, type, channel, appointment_version)
);
create index appointment_notifications_due_idx on public.appointment_notifications(next_attempt_at)
  where status in ('queued', 'sending');
create trigger appointment_notifications_updated_at before update on public.appointment_notifications
  for each row execute function public.set_updated_at();

-- Organization default email templates (campaigns can override the confirmation template).
create table public.appointment_email_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  type text not null check (type in ('confirmation', 'reschedule', 'cancellation', 'reminder', 'host_notice')),
  subject text not null,
  body text not null,
  updated_at timestamptz not null default now(),
  unique (organization_id, type)
);

-- SMS opt-outs (STOP) for the future Twilio Messaging channel.
create table public.sms_opt_outs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  phone_e164 text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, phone_e164)
);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.appointment_types enable row level security;
alter table public.appointment_hosts enable row level security;
alter table public.availability_rules enable row level security;
alter table public.availability_exceptions enable row level security;
alter table public.appointments enable row level security;
alter table public.appointment_tokens enable row level security;
alter table public.appointment_events enable row level security;
alter table public.appointment_notifications enable row level security;
alter table public.appointment_email_templates enable row level security;
alter table public.sms_opt_outs enable row level security;

create policy appointment_types_select on public.appointment_types for select to authenticated
  using (public.is_org_member(organization_id));
create policy appointment_types_write on public.appointment_types for all to authenticated
  using (public.has_permission(organization_id, 'appointments.settings'))
  with check (public.has_permission(organization_id, 'appointments.settings'));

create policy appointment_hosts_select on public.appointment_hosts for select to authenticated
  using (public.is_org_member(organization_id));
create policy appointment_hosts_write on public.appointment_hosts for all to authenticated
  using (public.has_permission(organization_id, 'appointments.settings'))
  with check (public.has_permission(organization_id, 'appointments.settings'));

create policy availability_rules_select on public.availability_rules for select to authenticated
  using (public.is_org_member(organization_id));
create policy availability_rules_write on public.availability_rules for all to authenticated
  using (public.has_permission(organization_id, 'appointments.settings'))
  with check (public.has_permission(organization_id, 'appointments.settings'));

create policy availability_exceptions_select on public.availability_exceptions for select to authenticated
  using (public.is_org_member(organization_id));
create policy availability_exceptions_write on public.availability_exceptions for all to authenticated
  using (public.has_permission(organization_id, 'appointments.settings'))
  with check (public.has_permission(organization_id, 'appointments.settings'));

create policy appointments_select on public.appointments for select to authenticated
  using (public.has_permission(organization_id, 'appointments.view'));
create policy appointments_write on public.appointments for all to authenticated
  using (public.has_permission(organization_id, 'appointments.manage'))
  with check (public.has_permission(organization_id, 'appointments.manage'));

-- appointment_tokens: no client policies (backend only).

create policy appointment_events_select on public.appointment_events for select to authenticated
  using (public.has_permission(organization_id, 'appointments.view'));
create policy appointment_notifications_select on public.appointment_notifications for select to authenticated
  using (public.has_permission(organization_id, 'appointments.view'));

create policy appointment_email_templates_select on public.appointment_email_templates for select to authenticated
  using (public.is_org_member(organization_id));
create policy appointment_email_templates_write on public.appointment_email_templates for all to authenticated
  using (public.has_permission(organization_id, 'appointments.settings'))
  with check (public.has_permission(organization_id, 'appointments.settings'));

create policy sms_opt_outs_select on public.sms_opt_outs for select to authenticated
  using (public.has_permission(organization_id, 'leads.view'));

-- ---------------------------------------------------------------------------
-- Analytics roll-up with appointment metrics
-- ---------------------------------------------------------------------------
drop function public.analytics_rollup(uuid, timestamptz, timestamptz);
create function public.analytics_rollup(org uuid, from_ts timestamptz, to_ts timestamptz)
returns table (
  day date,
  campaign_id uuid,
  calls integer,
  connected integer,
  voicemail integer,
  talk_seconds bigint,
  appointments_booked integer,
  appointments_completed integer,
  appointments_no_show integer
)
language sql stable security definer set search_path = public as $$
  with tz as (select time_zone from organizations where id = org),
  allowed as (select public.has_permission(org, 'dashboard.view') or auth.uid() is null as ok),
  facts as (
    select (c.created_at at time zone (select time_zone from tz))::date as day, c.campaign_id,
           1 as calls, c.connected::int as connected, c.voicemail::int as voicemail,
           case when c.connected then coalesce(c.duration_seconds, 0) else 0 end as talk_seconds,
           0 as booked, 0 as completed, 0 as no_show
      from calls c
     where c.organization_id = org and c.created_at >= from_ts and c.created_at < to_ts
    union all
    -- Booked = confirmed, counted on the day it was confirmed.
    select (a.confirmed_at at time zone (select time_zone from tz))::date, a.campaign_id,
           0, 0, 0, 0, 1, 0, 0
      from appointments a
     where a.organization_id = org and a.confirmed_at >= from_ts and a.confirmed_at < to_ts
    union all
    -- Attendance, counted on the appointment day.
    select (a.starts_at at time zone (select time_zone from tz))::date, a.campaign_id,
           0, 0, 0, 0, 0, (a.status = 'completed')::int, (a.status = 'no_show')::int
      from appointments a
     where a.organization_id = org and a.status in ('completed', 'no_show')
       and a.starts_at >= from_ts and a.starts_at < to_ts
  )
  select day, campaign_id, sum(calls)::int, sum(connected)::int, sum(voicemail)::int, sum(talk_seconds)::bigint,
         sum(booked)::int, sum(completed)::int, sum(no_show)::int
    from facts
   where (select ok from allowed)
   group by day, campaign_id
$$;
