alter table content.submissions drop constraint submissions_kind_check;
alter table content.submissions add constraint submissions_kind_check
  check (kind in ('seed','business','blog','blog-live','news','seo','topic-discovery','manual','admin','roundup'));

create table content.cadence_slots (
  target text not null check (target in ('production','staging','test')),
  week_start_utc date not null check (extract(isodow from week_start_utc) = 1),
  lane text not null check (lane in ('content','roundup')),
  slot_number integer not null check (slot_number > 0),
  roundup_slug text,
  attempt_ordinal integer not null default 0 check (attempt_ordinal >= 0),
  claim_token uuid,
  claimed_until timestamptz,
  claim_owner text,
  state text not null default 'ready' check (state in ('ready','attempting','submitted','published','smoked','consumed')),
  submission_id bigint references content.submissions(id),
  created_at timestamptz not null default now(),
  primary key (target,week_start_utc,lane,slot_number),
  check ((claim_token is null) = (claimed_until is null)),
  check ((claim_token is null) = (claim_owner is null)),
  check ((lane='content' and roundup_slug is null) or
    (lane='roundup' and roundup_slug = 'liberty-village-news-week-' ||
      to_char(week_start_utc, 'IYYY') || '-w' || to_char(week_start_utc, 'IW')))
);
create unique index cadence_one_roundup_week on content.cadence_slots(target,week_start_utc) where lane='roundup';

create table content.cadence_attempts (
  target text not null check (target in ('production','staging','test')),
  week_start_utc date not null, lane text not null, slot_number integer not null,
  ordinal integer not null check (ordinal > 0),
  intent_fingerprint text not null check (length(intent_fingerprint) > 0),
  topic_key text not null check (length(topic_key) > 0),
  idempotency_key text not null unique,
  source_pack_digest text not null check (length(source_pack_digest) > 0),
  submission_id bigint references content.submissions(id),
  outcome text check (outcome in ('failed-before-submit','rejected','blocked','error','published','smoked','consumed')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), closed_at timestamptz,
  primary key (target,week_start_utc,lane,slot_number,ordinal),
  foreign key (target,week_start_utc,lane,slot_number)
    references content.cadence_slots(target,week_start_utc,lane,slot_number),
  check ((outcome is null) = (closed_at is null))
);
create unique index cadence_distinct_intent on content.cadence_attempts
  (target,week_start_utc,lane,slot_number,intent_fingerprint);

create table content.cadence_alerts (
  target text not null check (target in ('production','staging','test')),
  week_start_utc date not null check (extract(isodow from week_start_utc) = 1),
  alert_kind text not null check (alert_kind in ('WEEKLY_CONTENT_MISSED','WEEKLY_NEWS_MISSED')),
  notification_key text not null unique,
  counts json not null,
  failure_class text not null,
  created_at timestamptz not null default now(), delivered_at timestamptz,
  delivery_attempts integer not null default 0 check (delivery_attempts >= 0), last_error text,
  primary key (target,week_start_utc,alert_kind)
);

create function content.cadence_immutable_keys() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'cadence-immutable'; end if;
  if tg_table_name = 'cadence_slots' then
    if (new.target,new.week_start_utc,new.lane,new.slot_number,new.roundup_slug,new.created_at)
      is distinct from (old.target,old.week_start_utc,old.lane,old.slot_number,old.roundup_slug,old.created_at)
      then raise exception 'cadence-immutable'; end if;
  elsif tg_table_name = 'cadence_attempts' then
    if (new.target,new.week_start_utc,new.lane,new.slot_number,new.ordinal,
        new.intent_fingerprint,new.topic_key,new.idempotency_key,new.source_pack_digest,new.created_at)
      is distinct from (old.target,old.week_start_utc,old.lane,old.slot_number,old.ordinal,
        old.intent_fingerprint,old.topic_key,old.idempotency_key,old.source_pack_digest,old.created_at)
      then raise exception 'cadence-immutable'; end if;
  else
    if (new.target,new.week_start_utc,new.alert_kind,new.notification_key,new.counts::text,
        new.failure_class,new.created_at)
      is distinct from (old.target,old.week_start_utc,old.alert_kind,old.notification_key,
        old.counts::text,old.failure_class,old.created_at)
      then raise exception 'cadence-immutable'; end if;
  end if;
  return new;
end $$;
create trigger cadence_slots_immutable before update or delete on content.cadence_slots
  for each row execute function content.cadence_immutable_keys();
create trigger cadence_attempts_immutable before update or delete on content.cadence_attempts
  for each row execute function content.cadence_immutable_keys();
create trigger cadence_alerts_immutable before update or delete on content.cadence_alerts
  for each row execute function content.cadence_immutable_keys();
