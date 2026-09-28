create schema if not exists content;
create table content.schema_migrations (version text primary key, applied_at timestamptz not null default now());
create table content.meta (id boolean primary key default true check (id), live_seq bigint not null default 0);
insert into content.meta default values;
create table content.entries (
  dataset text not null check (dataset in ('businesses','posts','buildings','neighborhoods','services','topics','guide-hub','topic-queue')),
  key text not null, position integer,              -- NULL until first publish; max+1 under the dataset lock
  live_rev integer, head_rev integer not null default 0,   -- live_rev is the ONLY visibility bit
  first_published_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key (dataset, key),
  constraint entries_key_shape check ((dataset='guide-hub' and key='guide-hub') or (dataset='topic-queue' and key ~ '^[0-9a-f]{64}$')
    or (dataset not in ('guide-hub','topic-queue') and key ~ '^[a-z0-9][a-z0-9-]{0,127}$')),
  constraint entries_position unique (dataset, position) deferrable initially deferred,
  check (live_rev is null or position is not null));
create table content.submissions (
  id bigserial primary key,
  kind text not null check (kind in ('seed','business','blog','blog-live','news','seo','topic-discovery','manual','admin')),
  target text not null check (target in ('production','staging','test')),
  actor text not null, idempotency_key text not null unique, request_sha256 text not null,
  base_snapshot_id text,            -- export manifest the writer generated from (§4.3)
  context json,                     -- PRIVATE gate inputs (§4.4); never exported
  state text not null check (state in ('open','gating','published','rejected','blocked','error','compensated')),
  decision text,  -- go|validation|lint|conflict|unrepairable|exhausted|not-converging|block|smoke-failed|error|admin
  round integer not null default 0, repairs integer not null default 0, claim_token uuid, claimed_until timestamptz,
  live_seq bigint, deploy_requested_at timestamptz, smoke_passed_at timestamptz, notified_at timestamptz,
  created_at timestamptz not null default now(), closed_at timestamptz);
create table content.revisions (
  dataset text not null, key text not null, rev integer not null,
  payload json not null, payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  source text not null check (source in ('seed','writer','fixer','rollback','manual')),
  actor text not null, submission_id bigint references content.submissions(id),
  parent_rev integer, published_at timestamptz,   -- set once (NULL -> ts) by the publishing tx; rollback targets need NOT NULL
  created_at timestamptz not null default now(),
  primary key (dataset, key, rev), foreign key (dataset, key) references content.entries (dataset, key));
alter table content.entries add constraint entries_live_fk foreign key (dataset, key, live_rev)
  references content.revisions (dataset, key, rev) deferrable initially deferred;
create table content.submission_items (
  submission_id bigint not null references content.submissions(id), dataset text not null, key text not null,
  op text not null check (op in ('insert','update','unpublish','rollback','compensate')),
  expected_live_rev integer,   -- base-snapshot rev (NULL = insert); compared IS NOT DISTINCT FROM
  published_rev integer,       -- live_rev this submission set; NULL for unpublish / compensation of an insert
  smoke text check (smoke in ('passed','superseded')),
  primary key (submission_id, dataset, key));
create table content.gate_rounds (
  submission_id bigint not null references content.submissions(id), round integer not null,
  candidate_digest text not null,  -- sha256 of sorted "dataset\tkey\trev\tpayload_sha256" lines
  content_sha text not null check (content_sha ~ '^[0-9a-f]{40}$'),
  verdict json, overall numeric(4,2), passed boolean not null, blocking_count integer not null default 0,
  lint json, decision text not null, scripted boolean not null default false,
  created_at timestamptz not null default now(), primary key (submission_id, round));
create table content.round_items (  -- immutable candidate vector per round
  submission_id bigint not null, round integer not null, dataset text not null, key text not null,
  rev integer not null, payload_sha256 text not null, primary key (submission_id, round, dataset, key),
  foreign key (dataset, key, rev) references content.revisions (dataset, key, rev));
create table content.actions (      -- only what revisions cannot express
  id bigserial primary key, at timestamptz not null default now(), actor text not null,
  action text not null check (action in ('unpublish','rollback','compensate','reconcile')),
  dataset text not null, key text not null, from_rev integer, to_rev integer,
  submission_id bigint, reason text not null, live_seq bigint not null);
create table content.discovery_seen (
  name_key text primary key, first_seen date not null,
  outcome text not null default 'seen' check (outcome in ('seen','added','rejected')),
  outcome_submission_id bigint references content.submissions(id), created_at timestamptz not null default now());
create table content.assets (
  sha256 text primary key check (sha256 ~ '^[0-9a-f]{64}$'),
  path text not null unique check (path ~ '^/media/[0-9a-f]{16}/[a-z0-9][a-z0-9._-]{0,120}\.(jpg|png|webp)$'),
  content_type text not null check (content_type in ('image/jpeg','image/png','image/webp')),
  bytes bytea not null, byte_size integer not null check (byte_size between 1 and 2000000),
  submission_id bigint references content.submissions(id), created_at timestamptz not null default now());

create or replace function content.immutable_revision() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'revision-immutable'; end if;
  if old.published_at is null and new.published_at is not null
     and current_setting('content.publishing', true) = 'on'
     and new.dataset is not distinct from old.dataset
     and new.key is not distinct from old.key
     and new.rev is not distinct from old.rev
     and new.payload::text is not distinct from old.payload::text
     and new.payload_sha256 is not distinct from old.payload_sha256
     and new.source is not distinct from old.source
     and new.actor is not distinct from old.actor
     and new.submission_id is not distinct from old.submission_id
     and new.parent_rev is not distinct from old.parent_rev
     and new.created_at is not distinct from old.created_at then return new; end if;
  raise exception 'revision-immutable';
end $$;
create trigger immutable_revision before update or delete on content.revisions for each row execute function content.immutable_revision();
create or replace function content.immutable_row() returns trigger language plpgsql as $$
begin raise exception 'content-immutable'; end $$;
create trigger immutable_gate_round before update or delete on content.gate_rounds for each row execute function content.immutable_row();
create trigger immutable_round_item before update or delete on content.round_items for each row execute function content.immutable_row();
create trigger immutable_action before update or delete on content.actions for each row execute function content.immutable_row();
create trigger no_entry_delete before delete on content.entries for each row execute function content.immutable_row();
create trigger no_seen_delete before delete on content.discovery_seen for each row execute function content.immutable_row();
