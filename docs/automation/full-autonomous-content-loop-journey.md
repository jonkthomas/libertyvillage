# Journey — Full Autonomous Content Publishing Loop

Status: **LOCKED EVALUATOR-OWNED ARTIFACT.** Companion to
`docs/automation/full-autonomous-content-loop-prd.md` and
`tests/automation/full-autonomous-loop.eval.mjs`. The builder MUST NOT edit it.

This document answers three questions and nothing else:
**what does a human actually do**, **what evidence proves the loop worked**, and
**who is allowed to sign off on what**.

---

## 1. The journey, as clicks and inputs

### 1.1 One-time enablement (human, once)

| Step | Actor | Action | Evidence it happened |
| --- | --- | --- | --- |
| E1 | John | Merge the implementation PRs for tickets 1–3 | `gh pr list --state merged --limit 5` shows them merged into `main` |
| E2 | John | Confirm the schedules are enabled: `Weekly Blog Pipeline`, `Weekly SEO Improvements`, `Blocked automation PR sentinel`, `Promotion sweep` | `gh workflow list --repo jonkthomas/libertyvillage` shows all four `active` |
| E3 | John | Confirm secrets exist in the repo environment the schedules run in (model key, Google SA JSON, GA property, Pexels) | `gh secret list --repo jonkthomas/libertyvillage` lists them (names only; values are never printed) |

### 1.2 Steady state (human, every cycle)

**Exact clicks and inputs required: _none_.**

No dashboard to open, no button to press, no PR to approve, no label to apply, no comment to write,
no merge to click, no deploy to trigger. The loop generates, lints, opens, validates, tests, gates,
repairs or regenerates, merges to `staging`, promotes to `main`, and Vercel deploys `main`.

The only human actions that remain are **exceptions**, and each one is a defined escape hatch, not
part of the happy path:

| Exception | Human action | Frequency budget |
| --- | --- | --- |
| `ABANDONED_TOPIC` after 3 bounded candidates (F14) | read the audit comments, decide whether the topic is worth a hand-written post | expected rare; any occurrence is an SLO signal |
| A legitimate business closure needs a record deleted (F13) | apply the `allow-record-deletion` label to that PR | expected rare; by design |
| Rollback lever L1–L7 (PRD §8) | flip the named flag | only on a confidence loss |

**Anything else that requires John is a defect against the "0 human interventions per cycle" SLO.**

### 1.3 What the end user sees

A reader of `libertyvillage.co` sees new, factually grounded posts appear on the blog and topic
pages. Nothing else changes: no new route, no new UI, no new interaction, no visible automation.
This is the whole of the end-user-visible journey — the rest of the program is operator evidence.

---

## 2. Observable evidence contract

Evidence is only evidence if it can be pulled after the fact by a third party. Every item below is
a command anyone with read access can run.

### 2.1 A blog candidate was generated and grounded (Ticket 1)

```
gh run list --repo jonkthomas/libertyvillage --workflow "Weekly Blog Pipeline" --limit 3
gh run view <run-id> --repo jonkthomas/libertyvillage --log | grep -i "blog-lint"
```

- **Expected on a clean draft:** a `blog-lint` step that exits 0 with zero findings, followed by the
  commit + PR + dispatch steps.
- **Expected on a fabricating draft:** `blog-lint` exits non-zero, **no PR is opened**, and the run
  summary names the rules that fired (`unsupported-address`, `unsupported-price`,
  `unsupported-hours`, `unsupported-date`, `unrecorded-business`). A discarded draft is a
  **success** of the loop, not a failure.
- **Diff shape:** `gh pr view <n> --json files --jq '.files[].path'` returns only
  `data/posts.json` and `public/images/blog/*`. Any `tasks/` path is a Ticket 1a regression.

### 2.2 The gate adjudicated against ground truth (Ticket 2)

```
gh pr view <n> --repo jonkthomas/libertyvillage --comments
```

- Each gate round posts one deduplicated `<!-- automation-audit:<sha>:<decision>:<attempt> -->`
  comment carrying decision, exact commit, reviewer model `claude-opus-5`, score, attempt count,
  and the findings list.
- **Grounding evidence:** no finding contradicts a `data/businesses.json` record. A finding that
  asserts a correction the repo's own data disproves (the Balzac's class) is a Ticket 2a regression.
- **Convergence evidence:** across rounds on one PR, `Score:` is non-decreasing and no round
  introduces a `high`/`critical` that the previous round did not have.
- **Short-circuit evidence:** a verdict whose blocking findings are all unrepairable posts
  `Decision: **unrepairable**` with `Repair attempts: 0/3` — zero fixer runs in the run graph.

### 2.3 Every run reached exactly one visible terminal state (Ticket 3a)

```
gh run view <coordinator-run-id> --repo jonkthomas/libertyvillage --json jobs \
  --jq '.jobs[] | select(.conclusion != "skipped") | .name'
```

- Exactly one of `pass-generator` / `block-generator` / `validation-failed-generator`
  (or the promotion trio) appears, **or** one of the two documented continuations
  (`apply-generator-repair`, `heal-generator-base`) which redispatch a new exact SHA.
- On a validation throw: `validation-failed-generator` ran, the PR carries `automation-blocked`,
  the head SHA carries a failing `automation/*` status, and one audit comment exists.
  Zero of those three is the "invisible PR" defect.

```
gh api repos/jonkthomas/libertyvillage/commits/<sha>/status \
  --jq '[.statuses[] | select(.context|startswith("automation/")) | {context,state}]'
```

