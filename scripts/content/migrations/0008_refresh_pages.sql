-- Extend the existing cap/snapshot table; never create a separate page budget.
alter table content.refresh_snapshots drop constraint if exists refresh_snapshots_dataset_check;
alter table content.refresh_snapshots add constraint refresh_snapshots_dataset_check
  check (dataset in ('posts','topics','services','businesses'));
alter table content.refresh_snapshots drop constraint if exists refresh_snapshots_page_mode_check;
alter table content.refresh_snapshots add constraint refresh_snapshots_page_mode_check
  check (dataset = 'posts' or mode = 'snippet');
drop index if exists content.refresh_snapshots_open_idx;
create unique index refresh_snapshots_open_idx on content.refresh_snapshots (target, dataset, key) where state = 'reserved';

-- A blog and a guide can share a slug without losing either measurement row.
drop index if exists content.content_action_ledger_day;
create unique index content_action_ledger_day on content.content_action_ledger
  (action_kind,page_type,slug,((acted_at at time zone 'UTC')::date));
