# News discovery + drafting pipeline

Human-gated hyperlocal news pipeline for Liberty Village. Discovery builds a **review queue**. Drafting turns one human-selected cluster into a **local draft proposal**. Neither stage publishes.

> **Operating model: human-gated by default + rare autonomous publish.**  
> Review-queue precision is roughly **6–7 of 10** clearly publish-worthy — fine when a human discards the rest. Unattended publishing of that band is **not** acceptable. A separate **strict** auto-publish gate may append at most one post/day when every safety check passes; zero publishes is the expected success path most days.

## What it does

| Stage           | Trigger                                     | Output                                                                 | Writes site content?                                  |
| --------------- | ------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------- |
| **Discovery**   | Daily schedule + manual `workflow_dispatch` | `report.md`, `candidates.json`, `errors.json` (artifact + job summary) | **No** (reads `data/posts.json` read-only for dedupe) |
| **Drafting**    | Manual `workflow_dispatch` only             | Draft bundle under `.news-pilot/drafts/` (artifact + job summary)      | **No**                                                |
| **Autopublish** | After discovery (`workflow_run`) + manual   | Optional single append to `data/posts.json` via PR into `staging`      | **Only if strict gate passes** (else zero = success)  |

Scripts (local or CI):

- `node scripts/news-pilot/run.mjs` — discovery pilot
- `node scripts/news-pilot/draft.mjs` — evidence-bound draft stage
- `node scripts/news-pilot/publish.mjs` — rare autonomous publish path (strict gate)

Workflows:

- `.github/workflows/news-discovery.yml`
- `.github/workflows/news-draft.yml`
- `.github/workflows/news-autopublish.yml`

## Why most days still publish nothing

1. **The review queue is not the publish gate.** Roughly 6–7/10 review items are clearly publish-worthy, so that broad band remains human-only.
2. **Autonomous eligibility is categorical.** It requires zero risk flags across discovery metadata **and fetched evidence bodies**; official/primary evidence or at least two substantive independent publisher domains; a real current event rather than a permit row, municipal landing page, video, listicle, or opinion; a verified existing image; non-duplicate coverage; full `validateDraft` success; and at most one publish per day. `score.total >= 0.42` is only a low review-queue sanity floor, not confidence.
3. **Images stay non-fabricated.** Autopublish never invents an event-photo path. It verifies a real local asset and may use the existing neutral site OG asset when the story has no event-specific image.
4. **The full path is autonomous but double-gated.** Autopublish itself only opens a content-only PR into `staging`. The trusted coordinator requires exact-SHA CI plus an independent Opus review before staging merge, then creates a cumulative `staging` → `main` promotion that receives a second exact-range CI/Opus review before native auto-merge. No workflow directly commits to either protected branch.

Hard prohibitions that remain:

- No direct commit to `staging` or `main`; publication must traverse both protected PR gates
- No scheduled **drafting** of the human-gated workflow (discovery may trigger the separate strict autopublish evaluation)
- No default pull-request creation from the **human draft** workflow
- No weakening of evidence, SSRF, quote-cap, image-existence, or Toronto run-date gates
- No branch-protection changes for this pipeline
- Human draft path stays artifact-only

### Auto-publish bar justification

A numeric threshold cannot separate real stories from database rows. Across real discovery artifacts, substantive Liberty Village stories score roughly 0.46–0.57 while raw AIC development-application records can exceed 0.78. Therefore `score.total` ranks the human queue but does not represent publication confidence.

The autonomous bar is instead the conjunction above. Calibration across historical runs produced roughly six distinct eligible stories while correctly excluding 40+ permit rows, municipal landing pages, video segments, single-source stories, crime/legal coverage, civic controversy, and concluded events. Zero publication remains a normal and successful result.

## Required GitHub Actions secrets (names only)

Configure under repo **Settings → Secrets and variables → Actions**. Values never belong in yaml, docs commits, logs, or artifacts.

### Discovery

| Secret name       | Purpose                                |
| ----------------- | -------------------------------------- |
| `SERPER_API_KEY`  | Serper Google/News discovery           |
| `SERPAPI_API_KEY` | SerpApi Google News / Trends discovery |