### 2.4 Staging merged and main was promoted (Ticket 3b/3c)

```
gh pr view <n> --json mergedAt,mergeCommit,baseRefName
gh api repos/jonkthomas/libertyvillage/compare/main...staging --jq '{ahead_by,behind_by,status}'
gh run list --repo jonkthomas/libertyvillage --workflow "Promotion sweep" --limit 5
```

- **Promotion success:** the staging→main PR is merged, and `compare/main...staging` reports
  `ahead_by: 0`. This is the single strongest end-to-end signal — content is on `main`.
- **Sweep evidence:** every sweep tick writes to its step summary what it observed
  (`ahead_by`, staging head age, open promotion PRs) and whether it dispatched. A tick that
  dispatches names the exact staging SHA it dispatched.
- **Timeout evidence:** an `observe-and-promote` timeout logs the handoff and exits 0; the PR
  must **not** acquire `automation-blocked` while auto-merge is still armed.

### 2.5 Recovery actually recovered (Ticket 3d/3e, F7/F8/F14)

- **Transient:** the failing run logs the classification `transient` and a redispatch with backoff;
  the following run reaches a terminal state. Never more than `MAX_TRANSIENT_RETRIES` redispatches
  for one SHA.
- **Conflict heal:** `automation-heal-1` (then `-2`) appears on the PR, the healed commit is a true
  two-parent merge of the validated head and the staging head, and the run redispatches the new SHA.
- **Regeneration:** the exhausted candidate's PR is **closed** with a final audit comment; no new
  candidate appears until the cooldown has elapsed; the next candidate is a *different, freshly
  generated draft* (different branch, different slug or materially different content) — never a
  re-push of the rejected draft.

### 2.6 Destructive changes were refused (Ticket 3f)

```
gh pr view <n> --comments   # look for the destructive-diff line in the audit comment
```

- A PR that drops a slug-keyed base record is rejected at validation with a named error, and the
  audit comment says so loudly. With the human `allow-record-deletion` label applied, it proceeds
  and the audit comment records that the guard was **overridden by a human**.

### 2.7 The tripwire is quiet (Ticket 3g)

```
gh run list --repo jonkthomas/libertyvillage --workflow "Blocked automation PR sentinel" --limit 7
```

- Each daily run reports both passes: stale `automation-blocked` PRs, and **orphans**
  (bot-authored, open, no `automation/*` status, no `automation-*` label, idle > 24h).
- Steady state is `0` orphans. A non-zero orphan count means §2.3's guarantee has broken somewhere
  and is the highest-priority signal in this system.

---

## 3. Local agent verification vs. human-owned hosted-prod UAT

These are different activities with different authority. Do not conflate them.

### 3.1 Local agent verification — what an agent may claim

Runnable by any agent or engineer, offline, deterministic, no secrets, **zero model spend**:

```
node --test tests/automation/full-autonomous-loop.eval.mjs      # this journey eval
npm run test:automation                                          # existing automation suite
npm run test:news-pilot                                          # existing news safety suite
npm run lint:automation
node scripts/blog-lint.mjs --post <fixture.json>                 # Ticket 1c, once it exists
```

Opt-in, read-only GitHub, still zero model spend:

```
LV_LIVE_CANARY=1 LV_CANARY_REPO=jonkthomas/libertyvillage \
  node --test tests/automation/full-autonomous-loop.eval.mjs
```

The canary asserts three live invariants only — branch protection still requires `automation/ci`
and `automation/opus-gate` with `enforce_admins`, `main` is not stranded behind `staging`, and no
bot PR is sitting without a terminal state. It **must never** invoke a model, write to the
repository, or dispatch a workflow.

**An agent may claim:** "the eval is green at 34 pass / 0 fail / 3 skipped", "the canary invariants
hold as of `<timestamp>`", "`gh run view <id>` shows exactly one terminal job".
Each claim must carry the exact command and its observed output.

**An agent may NOT claim:** "the loop is working", "content publishes autonomously", "done",
"shipped". Compilation, type-checking, and green tests are not evidence of live behaviour.

### 3.2 Human-owned hosted-prod UAT — what only John signs off

Production is `libertyvillage.co` on `main`, deployed by Vercel. Only John accepts it, and only
after observing a **full unattended cycle** end to end:

| UAT gate | Observation John makes | Where |
| --- | --- | --- |
| U1 | A blog candidate was generated with no human trigger | Actions → Weekly Blog Pipeline, scheduled run |
| U2 | The candidate passed the Opus gate at `>= 8` with zero high/critical, or was correctly blocked/regenerated | PR audit comments |
| U3 | The PR merged into `staging` without a human clicking merge | PR timeline: merged by `github-actions[bot]` via auto-merge |
| U4 | `main` received the promotion, `ahead_by: 0` | `gh api compare/main...staging` |
| U5 | The post is live and correct on the public site | browser: the post URL on `libertyvillage.co`, links resolve, business facts match `businesses.json` |
| U6 | Zero human interventions occurred during the cycle | PR timelines contain no human comment, label, close, or merge |

**U5 is John's alone.** No agent may open production, judge the rendered page, or declare the
content acceptable to readers. An agent's role ends at U4 with evidence; the reader-facing judgment
is human-owned.

**Definition of done for this program:** U1–U6 observed on **one complete unattended cycle**, with
the eval green offline, and the first merged blog PR frozen as reliability fixture `F11`.
Anything short of that is "implemented but UNVERIFIED".
