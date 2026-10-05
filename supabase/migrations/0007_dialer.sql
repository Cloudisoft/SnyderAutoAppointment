-- 0007 Worker leases: only one backend instance runs the dialer at a time; others take over on expiry.

create table public.worker_leases (
  name text primary key,
  holder text not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

-- Backend-only table (service role); no client access.
alter table public.worker_leases enable row level security;
