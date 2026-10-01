create table content.cadence_evidence_retries (
  target text not null check (target in ('production','staging','test')),
  week_start_utc date not null check (extract(isodow from week_start_utc) = 1),
  intent_fingerprint text not null check (length(intent_fingerprint) > 0),
  original_key text not null references content.cadence_attempts(idempotency_key),
  original_digest text not null,
  original_title text not null,
  discovery_key text not null unique,
  category text,
  claim_token uuid not null,
  state text not null default 'claimed' check (state in ('claimed','empty','pending','verified','retry','closed')),
  retry_slot integer check (retry_slot between 1 and 4),
  retry_key text unique references content.cadence_attempts(idempotency_key),
  retry_digest text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (target,week_start_utc,intent_fingerprint),
  check ((retry_slot is null) = (retry_key is null)),
  check ((retry_key is null) = (retry_digest is null))
);
create function content.cadence_evidence_immutable() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' or (new.target,new.week_start_utc,new.intent_fingerprint,new.original_key,
    new.original_digest,new.original_title,new.discovery_key,new.category,new.claim_token,new.created_at)
    is distinct from (old.target,old.week_start_utc,old.intent_fingerprint,old.original_key,
    old.original_digest,old.original_title,old.discovery_key,old.category,old.claim_token,old.created_at)
    or (old.retry_key is not null and (new.retry_slot,new.retry_key,new.retry_digest)
      is distinct from (old.retry_slot,old.retry_key,old.retry_digest))
    then raise exception 'cadence-immutable'; end if;
  return new;
end $$;
create trigger cadence_evidence_immutable before update or delete on content.cadence_evidence_retries
  for each row execute function content.cadence_evidence_immutable();
