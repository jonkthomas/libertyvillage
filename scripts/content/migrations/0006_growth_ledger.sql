-- Additive and replay-safe; UTC day makes idempotency independent of session timezone.
create table if not exists content.content_action_ledger (
  id bigserial primary key,
  action_kind text not null check (action_kind in ('new_post','refresh')),
  slug text not null, url text not null, page_type text not null, target_query text not null,
  query_type text not null, acted_at timestamptz not null,
  baseline jsonb not null, outcome_2w jsonb, outcome_4w jsonb,
  details jsonb not null default '{}'::jsonb
);
create unique index if not exists content_action_ledger_day
  on content.content_action_ledger(action_kind, slug, ((acted_at at time zone 'UTC')::date));
create table if not exists content.gsc_weekly_snapshot (
  week_start date not null, page text not null, query text not null,
  clicks double precision, impressions double precision, ctr double precision, position double precision,
  primary key (week_start,page,query)
);