### Drafting

At least **one** model credential must be present for generation (not needed for `--skip-generate` / `skip_generate=true`):

| Secret name          | Purpose                                              |
| -------------------- | ---------------------------------------------------- |
| `ANTHROPIC_API_KEY`  | Preferred CI default (`prefer_model=anthropic`)      |
| `BYTEPLUS_API_KEY`   | Optional credential fallback (`byteplus-ark`)        |
| `DEEPSEEK_API_KEY`   | Optional credential fallback                         |
| `OPENAI_API_KEY`     | Optional fallback provider                           |
| `GOOGLE_API_KEY`     | Optional Gemini fallback                             |
| `VENICE_API_KEY`     | Optional fallback provider                           |
| `KIMI_CODER_API_KEY` | Optional; local OAuth refresh is not relied on in CI |

Draft workflow also accepts discovery keys if present (`SERPER_API_KEY`, `SERPAPI_API_KEY`) but drafting does not require them today.

**Never** commit vault files, paste keys into workflow files, or `echo` secret values in steps.

## Schedule cadence (discovery)

- **Cron:** `17 12 * * *` (daily 12:17 UTC)
- **Why daily:** mandate is “most days publish nothing.” Daily discovery is enough to surface slow civic/development items without over-polling paid search APIs. Drafting stays manual so empty or weak days cost only a skim of the job summary.

## How to run — local

### Discovery

```bash
# Default shadow run (writes under .news-pilot/runs/<timestamp>/)
node scripts/news-pilot/run.mjs

# Shorter window + explicit out dir
node scripts/news-pilot/run.mjs --since-hours=168 --out=.news-pilot/runs/manual-week

# Limit sources while debugging
node scripts/news-pilot/run.mjs --max-sources=3 --out=.news-pilot/runs/debug
```

Credentials: set `SERPER_API_KEY` / `SERPAPI_API_KEY` in the environment, or rely on the optional local vault path the script understands. CI never reads the local vault (`--vault=/dev/null`).

### Drafting

