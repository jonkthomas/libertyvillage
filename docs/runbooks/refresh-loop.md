# Refresh loop runbook: improve the 2 weakest live posts each week

> **Operational runbook (as built).** This describes how the refresh loop behaves and how to run, check and roll it back. It is not a specification: no approved spec drove this work, and this document claims no spec authority. The code and its tests are the source of truth.

Slice 2 of the Liberty Village growth loop. The metric is weekly Google Search Console clicks, week over week. New posts add pages; the refresh loop makes the pages we already have earn more of the clicks Google is already offering them.

It replaces the old broad `seo-improvements` data lane (held off since #182). It reuses that job's name, timer, sandboxed SDK generator (`scripts/seo-improve-agent.js`, now with a refresh mode) and the DB content path. It does not use a PR or merge step.

## Weekly run

1. **Measure.** `scripts/content/refresh-gsc.mjs` pulls 28 days of final GSC rows for `/blog/` pages: by page, and by page and query. It is read-only and uses the runner's GSA.
2. **Plan.** `content refresh plan` first settles abandoned snapshots. It then ranks live, non-news blog posts by the weakness score below. It drops posts that are inside their cooldown or still have an open snapshot.
3. **For each candidate, in score order:**
   1. `content refresh reserve` snapshots the live row in `content.refresh_snapshots`, under the weekly cap. It saves the exact revision payload, its sha and `live_rev`, the GSC baseline and the top query.
   2. The runner does a fresh export. The SDK agent gets `REFRESH_SLUG`, `REFRESH_QUERY` and `REFRESH_MODE` with a single-post prompt for both builder and revise stages, without the general SEO prompt, extra skills or project settings. In refresh mode `acceptGeneratedOutput` reads only bounded `data/posts.json` from scratch and copies no files: other data JSON, task reports, images and code are discarded. The runner builds `after` from the fresh `before`, replacing only the target record, and writes that grafted result to the trusted checkout. Other-post additions, removals and edits never reach submit, deploy or commit. A missing/renamed target or an unchanged target still refuses. `refresh-generator-output` logs `discardedOffTarget` as at most 20 validated slugs, without bodies; missing/duplicate targets leave the checkout at the export.
   3. `content refresh submit` accepts only one changed record: the snapshot's slug, with the same `publishedAt`, and no other post added, removed or edited. It submits that record as kind `refresh` against the snapshot revision (`expected_live_rev`), so a row that moved in the meantime becomes a conflict. Then it runs the full gate, which publishes, posts the deploy hook and runs the smoke check.
   4. The snapshot is closed as `published` or `failed`, with a plain-English reason code. A published refresh writes one ledger row (`recordAction`, `actionKind: 'refresh'`).
4. The run stops when 2 refreshes have published, when the DB cap refuses a reserve, or when it hits a technical failure such as the writer or the CLI. A refusal or a gate rejection moves on to the next candidate.

## Two lanes: snippet first, then full rewrite

Search Console impressions are up 72% since July, but CTR has halved, from 1.19% to 0.57%. CTR is therefore the biggest lever (SEO roadmap P0-5, the "leak" lane).

- **Leak query:** position 4–20, more than 50 impressions, and CTR under 5% over the window (`isLeakQuery`).
- **Snippet lane:** a candidate page with at least one leak query gets a **snippet-only** rewrite first.
  - The writer may change only the title, the meta description and the intro (the body before the first `## ` heading, or its first paragraph when it has none) and `updatedAt`.
  - `extractRefreshedPost(..., mode: 'snippet')` refuses any other changed field, or a single changed byte after the intro, with `refresh-snippet-overreach`.
  - The snippet targets the page's top leak query.
- **Full lane:** a page is considered for a full rewrite only after it has had a published (or rolled-back) snippet refresh, or when it has no leak query.
- **Both lanes share everything else:**
  - the 2-per-ISO-week cap and the attempt cap
  - kind `refresh` and its gate
  - snapshot and rollback
  - same URL and slug
  - the ledger path, with `recordAction({ actionKind: 'refresh', actionType: 'snippet' | 'refresh', details: { actionType, ... } })`
- The lane is stored in `refresh_snapshots.mode` (`snippet` | `full`). The digest tags each row as "snippet: title, description, intro" or "full rewrite".

## Weakness score (documented, tested)

```
score = impressions × max(0, expectedCtr(min(position, 8)) − ctr)      over the 28-day window
```

- `expectedCtr` is a typical organic CTR curve. By rounded position it is 28%, 15%, 10%, 7%, 5%, 4%, 3%, 2.5%, 2%, 1.8%, then 1% beyond page one.
- The score is the number of **clicks the page missed**. Two kinds of page rank high:
  - High impressions with a CTR below what the position should earn. This points to a weak title or description.
  - High impressions stuck below page one. These are scored as if they reached position 8.
- A page already earning its expected CTR scores 0 and is never refreshed.
- **Floors and exclusions:**
  - At least 50 impressions.
  - The post must be live in the DB.
  - `category: news`, weekly roundups and roundup-covered posts are excluded.
  - A refreshed or rolled-back post sits out 8 weeks so its effect can be measured.
- Rows for the same post (`www.`, trailing slash) are merged. Position is impression-weighted.

## Guardrails (John's decision 2a)

| Guardrail | Enforcement |
|---|---|
| Snippet lane stays a snippet | In `snippet` mode, only title, description, intro and `updatedAt` may change. The body after the intro must be byte-identical (`refresh-snippet-overreach`). |
| Same URL and slug | `extractRefreshedPost` refuses a slug or publish-date change and any other changed post. Kind `refresh` may only `update` an existing `posts` row (`KIND_RULES.refresh`). Reserve refuses a URL that is not `/blog/<slug>`. |
| Same quality and fact gate as new posts | Kind `refresh` runs the new-post claim linter (`lint: true`), grounding references (`GROUNDED`), the blog repair policy (`POLICY_KIND.refresh = 'blog'`) and the blog review lenses plus one REFRESH lens. It uses the same model, bar and repair budget. |
| Snapshot first, with rollback | `reserveRefresh` writes the snapshot before any generation. The row is immutable (trigger) and is the rollback target. |
| At most 2 a week | `reserveRefresh` counts `reserved`, `published` and `rolled-back` rows for the target's ISO week under an advisory lock, so the cap holds across runs. It also caps attempts at 4 a week. |
| Gate failure changes nothing | A gate failure or refusal leaves the submission rejected or blocked and publishes nothing. The snapshot is kept, and the outcome is logged with a reason code from `ops/weekly-digest/lib/plain-english.mjs` (`refresh-*`). |
| Before/after in the Monday digest | Each outcome is logged as a `refresh-outcome` runner log line. The digest renders it in **Refreshed this week** (`ops/weekly-digest/lib/refreshed.mjs`). |

## Binding, repairs and deploy confirmation

- **Snapshot bound to the submission.**
  - `content refresh submit` stores `context.refresh = { snapshotId, mode, original }` on the submission.
  - A bare `content submit --kind refresh` is refused, so the binding can't be skipped.
  - The kind policy re-checks the binding at submit, on every fixer plan (the repair validator) and on every gate round, including after a resume.
  - So a gate repair can never widen a snippet refresh or break the source binding.
- **Same source binding as new posts.** The original post is the trusted evidence, checked by `checkRefreshAgainstOriginal` (`scripts/automation/blog-source-pack.mjs`). It applies the `checkDraftAgainstPack` rules with the original standing in for the pack:
  - Businesses may only come from the original post.
  - The original title's topic and operational premises must be kept.
  - Every `related*` slug and every internal link must resolve to a live record.
  - A failure is coded `refresh-unbound`.
- **Only confirmed-live refreshes count.**
  - A refresh can be published in the DB but not yet live: the deploy hook failed, or smoke hasn't passed. Its snapshot then stays `reserved` and is reported as `pending` with `hook-failed` or `smoke-timeout`.
  - A same-snapshot `content refresh submit` retry, or the next `content refresh plan`, resumes propagation (deploy hook and smoke) without regenerating.
  - Cooldown, the ledger row and the digest's "refreshed" status all wait for confirmation. The digest shows "not live yet" until then.

## Rollback

```
node scripts/content/cli.mjs refresh rollback --snapshot <id> --actor <who> --target <staging|production>
```

This checks that the snapshot revision is intact. It then runs the existing admin rollback, which adds a new revision copying the snapshot payload. After that come the deploy hook and smoke check, and the snapshot is marked `rolled-back`. To list snapshots, use `content refresh list --target <t>`. The general fallback is still `content rollback --dataset posts --key <slug> --to-rev <live_rev from the snapshot>`.

If the gate stops part-way, the snapshot stays `reserved` and counts toward the cap. To resume, run `content gate --submission <id>` (the id is in `content refresh list`). Otherwise the next plan settles it after 6 hours.

## Schedule

The timer stays **disabled** until the staging proof is accepted. The calendar is **Tue 04:23 UTC**. That fits the existing UTC timers:

- topic-discovery: Mon 10:00
- discover-businesses: Mon 13:00
- weekly-blog: Wed and Sun 11:00
- news: daily 12:17
- growth: Thu 10:37
- backfill: daily 15:37

A run makes at most 4 generator attempts, each capped at about 40 minutes, so it finishes well before the 12:17 news run. The single-instance runner lock (`flock -n`) would otherwise make the news run skip. A Tuesday run lands in the next Monday's digest.

## Four-week follow-up and automatic restore

Before sourcing/planning new refreshes, the weekly runner runs:

```sh
node scripts/content/cli.mjs refresh evaluate --target staging --expect-db lv_staging
```

The existing runner lock covers evaluation and planning. Dry runs skip evaluation.
Apply content migration `0008_refresh_evaluations.sql` before installing this runner.
It adds one durable decision per snapshot; the table also supplies the writer's
latest 20 learning lines. No extra service or timer is needed.

Only confirmed `published` snapshots at least 28 days old qualify. The evaluator
checks that the current entry's `live_rev` still equals the refresh submission's
published revision; a later edit, unpublish or rollback is skipped. It measures
**days +7 through +27** after `closed_at` (the confirmed publication time), leaving
the first seven days out. It waits until that whole fixed window is at least three
days old for GSC final data; in practice the first evaluation can be about day 30.
It does not use a rolling window if a weekly run is late.

The page baseline is the snapshot's original clicks/impressions and position.
New snapshots retain their GSC start/end dates. Older snapshots use the original
28-day source window ending three days before reservation. The evaluator fetches
final GSC aggregates for the exact snapshot URL, plus the entire site's CTR in
both the baseline and measurement windows (all page kinds, with no blog filter).
CTR is calculated from clicks divided by impressions, not rounded stored CTR.

```
adjusted CTR change = (page CTR after / page CTR baseline)
                      / (site CTR after / site CTR before) - 1
```

A **lost** result requires at least 200 measurement-window impressions, position
within ±2 of baseline, and adjusted CTR falling strictly more than 10%. A positive
adjusted change with the same impression/position guards is **won**. Lower volume,
a position move over two places, no baseline clicks, or a steady/slightly lower
adjusted CTR is **inconclusive** and causes no restore. Missing or invalid page,
site or baseline data defers the decision; a GSC error changes no content.

A loser calls the existing `refresh rollback --snapshot` implementation with actor
`auto-revert`: same snapshot integrity check, admin revision, deploy hook and smoke.
The decision is claimed durably before calling rollback, so another evaluation
never repeats the decision or rollback. A propagation failure is reported as
pending; the existing deploy retry handles propagation. A failed or interrupted
restore claim needs operator inspection (do not delete the decision to retry it).
The evaluator never creates a new refresh submission or loosens a content gate.

Each learning line contains page, old title → new title, raw and adjusted CTR
change, position change and won/lost/inconclusive. The trusted runner copies at
most 24 KB into `scripts/refresh-learnings.md` in scratch. Both writer stages read
the latest 20 lines into their prompt as evidence. `scripts/` remains read-only;
only the existing `data/` write boundary is available to the writer. The digest
reports evaluated / reverted / won with plain-English reasons, and distinguishes
pending/failed restores. Staging measurements are labelled test-site only.

### Staging proof handoff (ops worker only, after authorization)

Do not run these against production. Use the staging runner environment already
bound to `lv_staging` and its staging site/deploy hook. First apply migrations via
`node scripts/content/cli.mjs migrate --target staging --expect-db lv_staging`.
Create a refresh through the usual reserve → sandboxed writer → submit/gate flow
(the staging on-demand `seo-improvements --topic <ranked-slug>` run is suitable).
Then find that **published**, still-current snapshot:

```sh
node scripts/content/cli.mjs refresh list --target staging --expect-db lv_staging
```

Set `REFRESH_PROOF_SNAPSHOT` to its id. The following synthetic measurement proof
backdates only the snapshot's mutable confirmation timestamp/baseline and calls
the evaluator; it uses the real rollback, deploy and smoke, without waiting a month
or depending on a real CTR loss. Run once in the pinned staging checkout, under
the runner lock, with no other staging writer running:

```sh
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { openDb } from './scripts/content/db.mjs';
import { evaluateRefreshes } from './scripts/content/refresh-evaluate.mjs';
const db = await openDb({ expectDb: 'lv_staging' });
try {
  assert.equal(db.target, 'staging');
  const id = Number(process.env.REFRESH_PROOF_SNAPSHOT);
  assert.ok(Number.isSafeInteger(id) && id > 0);
  const snap = (await db.query(`select s.* from content.refresh_snapshots s
    join content.submission_items i on i.submission_id=s.submission_id and i.dataset=s.dataset and i.key=s.key
    join content.entries e on e.dataset=s.dataset and e.key=s.key
    where s.id=$1 and s.target='staging' and s.state='published' and e.live_rev=i.published_rev`, [id])).rows[0];
  assert.ok(snap, 'use a still-current published staging refresh');
  assert.equal((await db.query('select 1 from content.refresh_evaluations where snapshot_id=$1', [id])).rowCount, 0);
  await db.query(`update content.refresh_snapshots set closed_at=now()-interval '35 days',
    baseline=$2::json where id=$1`, [id, JSON.stringify({ clicks: 20, impressions: 1000, position: 8 })]);
  const measure = async (s) => Number(s.id) === id ? {
    page: { clicks: 16, impressions: 1000, position: 8 },
    siteBefore: { clicks: 200, impressions: 10000, position: 8 },
    siteAfter: { clicks: 200, impressions: 10000, position: 8 },
  } : {};
  const result = await evaluateRefreshes(db, { target: 'staging', deps: { measure } });
  console.log(JSON.stringify(result));
  assert.equal(result.reverted, 1);
  assert.equal((await db.query('select state from content.refresh_snapshots where id=$1', [id])).rows[0].state, 'rolled-back');
  const restored = (await db.query(`select r.payload_sha256 from content.entries e
    join content.revisions r on r.dataset=e.dataset and r.key=e.key and r.rev=e.live_rev
    where e.dataset=$1 and e.key=$2`, [snap.dataset, snap.key])).rows[0];
  assert.equal(restored.payload_sha256, snap.payload_sha256);
  assert.equal((await evaluateRefreshes(db, { target: 'staging', deps: { measure } })).evaluated, 0);
} finally { await db.close(); }
JS
```

Expected: `evaluated:1,reverted:1,won:0`, verdict `lost`, rollbackState `reverted`,
then `evaluated:0` on retry. Confirm the staging URL for this snapshot returns 200
and the old title; inspect the `auto-revert` admin action and successful smoke.
Run the regular `refresh evaluate` CLI once afterward to prove the wrapper is a
no-op for this id, and include its stdout, the URL/title, and admin revision in
the ops report. The synthetic call above does not itself emit runner JSONL: to
prove the digest end to end, capture its outcome as a `refresh-evaluation` event
in a staging proof log or run a seeded weekly runner fixture; the local verify
suite already exercises runner-event parsing and digest rendering.
