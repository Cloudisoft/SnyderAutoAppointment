-- 0010 Per-organization SMTP settings, configured by org admins in Settings > Email.
-- The password lives encrypted in Supabase Vault; only its secret id is stored here.

create table public.organization_smtp_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  host text not null,
  port integer not null check (port between 1 and 65535),
  -- true = implicit TLS (usually 465); false = STARTTLS / plain (usually 587 or 25).
  secure boolean not null default false,
  username text,
  password_secret_id uuid,
  from_email text not null,
  from_name text,
  reply_to text,
  last_tested_at timestamptz,
  last_test_ok boolean,
  last_test_error text,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
create trigger organization_smtp_settings_updated_at before update on public.organization_smtp_settings
  for each row execute function public.set_updated_at();

alter table public.organization_smtp_settings enable row level security;
-- Admins can see the (password-free) settings; all writes go through the backend.
create policy organization_smtp_settings_select on public.organization_smtp_settings for select to authenticated
  using (public.has_permission(organization_id, 'settings.manage'));