Human must pass **`--cluster`** or **`--rank`** (no auto-pick of #1):

```bash
node scripts/news-pilot/draft.mjs \
  --run=.news-pilot/runs/<runDir> \
  --cluster=c0071

# or
node scripts/news-pilot/draft.mjs \
  --run=.news-pilot/runs/<runDir> \
  --rank=3

# evidence + gate only
node scripts/news-pilot/draft.mjs \
  --run=.news-pilot/runs/<runDir> \
  --cluster=c0071 \
  --skip-generate
```

Output: `.news-pilot/drafts/<timestamp>/` (gitignored), including `draft.md`, `draft.json`, `validation-report.json`, `gate.json`, `result.json`, evidence pack, etc.

### Autopublish (local)

```bash
# Dry-run against a discovery artifact (no posts.json write)
node scripts/news-pilot/publish.mjs \
  --run=.news-pilot/runs/<runDir> \
  --dry-run \
  --now=2026-08-10T18:00:00.000Z

# Real append (still local only — you open the PR)
node scripts/news-pilot/publish.mjs --run=.news-pilot/runs/<runDir>
```

Zero published is exit 0. Output under `.news-pilot/publish/<stamp>/`.

### Tests

```bash
node --test tests/news-pilot/*.test.mjs
# or
npm run test:news-pilot
```

## How to run — CI

### Discovery

1. Actions → **News Discovery (human review queue)** → Run workflow
   - optional `since_hours`, `dry_run`, `max_sources`
2. Or wait for the daily schedule.
3. Open the run’s **Summary** for decision counts + top review candidates.
4. Download artifact `news-discovery-<run_id>` for full JSON/markdown.

**Zero candidates = success.** The job fails only on genuine errors (script crash, missing artifacts, or all sources failed).

### Drafting

1. From a discovery summary/artifact, copy the **run id** and a **cluster id** (or rank).
2. Actions → **News Draft (human-gated)** → Run workflow
   - `discovery_run_id` (required)
   - `cluster_id` **or** `rank` (required human selection)
   - optional `prefer_model` (default `anthropic`)
   - optional `skip_generate`
3. Read the job **Summary** for gate + validation + human gates (especially missing image).
4. Download artifact `news-draft-<run_id>`.

No PR is opened. Promote content only through a deliberate human edit path.

## How to read the review queue

**Job summary (fast path)**

- Decision counts: `auto-eligible`, `review`, `reject`
- Table of top auto-eligible + review clusters with score, cluster id, title, source link
- Zero-row queue is normal

**Artifact (full path)**

- `report.md` — narrative run report, top candidates, source stats, errors
- `candidates.json` — full scored candidates + representatives + run metadata
- `errors.json` — per-source failures (redacted)

Tiers:

| Decision        | Meaning                                                                         |
| --------------- | ------------------------------------------------------------------------------- |
| `auto-eligible` | Scoring thinks it could publish — **still human-gated** in this operating model |
| `review`        | Needs human judgment (including follow-ups to existing posts)                   |
| `reject`        | Duplicate, out of scope, weak evidence, or hard fail                            |

Treat **auto-eligible + review** as the queue a human skims. Do not auto-publish auto-eligible items.

## Safety gates

| Gate                               | Where                         | Blocks                                                                                            |
| ---------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------- |
| Shadow discovery / no publish path | `run.mjs`, discovery workflow | Any write to site content; no PR/merge                                                            |
| Read-only posts index              | `run.mjs` / dedupe            | Uses `data/posts.json` only to mark covered/follow-up                                             |
| Explicit cluster/rank selection    | `draft.mjs`                   | Refuses to draft without human selection                                                          |
| Evidence gate                      | `draft-gate.mjs`              | Refuses model call when evidence is insufficient                                                  |
| Grounded validation                | `draft-validate.mjs`          | Fails draft on ungrounded claims, bad links, date rules, etc.                                     |
| Missing image human gate           | validation / `draft.md`       | Draft may pass text checks but **not** publish-ready without a real image                         |
| Artifact-only CI outputs           | both workflows                | Uploads artifacts; does not commit, push, or open PRs                                             |
| Minimum token permissions          | workflows                     | `contents: read` (+ `actions: read` on draft for artifact download); `persist-credentials: false` |
| No vault in CI                     | both workflows                | `--vault=/dev/null`; secrets only via `${{ secrets.NAME }}`                                       |

Controlled refusals (selection required, evidence gate fail) exit cleanly for the operator; hard failures (all sources down, model error, validation fail) fail the job.

## Autonomous activation decision and ongoing controls

The broad discovery queue and manual draft workflow remain human-gated. The separate strict autopublish path was explicitly approved for activation on **2026-08-10**, subject to all of these controls remaining true:

1. **Precision boundary:** only the categorical strict gate may publish; discovery `auto-eligible` and `review` labels never authorize publication.
2. **Recall policy:** missing a story is preferable to publishing uncertain local claims; zero publications is expected and successful.
3. **Image policy:** every emitted image path must resolve to an existing repository asset; model-invented paths are rejected.
4. **Evidence regressions:** tests cover source failures, evidence-body risk detection, dates, links, duplicates/follow-ups, images, atomic append, daily cap, and content-only workflow boundaries.
5. **Operational ownership:** branch protections, workflow cancellation, audit artifacts, and the human draft path remain available; permissions may not widen silently.
6. **Separate sign-off:** every content PR and cumulative promotion requires an exact-SHA/range independent Opus gate with score ≥8 and zero high/critical findings.

If any control fails, the run must publish zero and remain blocked. The kill switch is disabling `.github/workflows/news-autopublish.yml`; discovery and manual drafting continue independently.

## Permissions quick reference

| Workflow               | Job permissions                                                 |
| ---------------------- | --------------------------------------------------------------- |
| `news-discovery.yml`   | `contents: read`                                                |
| `news-draft.yml`       | `contents: read`, `actions: read`                               |
| `news-autopublish.yml` | job: `contents: write`, `pull-requests: write`, `actions: read` |

Discovery and human draft stay read-only. Only autopublish may open a staging PR (posts.json only) and dispatch coordinator kind `news`.
