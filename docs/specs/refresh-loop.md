# Refresh loop: improve the 2 weakest live posts each week

Slice 2 of the Liberty Village growth loop. The metric is weekly Google Search Console clicks, week over week. New posts add pages; the refresh loop makes the pages we already have earn more of the clicks Google is already offering them.

It replaces the old broad `seo-improvements` data lane (held off since #182). It reuses that job's name, timer, sandboxed SDK generator (`scripts/seo-improve-agent.js`, now with a refresh mode) and the DB content path. It does not use a PR or merge step.

## Weekly run

1. **Measure.** `scripts/content/refresh-gsc.mjs` pulls 28 days of final GSC rows for `/blog/` pages: by page, and by page and query. It is read-only and uses the runner's GSA.
2. **Plan.** `content refresh plan` first settles abandoned snapshots. It then ranks live, non-news blog posts by the weakness score below. It drops posts that are inside their cooldown or still have an open snapshot.
3. **For each candidate, in score order:**
   1. `content refresh reserve` snapshots the live row in `content.refresh_snapshots`, under the weekly cap. It saves the exact revision payload, its sha and `live_rev`, the GSC baseline and the top query.
   2. The runner does a fresh export. The SDK agent then rewrites **only that post** in scratch. It gets `REFRESH_SLUG` and `REFRESH_QUERY` and keeps the data-only lane.
   3. `content refresh submit` accepts only one changed record: the snapshot's slug, with the same `publishedAt`, and no other post added, removed or edited. It submits that record as kind `refresh` against the snapshot revision (`expected_live_rev`), so a row that moved in the meantime becomes a conflict. Then it runs the full gate, which publishes, posts the deploy hook and runs the smoke check.
   4. The snapshot is closed as `published` or `failed`, with a plain-English reason code. A published refresh writes one ledger row (`recordAction`, `actionKind: 'refresh'`).
4. The run stops when 2 refreshes have published, when the DB cap refuses a reserve, or when it hits a technical failure such as the writer or the CLI. A refusal or a gate rejection moves on to the next candidate.

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
| Same URL and slug | `extractRefreshedPost` refuses a slug or publish-date change and any other changed post. Kind `refresh` may only `update` an existing `posts` row (`KIND_RULES.refresh`). Reserve refuses a URL that is not `/blog/<slug>`. |
| Same quality and fact gate as new posts | Kind `refresh` runs the new-post claim linter (`lint: true`), grounding references (`GROUNDED`), the blog repair policy (`POLICY_KIND.refresh = 'blog'`) and the blog review lenses plus one REFRESH lens. It uses the same model, bar and repair budget. |
| Snapshot first, with rollback | `reserveRefresh` writes the snapshot before any generation. The row is immutable (trigger) and is the rollback target. |
| At most 2 a week | `reserveRefresh` counts `reserved`, `published` and `rolled-back` rows for the target's ISO week under an advisory lock, so the cap holds across runs. It also caps attempts at 4 a week. |
| Gate failure changes nothing | A gate failure or refusal leaves the submission rejected or blocked and publishes nothing. The snapshot is kept, and the outcome is logged with a reason code from `ops/weekly-digest/lib/plain-english.mjs` (`refresh-*`). |
| Before/after in the Monday digest | Each outcome is logged as a `refresh-outcome` runner log line. The digest renders it in **Refreshed this week** (`ops/weekly-digest/lib/refreshed.mjs`). |

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
