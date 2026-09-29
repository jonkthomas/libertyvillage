-- #181: keep the news preflight and the open/gating resume route bounded as
-- publication history grows. Each partial index holds only the rows its query
-- can return; completed history never enters the index.
create index if not exists submissions_pending_idx
  on content.submissions (kind, target, id)
  where state = 'published' and (smoke_passed_at is null or notified_at is null);
create index if not exists submissions_active_idx
  on content.submissions (kind, target, id)
  where state in ('open', 'gating');
