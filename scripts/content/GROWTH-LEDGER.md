# Growth measurement contract

Apply `0006_growth_ledger.sql` through the existing content migration CLI before
reinstalling the runner. It adds `content.content_action_ledger`, its daily
identity index and `content.gsc_weekly_snapshot`. Applying the SQL again is safe.
There is no historical backfill or existing-content rewrite.

`ledger.mjs` exports the shared recordAction, fillOutcomes, actionWeights and
listActions interfaces. Actions are idempotent on action kind, slug and UTC
date. Replays preserve the original baseline and details. listActions returns
database column names with JSON baseline, outcome_2w, outcome_4w and details.
Refresh callers can put their snapshot and before/after metadata in details.
The optional recordAction argument actionType persists as action_type and accepts
snippet, refresh, merge, new or link. It defaults to new for new_post and refresh
for refresh. Slice B can pass actionType: 'snippet' for title/meta/intro-only
changes. Earlier rows without a subtype are read/grouped using the same defaults;
the original UTC-day idempotency key still applies. Revised migration 0006 adds
the nullable column replay-safely without rewriting existing rows. If an earlier
candidate's 0006 was already applied, reapply its revised idempotent SQL as well.

Submission captures the target query from queue growth hints, or the trusted
source-pack topic, falling back to the post title. Private submission context
freezes T0 across retries. T0 uses the latest snapshot whose end date is no more
than two weeks old: an absent page/query in an available snapshot means zero clicks and
impressions; no snapshot means unknown. The publish tail records new_post only
for published inserted blog/blog-live posts, using the stable revision publish
timestamp. Measurement errors log a bounded warning without blocking content.

Outcomes cover seven days ending the day before the +14/+28-day anniversary,
filtered by exact URL and query. The action must be due and the window end date
plus three days must be at or before now (UTC) before the observation is fetched.
Once filled it is immutable. A site-level date query checks final-data availability
once per distinct window per run. If site data exists, an empty page/query response
is stored as zero clicks/impressions with unknown CTR/position, so unsuccessful
actions contribute to learning and stop being fetched. Missing site data or a
fetch error leaves the observation pending for retry. Availability is cached for
both available and unavailable windows, then checked afresh on the next run.
GoogleAuth/searchanalytics uses the existing runner credential path, web search,
dataState final and 25,000-row pagination. Weekly snapshots use the latest full
Mon–Sun week whose Sunday is at least three days old. For example, Monday
October 26 snapshots October 12–18; October 19–25 becomes eligible October 28.
An empty snapshot fetch preserves existing rows; a nonempty replacement is
scoped to the fetched week in one DB transaction. The digest's live headline
still uses its existing GSC windows. Anonymized queries can be omitted; these
observations do not establish causation.

actionWeights returns camelCase actionKind, actionType, pageType, queryType, samples,
averageClickDelta and weight. Each action contributes its latest mature
observation (+4w preferred); unknown baselines do not contribute. The grouped
average click delta is grouped by kind, type, page type and query type and produces
this multiplier:

`clamp(1 + delta / (10 + abs(delta)) * samples / (samples + 3), 0.5, 2)`

Unseen groups are neutral (1); small samples shrink toward neutral. There are no
new product switches.

Discovery scores impressions, poor position, weekly impression growth, missing
dedicated posts, local intent and learned action/page/query weights. Existing
GSC editorial themes, grounding checks and the #216 near-duplicate filter still
govern admission. PostHog candidates keep the SEO lane and identify their
blog/guide/directory type for weighting. Every candidate carries exact directory
business IDs/names, verbatim facts including street addresses, and supported
existing photos in the existing rationale string after `\nGrowth hints: `
(JSON). growthHints reads it. Existing source packs and images.mjs still validate
facts and photo bytes; hints do not grant publication authority. The runner
sorts blog candidates by stored score before its existing eligibility checks.
Discovery remains capped at 25 inserts per submission.

Parent installation steps: apply migrations to the correct staging DB and prove
the runner there; then perform separately authorized production migration and
runner installation. Reinstall the Mac digest too. The existing discovery timer
schedule is unchanged. Builder verification uses only local Postgres, fixtures
and browsers; external API/production behavior remains unverified.
