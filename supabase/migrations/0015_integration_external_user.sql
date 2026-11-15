-- The provider's own user id for a connection, so provider-side notices
-- (e.g. Zoom "app deauthorized") can be matched to the organization that connected.
alter table public.organization_integrations add column external_user_id text;
create index organization_integrations_external_user_idx
  on public.organization_integrations (provider, external_user_id)
  where external_user_id is not null;
