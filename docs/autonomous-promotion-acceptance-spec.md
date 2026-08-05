# LOCKED ACCEPTANCE SPEC — Autonomous Generator → Staging → Main Promotion System

Status: LOCKED VERIFIER RUBRIC. Authored by the independent eval/spec author. The builder
MUST NOT edit, weaken, delete, or re-scope this file. Any change to this file by the builder
is an automatic FAIL. The verifier is a different entity/model from the builder (maker ≠ checker).

Repo: `libertyvillage.co` (lib_village), default branch `main`, long-lived `staging` branch exists.
Current generators (must be migrated, not left as-is):
- `.github/workflows/weekly-seo-improvements.yml` — opens PR into `main` (must retarget to `staging`).
- `.github/workflows/discover-businesses.yml` — opens PR into `main` (must retarget to `staging`).
- `.github/workflows/weekly-blog.yml` — **pushes directly to `main`** (must be converted to a PR into `staging`).

Scoring: each gate is PASS / FAIL. FAIL of any gate G1–G13 = system rejected. "Partial",
"mostly", "will work once configured" all count as FAIL. Verifier records the exact command/URL
and observed output for every gate (Definition of Done = observed live GitHub behavior, never YAML that "looks right").

---

## Grounded facts the builder does NOT get to relitigate

- **F1. Model ID.** The review/gate model is Anthropic `claude-opus-5` (real, current API ID,
  announced 2026-07-24, available to all API customers). The literal string `claude-opus-5`
  MUST appear as the model passed to the review call. Substituting a cheaper/older model
  (`opus-4.x`, `sonnet`, `haiku`) for the GATE is a FAIL. `claude-opus-5-latest`/alias is NOT
  accepted for the gate — pin the snapshot ID the API returns.
- **F2. Recursion guard.** Events triggered by the default `GITHUB_TOKEN` do NOT create new
  workflow runs, EXCEPT `workflow_dispatch` and `repository_dispatch`
  (docs.github.com/en/actions/concepts/security/github_token). Therefore a PR opened/updated by
  a job using `secrets.GITHUB_TOKEN` will NOT reliably trigger the downstream CI/review/promote
  chain. The builder MUST bridge the chain with one of: (a) a PAT / GitHub App installation token,
  or (b) an explicit `workflow_dispatch`/`repository_dispatch`. A chain that depends on
  `GITHUB_TOKEN`-authored commits auto-triggering the next stage is FAIL by construction (G9).
- **F3. Auto-merge prerequisites.** Native auto-merge merges only when branch protection /
  required status checks are satisfied; a push by a non-write actor disables auto-merge. The
  merge decision MUST be enforced by required status checks on the protected branch, not by an
  unguarded `gh pr merge --admin` that bypasses the gates.
- **F4. Privileged triggers.** `pull_request_target` and secret-bearing jobs run with elevated
  trust (base-repo token + org/repo secrets). Any such job MUST be gated to same-repo, non-fork
  head (G2) before it can read `ANTHROPIC_API_KEY`/`GITHUB_TOKEN`.

---

## G1 — Generators open PRs into `staging`, never push to `main`, never auto-open into `main`

REQUIRED OBSERVABLE:
- All three generator workflows produce a PR whose `base` ref is `staging`.
- No generator contains `git push origin main` / `git push origin HEAD:main` or any PR with `base: main`.
- `weekly-blog.yml`'s direct-push-to-main step is removed/replaced by a PR-into-staging path.

PASS: `gh pr list --base staging --json headRefName,author` shows the generator PR; `grep -RnE
'base:\s*main|push .*origin.*\bmain\b|--base main' .github/workflows` returns nothing in the three generators.
FAIL-CLOSED: any generator that can land content on `main` without going through staging.
ANTI-GAMING: retargeting the PR base string is not enough if a later step force-merges to main outside the gates.

## G2 — Trusted same-repo gating on every privileged/automerge job

REQUIRED OBSERVABLE: every job that (a) reads `ANTHROPIC_API_KEY` or a write-scoped token, or
(b) can merge, is guarded so it only runs for same-repo, non-fork, trusted-author PRs.
PASS: guard expression present and effective, e.g.
`if: github.event.pull_request.head.repo.full_name == github.repository` (or an equivalent
label+actor allowlist that a fork PR cannot satisfy). Verifier confirms a simulated fork PR does
NOT reach the secret-bearing/merge job (job skipped in run logs).
FAIL-CLOSED: on any ambiguity about trust, the job is SKIPPED (not run). A workflow that would
run the review/merge on an untrusted fork head = FAIL.
ANTI-GAMING: `pull_request_target` without a same-repo head guard = automatic FAIL even if "it works" for the happy path.

