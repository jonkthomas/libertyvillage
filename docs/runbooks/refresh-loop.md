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

## Writer prechecks and house voice

`scripts/lib/refresh-precheck.mjs` is the shared deterministic check for the
isolated writer and trusted submit. It reports all findings without rewriting
the draft. Storage limits, claim lint, title/topic/business/link binding,
snippet containment, image availability and unchanged-output checks remain in
place. The normal gate still runs afterwards with the same policy and budgets.

The October 27 evidence review counted distinct snapshot IDs, rather than
counting copies of the same run in polling output:

| Recurring code | Snapshots | Evidence files under `/tmp/lv-ops/golive/refresh/` | Existing precheck |
| --- | --- | --- | --- |
| `refresh-no-change` | 3 (3, 4, 5) | `three-final.out`, `four-final.out`, `five-final.out` | `extractRefreshedPost` |
| `refresh-fact-check` | 3 (2, 8, 9) | `two-final.out`, `seven-first-final.out`, `seven-final.out` | `lintPost` on the editable projection |
| `refresh-unbound` | 2 (10, 11) | `eight-first-final.out`, `eight-final.out` | `refreshBindingErrors` |
| `refresh-gate-failed` | 2 (12, 13) | `nine-final.out`, `ten-poll.out` | Independent gate review; semantic contradictions require judgment |

The retained subcodes were `unsupported-address` (8, 9) and
`draft-changed-topic` (10, 11), both already checked by the shared module.
There was no uncovered recurring mechanical cause to add in this slice.
Do not replace semantic review with a heuristic or weaken a check to increase
publication volume.

The weekly digest's **Appendix → Writer diagnostics** counts rejection codes,
deduplicating each code by target and snapshot/submission. A code seen at least
twice is labelled **candidate precheck**. Check existing coverage before adding
a rule; the label is a review queue, with no automatic issue filing. Counts use
the digest's existing seven-day run window and only the codes retained by the
runner; old logs with no detailed code cannot be reconstructed.

All blog, news, roundup and refresh writers read `scripts/prompts/lv-voice.md`.
Its house style is general; field limits and format rules stay in their own
prompts. `scripts/blog-lint.mjs` uses `scripts/lib/lv-voice-lint.mjs` for banned
words/phrases, stock framings and em-dash density. It scans reader-facing fields,
including FAQs and takeaways, without changing their values. Snippet refreshes
scan only their editable title, description and intro. Existing fact lint is
still blocking as before.

Voice rollout is **warn-only from 2026-10-27**, for at least two weeks (through
2026-11-10). Warnings appear in lint/writer output and successful submit receipts;
the runner retains their rule identifiers as `lv-voice-warning` events for the
digest. No generated prose is included in those events. News draft warnings also
appear in its existing validation output. A warning never consumes a refresh
revision or causes a rejection. Review warning volume and refusal rates after
the two weeks. Nothing enables blocking automatically.

To explicitly enable voice blocking later, change `VOICE_POLICY.blocking` to
`true` in `scripts/lib/lv-voice-lint.mjs` (one line), or set
`LV_VOICE_BLOCKING=1` on the trusted submit/gate process. The runner forwards that
flag to trusted CLI and source commands. The isolated refresh generator uses
the committed policy; the trusted gate enforces the explicit environment flag
even when the generator has no such flag. Do not change `LINT_MODE` for this
rollout: it controls existing claim lint, not the new editorial warnings.

Local focused verification:

```
LC_ALL=C CONTENT_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55432/postgres \
  ~/.pi/agent/bin/memguard -- node --test --test-concurrency=1 \
  tests/content/lv-voice.test.mjs tests/content/refresh-precheck.test.mjs \
  tests/runner/refresh-narrow.test.mjs tests/digest/precheck-candidates.test.mjs
```

### Staging proof handoff (ops worker only)

The builder runs no VM or staging actions. After the PR is merged and the ops
worker is authorized to update the staging runner, use its normal supported
refresh workflow, keeping the timer disabled:

1. In the staging checkout, prepare `/tmp/lv-voice-proof.json` containing
   `{"title":"A vibrant local guide."}`. Run
   `node scripts/blog-lint.mjs --post /tmp/lv-voice-proof.json`. Expect
   `lv-voice-warning`, `warnOnlySince: 2026-10-27`, a `WARN` line and exit 0.
2. Run `LV_VOICE_BLOCKING=1 node scripts/blog-lint.mjs --post /tmp/lv-voice-proof.json`.
   Expect `voice-banned-phrase` and exit 1. This is a local lint command; do not
   enable the flag on a staging publishing job during the observation period.
3. Run the existing staged refresh reservation/submit proof: export the local
   staging checkout using `node scripts/content/cli.mjs export --root . --target staging`,
   select a normal ranked candidate using `refresh plan --gsc <staging-gsc.json> --target staging`,
   then `refresh reserve --candidate <candidate.json> --target staging`. Use the
   returned snapshot ID with `refresh submit --snapshot <id> --before <before.json>
   --after <after.json> --actor ops:voice-proof --target staging`. Before/after
   must be full exports with exactly one allowed target edit. With a harmless
   banned phrase in an otherwise valid editable field, expect warning identifiers
   in the receipt while the unchanged normal gate decides the draft. Do not
   infer gate success from a lint warning or force publication.
4. Run `node --test tests/digest/precheck-candidates.test.mjs` in the staging
   checkout. This drives two independent rejected fixture attempts through the
   normal digest parser/model/HTML renderer (no live data). Confirm the same code counts 2
   and shows `candidate precheck` in the appendix. A repeated copy of one snapshot
   must count 1. Confirm an `lv-voice-warning` run event produces the warning line.

## Schedule

The timer stays **disabled** until the staging proof is accepted. The calendar is **Tue 04:23 UTC**. That fits the existing UTC timers:

- topic-discovery: Mon 10:00
- discover-businesses: Mon 13:00
- weekly-blog: Wed and Sun 11:00
- news: daily 12:17
- growth: Thu 10:37
- backfill: daily 15:37

A run makes at most 4 generator attempts, each capped at about 40 minutes, so it finishes well before the 12:17 news run. The single-instance runner lock (`flock -n`) would otherwise make the news run skip. A Tuesday run lands in the next Monday's digest.
