-- Refresh loop (docs/specs/refresh-loop.md): a `refresh` submission kind that
-- may only update an existing post, and one durable snapshot row per refresh
-- attempt. The snapshot is written BEFORE the post changes and is the rollback
-- target; its rows also enforce the 2-refreshes-per-ISO-week cap. Idempotent.
alter table content.submissions drop constraint if exists submissions_kind_check;
alter table content.submissions add constraint submissions_kind_check
  check (kind in ('seed','business','blog','blog-live','news','seo','topic-discovery','manual','admin','roundup','refresh'));

create table if not exists content.refresh_snapshots (
  id bigserial primary key,
  target text not null check (target in ('production','staging','test')),
  iso_week text not null check (iso_week ~ '^[0-9]{4}-W[0-9]{2}$'),
  dataset text not null default 'posts' check (dataset = 'posts'),
  key text not null,
  url text not null,
  live_rev integer not null,          -- the published revision this snapshot copies
  payload json not null,              -- exact copy of that revision's payload
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  target_query text,
  baseline json,                      -- {clicks, impressions, ctr, position} at T0
  score numeric,
  state text not null default 'reserved' check (state in ('reserved','published','failed','rolled-back')),
  reason_code text,
  submission_id bigint references content.submissions(id),
  summary json,                       -- {before:{title,description}, after:{...}, change}
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  rolled_back_at timestamptz,
  foreign key (dataset, key, live_rev) references content.revisions (dataset, key, rev),
  check ((state = 'reserved') = (closed_at is null))
);
create index if not exists refresh_snapshots_week_idx on content.refresh_snapshots (target, iso_week);
create unique index if not exists refresh_snapshots_open_idx on content.refresh_snapshots (target, key) where state = 'reserved';

-- The snapshot itself never changes; only its outcome columns move forward.
create or replace function content.refresh_snapshot_immutable() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' or (new.id,new.target,new.iso_week,new.dataset,new.key,new.url,new.live_rev,new.payload::text,new.payload_sha256,new.created_at)
    is distinct from (old.id,old.target,old.iso_week,old.dataset,old.key,old.url,old.live_rev,old.payload::text,old.payload_sha256,old.created_at)
    then raise exception 'refresh-snapshot-immutable'; end if;
  return new;
end $$;
drop trigger if exists refresh_snapshot_immutable on content.refresh_snapshots;
create trigger refresh_snapshot_immutable before update or delete on content.refresh_snapshots
  for each row execute function content.refresh_snapshot_immutable();