## G3 — CI runs and must pass before any merge

REQUIRED OBSERVABLE: the automation PR triggers a CI job that at minimum runs `npm ci` and the
repo build (`npm run build`) and any existing tests; CI is a REQUIRED status check on `staging`.
PASS: CI run visible on the PR (`gh pr checks <pr> --json name,state`), and a PR with a
deliberately broken build is BLOCKED from merge (observed: red check + no merge).
FAIL-CLOSED: merge is impossible while CI is pending/failed. "CI configured but not required" = FAIL.

## G4 — Independent Opus 5 structured review, threshold ≥ 8 AND zero high/critical

REQUIRED OBSERVABLE: after CI green, an automated review calls `claude-opus-5` and emits a
STRUCTURED verdict (machine-parseable JSON), not prose. Minimum schema:
```json
{ "overall": <number 0-10>, "passed": <bool>,
  "findings": [ { "severity": "critical|high|medium|low", "path": "...", "note": "..." } ],
  "model": "claude-opus-5", "commit_sha": "<reviewed sha>" }
```
MERGE-ELIGIBLE iff `overall >= 8` AND no finding has severity `high` or `critical`. Both
conditions required; either alone is insufficient.
PASS: verifier finds the JSON artifact/comment for the PR, confirms `model=="claude-opus-5"` and
`commit_sha` matches the merged head, and that the merge decision honored the rule.
FAIL-CLOSED: a review that errored, timed out, returned unparseable output, or omitted the
model/sha fields = treated as NOT PASSED → PR blocked. Default on missing score = BLOCK, never merge.
ANTI-GAMING: threshold constants `8`, `high`, `critical` MUST be enforced in code, not just in a
prompt string. Verifier greps the merge-decision code for the literal threshold and severity checks.

## G5 — Different-model repair loop, hard cap 3

REQUIRED OBSERVABLE: when G4 fails, a FIXER agent using a model DIFFERENT from the reviewer
(`claude-opus-5`) attempts repair, commits to the PR branch, and re-triggers CI + a fresh
`claude-opus-5` review. This repair→re-review cycle runs at MOST 3 times per PR.
PASS: run logs / audit artifact show an attempt counter; the fixer model ID ≠ `claude-opus-5`;
after 3 failed cycles the loop STOPS and the PR is left blocked+labeled (G6). Verifier confirms a
persistent-failure PR does not loop a 4th time (counter enforced in code, e.g. `attempt < 3`).
FAIL-CLOSED: no bound, or a loop that keeps going, or a fixer that is the same model as the gate = FAIL.
ANTI-GAMING: the cap MUST be enforced server-side (counter persisted across runs via commit
trailer / PR label / artifact), not merely a for-loop inside one job that a re-run resets to bypass.

## G6 — Fail-closed labels + notification on every non-merge

REQUIRED OBSERVABLE: any PR that cannot merge (CI fail, review < gate, 3 exhausted, error) ends
in a BLOCKED terminal state: a distinguishing label (e.g. `needs-work` / `automation-blocked`)
AND a Slack notification (when `SLACK_WEBHOOK_URL` is set) is sent. The PR is NOT merged.
PASS: verifier drives a failing PR and observes the label applied (`gh pr view --json labels`)
and the notification step executed (log line / Slack payload). A blocked PR is never in a merged state.
FAIL-CLOSED: absence of the webhook secret must NOT crash the job or bypass the block — it skips
the Slack call only; the label + non-merge still hold.

## G7 — Audit artifacts + PR comment trail

REQUIRED OBSERVABLE: for every automation PR there is a durable audit trail: the review JSON, the
repair attempt count, the models used, and the final decision are persisted as a workflow artifact
AND/OR a PR comment. Enough to reconstruct why it merged or was blocked without re-running.
PASS: verifier retrieves the artifact/comment for a real PR and it contains reviewer model, score,
findings, attempt count, and final decision.
FAIL-CLOSED: a merge with no retrievable audit record = FAIL.

