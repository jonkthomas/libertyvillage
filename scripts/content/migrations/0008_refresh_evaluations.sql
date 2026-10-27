-- One decision per snapshot. Also serves as the bounded writer's learnings log.
create table if not exists content.refresh_evaluations (
  snapshot_id bigint primary key references content.refresh_snapshots(id),
  evaluated_at timestamptz not null default now(),
  verdict text not null check (verdict in ('won','lost','inconclusive')),
  reason_code text not null,
  measurement json not null,
  rollback_state text check (rollback_state in ('claimed','reverted','pending','failed','superseded'))
);
