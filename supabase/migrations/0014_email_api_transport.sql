-- 0014 Email can go out through an email service's HTTPS API instead of SMTP (some hosts block SMTP ports).
alter table public.organization_smtp_settings
  add column transport text not null default 'smtp' check (transport in ('smtp', 'resend', 'sendgrid', 'postmark', 'brevo'));
-- API transports have no SMTP server; the API key is stored where the SMTP password was (Vault).
alter table public.organization_smtp_settings alter column host drop not null;
alter table public.organization_smtp_settings alter column port drop not null;