## G8 — Auto-merge into `staging` only on full pass, gate-enforced

REQUIRED OBSERVABLE: a PR that satisfies G3 (CI green) + G4 (score ≥ 8, no high/critical) merges
into `staging` with NO human interaction. Merge is enforced by required status checks + auto-merge
(F3), not by an admin override that skips checks.
PASS: verifier observes an end-to-end run where a passing PR reaches `merged` state into `staging`
automatically, and confirms no `--admin`/protection-bypass was used to skip a failing/absent check.
FAIL-CLOSED: if the gate check is missing/pending, the PR stays open. No merge on incomplete gates.

## G9 — Staging → main promotion with a SECOND cumulative Opus 5 gate

REQUIRED OBSERVABLE: after content lands on `staging`, an autonomous promotion opens a
`staging → main` PR and runs a SECOND `claude-opus-5` review over the CUMULATIVE diff
(`main...staging`, i.e. everything staging is ahead by), not just the last PR. Promotion to `main`
merges only if this cumulative review is `overall >= 8` AND no high/critical AND CI green on the merge ref.
PASS: verifier observes a `staging→main` PR, its review artifact covers the full `main...staging`
diff range (range recorded in the artifact), and merge to `main` happened only under those conditions.
The chain from staging-merge → promotion PR is triggered via a PAT/App token or explicit
dispatch (F2), NOT relying on a `GITHUB_TOKEN` commit to auto-fire.
FAIL-CLOSED: promotion blocked (PR left open, labeled, notified) when cumulative gate fails; main
is never written outside this gated PR path.
ANTI-GAMING: reviewing only the tip PR instead of `main...staging` = FAIL. Fast-forwarding staging
onto main without the second review = FAIL.

## G10 — Concurrency + idempotency

REQUIRED OBSERVABLE: each workflow declares a `concurrency` group so overlapping runs cannot
double-merge or race the same branch. Re-running a completed promotion is a no-op (no duplicate
PRs, no duplicate merges, no duplicate Slack spam). Deterministic branch/PR reuse (find-or-create).
PASS: verifier triggers two runs of the same stage and observes serialization + a single PR/merge;
a re-run after success produces "nothing to do."
FAIL-CLOSED: on lock/branch conflict, the run aborts rather than force-merging.
ANTI-GAMING: `concurrency` present but `cancel-in-progress: true` on the MERGE stage (which could
cancel mid-merge) is a FAIL for the merge/promote jobs — those must not be cancel-in-progress.

## G11 — Token & secrets safety

REQUIRED OBSERVABLE:
- Least privilege: each workflow sets explicit `permissions:`; only jobs that need write get
  `contents: write` / `pull-requests: write`. No blanket `permissions: write-all`.
- No secret is ever echoed/printed/committed; `ANTHROPIC_API_KEY` and any PAT/App key referenced
  only as `${{ secrets.* }}`/env, never inlined.
- Any credential file written to disk (e.g. GSA JSON) is mode `600` and removed in an
  `if: always()` cleanup step.
- The elevated PAT/App token (F2) is NOT exposed to steps that run untrusted/model-generated code
  where it could be exfiltrated.
PASS: `grep -RnE 'write-all|--token |ghp_[A-Za-z0-9]|printf.*SECRET' .github/workflows` clean;
verifier confirms cleanup step present and secret scoping.
FAIL-CLOSED: any secret reachable by fork/untrusted head (ties to G2) = FAIL.

## G12 — No human review requirement anywhere on the happy path

REQUIRED OBSERVABLE: from generator run to `main`, a fully-passing change requires ZERO human
clicks — no "request review", no required human approver, no manual "approve and run" that a person
must press. The ONLY approvals in the loop are automated CI + the two Opus 5 gates.
PASS: verifier traces one green end-to-end run (generator → staging PR → CI → Opus5 → auto-merge →
promotion PR → cumulative Opus5 → merge to main) with no human interaction recorded.
FAIL-CLOSED: note — G2's trust gate and G11's least-privilege are NOT "human review"; they are
automated guards and are REQUIRED. "No human review" must not be achieved by removing the safety gates.
ANTI-GAMING: disabling branch protection to achieve hands-free merge = FAIL (protection + required
checks must remain; automation satisfies them, humans are simply not in the loop).

