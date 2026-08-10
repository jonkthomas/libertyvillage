# News discovery + drafting pipeline

Human-gated hyperlocal news pipeline for Liberty Village. Discovery builds a **review queue**. Drafting turns one human-selected cluster into a **local draft proposal**. Neither stage publishes.

> **Operating model: human-gated by default + rare autonomous publish.**  
> Review-queue precision is roughly **6–7 of 10** clearly publish-worthy — fine when a human discards the rest. Unattended publishing of that band is **not** acceptable. A separate **strict** auto-publish gate may append at most one post/day when every safety check passes; zero publishes is the expected success path most days.

## What it does

| Stage         | Trigger                                     | Output                                                                 | Writes site content?                                  |
| ------------- | ------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------- |
| **Discovery** | Daily schedule + manual `workflow_dispatch` | `report.md`, `candidates.json`, `errors.json` (artifact + job summary) | **No** (reads `data/posts.json` read-only for dedupe) |
| **Drafting**  | Manual `workflow_dispatch` only             | Draft bundle under `.news-pilot/drafts/` (artifact + job summary)      | **No**                                                |
| **Autopublish** | After discovery (`workflow_run`) + manual | Optional single append to `data/posts.json` via PR into `staging`     | **Only if strict gate passes** (else zero = success) |

Scripts (local or CI):

- `node scripts/news-pilot/run.mjs` — discovery pilot
- `node scripts/news-pilot/draft.mjs` — evidence-bound draft stage
- `node scripts/news-pilot/publish.mjs` — rare autonomous publish path (strict gate)

Workflows:

- `.github/workflows/news-discovery.yml`
- `.github/workflows/news-draft.yml`
- `.github/workflows/news-autopublish.yml`

## Why most days still publish nothing

1. **Precision is not high enough for the review queue.** ~6–7/10 review items are clearly publish-worthy. Publishing that band unattended would ship weak or wrong local news about real businesses and neighbours.
2. **Autonomous publish is a separate, stricter gate.** It requires zero risk flags, official/primary **or** ≥2 independent substantive publishers, score ≥ **0.78** (above discovery `autoEligibleMin` 0.72), a verified image (draft path or neutral OG fallback `/images/og/og-home.jpg` — never fabricated), full `validateDraft` pass, non-duplicate coverage, not a concluded event, and **at most one** publish per day.
3. **Images stay non-fabricated.** Autopublish never invents an event photo path. It either verifies a real local image from the draft or uses the neutral site OG asset.
4. **Blast radius stays bounded.** Autopublish never commits to `main`, never auto-merges to main, and only opens a content PR into `staging` for the existing coordinator `news` kind + Opus gate.

Hard prohibitions that remain:

- No auto-merge to **main**
- No scheduled **drafting** of the human-gated workflow (discovery may trigger autopublish evaluation)
- No default pull-request creation from the **human draft** workflow
- No weakening of evidence, SSRF, quote-cap, image-existence, or run-date gates
- No branch-protection changes for this pipeline
- Human draft path stays artifact-only

### Auto-publish bar justification

Against real candidates in `.news-pilot/runs/`:

- `quality-9-v5-default` review reps top out ~0.61 (none clear 0.72 except development applications forced to review)
- live `review-fix-live-20260810T143929Z`: 0 auto-eligible / 0 review
- calibration rows ≥0.72 are almost entirely raw AIC development applications (excluded)

So a bar of **0.78** plus source/risk/image/cap gates is expected to auto-publish **0** of a typical top-10 queue — rare and certain by design.

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
| `BYTEPLUS_API_KEY`   | Preferred CI default (`prefer_model=byteplus-ark`)   |
| `DEEPSEEK_API_KEY`   | Optional fallback provider                           |
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
   - optional `prefer_model` (default `byteplus-ark`)
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

## Criteria before anyone considers relaxing the human gate

Do **not** enable auto-merge, scheduled drafting, or `data/posts.json` writes until **all** of the following are true and re-reviewed:

1. **Precision:** sustained ≥ ~9/10 review-queue items clearly publish-worthy on blind human audit across multiple weeks (not a single lucky run).
2. **Recall policy:** explicit product decision on missed civic stories vs. spam risk, documented and accepted.
3. **Image policy:** automated image acquisition that is rights-safe, non-fabricated, and validated — or a proven path that never ships without an image.
4. **Evidence regressions:** eval suite covering hallucination, date stamping, internal links, duplicate/follow-up handling, and source failures — maintained by a maker≠checker process.
5. **Operational ownership:** on-call human still reviews a sample; kill switch documented; no silent widening of permissions (`contents: write`, PR bots, coordinator dispatch).
6. **Separate sign-off:** a fresh independent review explicitly approves autonomous publishing (this doc’s human-gated sign-off is **not** that approval).

Until then: **discovery proposes, humans dispose, drafts remain proposals.**

## Permissions quick reference

| Workflow             | Job permissions                   |
| -------------------- | --------------------------------- |
| `news-discovery.yml`   | `contents: read`                                             |
| `news-draft.yml`       | `contents: read`, `actions: read`                            |
| `news-autopublish.yml` | job: `contents: write`, `pull-requests: write`, `actions: read` |

Discovery and human draft stay read-only. Only autopublish may open a staging PR (posts.json only) and dispatch coordinator kind `news`.
