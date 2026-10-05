-- 0008 Analytics roll-up: per-day, per-campaign call metrics in the organization's time zone.
-- Feature migrations replace this function to add their own columns.

create or replace function public.analytics_rollup(org uuid, from_ts timestamptz, to_ts timestamptz)
returns table (
  day date,
  campaign_id uuid,
  calls integer,
  connected integer,
  voicemail integer,
  talk_seconds bigint
)
language sql stable security definer set search_path = public as $$
  with tz as (select time_zone from organizations where id = org)
  select (c.created_at at time zone (select time_zone from tz))::date as day,
         c.campaign_id,
         count(*)::int as calls,
         count(*) filter (where c.connected)::int as connected,
         count(*) filter (where c.voicemail)::int as voicemail,
         coalesce(sum(c.duration_seconds) filter (where c.connected), 0)::bigint as talk_seconds
    from calls c
   where c.organization_id = org and c.created_at >= from_ts and c.created_at < to_ts
     and (public.has_permission(org, 'dashboard.view') or auth.uid() is null)
   group by 1, 2
$$;