## G13 — Live end-to-end proof (Definition of Done)

REQUIRED OBSERVABLE: the builder MUST provide ONE real, observed end-to-end execution on GitHub
(a real run, real PR numbers, real merge SHAs) demonstrating: (i) a PASS path merging to `main`,
and (ii) a FAIL path that stays blocked+labeled+notified and never merges. Screenshots or
`gh run view`/`gh pr view` JSON output are the evidence. YAML review alone is NOT acceptance.
PASS: both traces produced with URLs/SHAs the verifier can open.
FAIL: "implemented but not run" → status is UNVERIFIED, not done.

---

## ANTI-BLOAT CONSTRAINTS (over-engineering is a FAIL, not a bonus)

- **B1.** Build the smallest system that satisfies G1–G13. No new services, queues, databases,
  dashboards, or web UIs. GitHub Actions + existing `scripts/` + `gh` CLI + Anthropic API only.
- **B2.** Reuse the existing agent-SDK pattern already in `scripts/` (seo-improve-agent.js etc.).
  Do not introduce a second orchestration framework.
- **B3.** No speculative config: exactly two review gates (staging entry + main promotion). Do not
  add a third "extra safety" gate, tiers, or configurable N-of-M reviewers.
- **B4.** No new runtime deps beyond what a review/merge call needs. Adding heavyweight libraries
  (task queues, state stores, bespoke retry frameworks) when a PR label / commit trailer / artifact
  suffices = FAIL.
- **B5.** No hardening theater: don't add rate-limit shims, circuit breakers, multi-region, or
  metrics pipelines the intent didn't ask for. Fail-closed via label+block+notify is the whole
  resilience story.
- **B6.** Keep the three generators as three workflows sharing ONE reusable review/merge/promote
  workflow (`workflow_call`) — do not fork the gating logic three times, and do not collapse them
  into one mega-workflow that loses the concurrency isolation of G10.
- **B7.** Prompts/thresholds live in code/config as constants (G4), not duplicated across files.
  One source of truth for `SCORE_THRESHOLD=8`, `MAX_REPAIRS=3`, `GATE_MODEL=claude-opus-5`.

---

## VERIFIER COMMAND SET (run read-only unless driving a test PR)

```bash
# G1: no path to main from generators
grep -RnE 'base:\s*main|--base\s+main|push\s+.*origin\s+(HEAD:)?main' \
  .github/workflows/weekly-seo-improvements.yml \
  .github/workflows/discover-businesses.yml \
  .github/workflows/weekly-blog.yml            # expect: no matches

# G1: generators target staging
grep -RnE 'base:\s*staging|--base\s+staging' .github/workflows            # expect: matches in all 3

# G2: privileged/merge jobs carry a same-repo head guard
grep -RnE 'head\.repo\.full_name\s*==\s*github\.repository|pull_request_target' .github/workflows

# G4/G5/B7: thresholds & models enforced in code, not just prompts
grep -RnE 'claude-opus-5' scripts .github/workflows                        # gate model present
grep -RnE '(>=|>)\s*8|SCORE_THRESHOLD|MAX_REPAIRS|attempt\s*<\s*3' scripts # numeric gate & cap in code
grep -RniE 'critical|high' scripts/*review* 2>/dev/null                    # severity gate in code

# G11: secret hygiene
grep -RnE 'write-all|ghp_[A-Za-z0-9]{20,}|--token ' .github/workflows      # expect: no matches
grep -RnE 'if:\s*always\(\)' .github/workflows                             # cleanup steps present

# G10: concurrency present; merge jobs not cancel-in-progress
grep -RnA2 'concurrency:' .github/workflows

# Build sanity (CI parity)
npm ci && npm run build

# G13: live traces (driving real PRs — done by verifier, not builder self-report)
gh pr view <PASS_PR> --json state,mergedAt,mergeCommit,labels
gh pr view <FAIL_PR> --json state,labels,comments
gh run view <RUN_ID> --log | grep -E 'attempt|claude-opus-5|score|blocked'
```

## OVERALL ACCEPTANCE

ACCEPT iff G1–G13 all PASS with observed live evidence (G13) AND no anti-bloat constraint B1–B7 is
violated. Any single FAIL → system REJECTED and returned to the builder with the failing gate ID(s).
This file is the immutable rubric; if it is modified, verification restarts from the original locked copy.
