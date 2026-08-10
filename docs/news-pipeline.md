# News discovery + drafting pipeline

Human-gated hyperlocal news pipeline for Liberty Village. Discovery builds a **review queue**. Drafting turns one human-selected cluster into a **local draft proposal**. Neither stage publishes.

> **Operating model: human-gated only.**  
> An independent review signed off on drafting-as-proposal, not autonomous publishing. Queue precision is roughly **6–7 of 10** clearly publish-worthy — fine when a human discards the rest in seconds, **not** acceptable unattended.

## What it does

| Stage         | Trigger                                     | Output                                                                 | Writes site content?                                  |
| ------------- | ------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------- |
| **Discovery** | Daily schedule + manual `workflow_dispatch` | `report.md`, `candidates.json`, `errors.json` (artifact + job summary) | **No** (reads `data/posts.json` read-only for dedupe) |
| **Drafting**  | Manual `workflow_dispatch` only             | Draft bundle under `.news-pilot/drafts/` (artifact + job summary)      | **No**                                                |

Scripts (local or CI):

- `node scripts/news-pilot/run.mjs` — discovery pilot
- `node scripts/news-pilot/draft.mjs` — evidence-bound draft stage

Workflows:

- `.github/workflows/news-discovery.yml`
- `.github/workflows/news-draft.yml`

## Why it is not autonomous

1. **Precision is not high enough.** ~6–7/10 review items are clearly publish-worthy. Automation that published the rest would ship weak or wrong local news.
2. **Images are a hard human gate.** Drafts may validate as textually grounded while still requiring a real image path a human supplies. The pipeline must not fabricate images or publish without one.
3. **Evidence and tone still need judgment.** Follow-ups, civic process stories, and multi-source clusters benefit from a quick human read before anything hits the site.
4. **Blast radius.** Auto-merge into `staging`/`main` or writing `data/posts.json` from Actions would couple a noisy classifier to production content.

Hard prohibitions (do not “just add” these):

- No auto-merge
- No auto-publish
- No scheduled drafting
- No default pull-request creation from the draft workflow
- No automation writing `data/posts.json`
- No dispatch of the autonomous coordinator for this pipeline
- No branch-protection changes for this pipeline

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
| `news-discovery.yml` | `contents: read`                  |
| `news-draft.yml`     | `contents: read`, `actions: read` |

Neither workflow requests `contents: write`, `pull-requests: write`, or `packages` scopes.
