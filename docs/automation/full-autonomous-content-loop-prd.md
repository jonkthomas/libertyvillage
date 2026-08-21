# PRD — Full Autonomous Content Publishing Loop (blog + SEO)

Status: **LOCKED EVALUATOR-OWNED SPEC.** Authored by the independent eval/spec author from the
completed reliability audit (`lv-blog-seo-reliability-mt32ros1-t43q56`, 2026-08-21) plus a
read-only inspection of `origin/main` @ `d042881` and live GitHub evidence.
The builder MUST NOT edit, weaken, delete, re-scope, or skip this file or its eval.
Maker != checker. Any builder edit to the locked artifacts is an automatic FAIL.

Locked artifacts (see `evals/full-autonomous-content-loop.sha256`):

| Artifact | Role |
| --- | --- |
| `docs/automation/full-autonomous-content-loop-prd.md` | this contract |
| `docs/automation/full-autonomous-content-loop-journey.md` | observable journey + evidence contract |
| `tests/automation/full-autonomous-loop.eval.mjs` | executable gate (RED on `origin/main`) |

Prior art that stays in force and is **not** superseded:
`docs/autonomous-promotion-acceptance-spec.md` (G1–G13 acceptance rubric for the
generator → staging → main machinery). This PRD extends it to *content acceptance and
self-recovery*; it does not relitigate G1–G13.

---

## 1. Objective and non-negotiables

**Objective.** Blog and SEO content is generated, fact-grounded, quality-gated, repaired or
re-generated as needed, merged through `staging`, promoted to `main`/production, and every
*recoverable* failure self-recovers — with **zero** John interventions after the schedules are
enabled.

**Non-negotiable invariants.** Any change that violates one of these fails the eval by design:

- **N1. The gate does not move.** `SCORE_THRESHOLD = 8`, blocking severities `['critical','high']`,
  `GATE_MODEL = 'claude-opus-5'`. No threshold lowering, no severity downgrade, no
  "publish anyway after N attempts", no per-kind exemption.
- **N2. The gate decision is recomputed server-side.** The model's self-declared `passed` is never
  trusted. (Ticket 2 makes `passed` *optional and ignored*; it must never become authoritative.)
- **N3. Every budget is finite.** Repairs, fixer attempts, heals, transient retries, and
  regenerations all have hard caps and a human-visible terminal state at the end. No hot loop.
- **N4. No low-quality forced publish.** An exhausted candidate is **closed**, never merged.
  Recovery means a *fresh grounded candidate*, not a re-push of the rejected draft.
- **N5. Fail closed.** Ambiguity, validation throw, unknown conflict, missing evidence → refuse and
  leave a visible terminal state. Silence is a bug, not a pass.
- **N6. Untrusted content never executes.** PR content is data. Model calls run with `tools: []`.
  Repairs land only through a validated splice against a trusted base.

---

## 2. What already works — do NOT rebuild (audit-confirmed, re-verified read-only)

These are covered by `[GREEN]` regression tests in the eval. Touching them is scope creep.

| Working mechanism | Evidence |
| --- | --- |
| Exact-SHA pinning end to end (validate, review, repair, heal, promote) | `policy.mjs` `isExactSha`, `validatePullRequest`, `evaluateObservedMerge`; eval §9 |
| Fail-closed Opus gate with server-side recompute | `policy.mjs:evaluateVerdict`; eval §0 |
| Branch protection on **both** branches requiring `automation/ci` + `automation/opus-gate`, `enforce_admins: true` | live `gh api repos/jonkthomas/libertyvillage/branches/{main,staging}/protection`, 2026-08-21 |
| Bounded repair budget with single-controlled-label lifecycle (`MAX_REPAIRS = 3`) | `policy.mjs:readRepairAttempt/canRepair`; eval §7 |
| Bounded base-heal for both-appended record conflicts (`MAX_HEALS = 2`) | `heal-base.mjs`; eval §8 |
| Per-record repair with immutable-field contracts and post-write re-validation | `preflight.mjs`, `record-repair.mjs`, `coordinator.mjs:applyRecordFix` |
| Dispatch-only coordinator, serialized by concurrency group, no `workflow_call` | `.github/workflows/autonomous-coordinator.yml` |
| Blocked-PR sentinel: read-only daily sweep + proven live escalation (run `32370716880`) | `blocked-sentinel.mjs`; eval §12 |
| Generation machinery itself: blog 4/4 successful runs since 08-09; SEO weekly 08-10 and 08-17 | audit baselines |
| News path: 1/1 merged at 8.2; SEO path: 2/3 merged | audit baselines |

**Explicitly rejected (do not propose again):** lowering the 8.0 threshold; adding `tasks/*` to
`repairablePaths`; giving the gate web/search tools; a Tier-3 live-model eval before the first
blog PR merges; reordering `set-attempt` relative to the repair push.

---

## 3. State machine

### 3.1 Candidate lifecycle (one topic → one publishable post)

```
                    ┌───────────────────────────────────────────────┐
                    │                 SCHEDULED                     │  weekly cron
                    └──────────────────────┬────────────────────────┘
                                           v
                                     GENERATING
                                           v
                           ┌────────  CLAIM-LINT  ───────┐  (fail-closed, pre-PR)
                     lint fail                        lint pass
                           v                              v
                   DISCARDED_PRE_PR                 CANDIDATE_OPEN  (PR into staging)
                (no PR, run summary only)                 v
                                                     VALIDATING
                              ┌──────────────────────────┼──────────────────────┐
                     validation throw               validated               untrusted
                              v                          v                      v
                    BLOCKED_VALIDATION*             CI (merge ref)        REFUSED (terminal)
                              │                   ┌───────┴────────┐
                              │             ci fail              ci pass
                              │                   v                  v
                              │            HEALING (<=2)          GATING
                              │             │        │               │
                              │      healed │        │ unhealable    │
                              │             v        v               v
                              │        (redispatch)  └──────> BLOCKED_EXHAUSTED*
                              │                                      ^
                              │                        gate pass     │  gate fail
                              │                              v       │       v
                              │                          PASSED      │   CLASSIFY findings
                              │                              v       │   ├─ all unrepairable ─> BLOCKED_UNREPAIRABLE*
                              │                     AUTOMERGE_ARMED  │   ├─ budget left + improving ─> REPAIRING ─┐
                              │                              v       │   └─ regressed / new blocking / budget out ┘
                              │                       MERGED_STAGING └──────────────> BLOCKED_EXHAUSTED*
                              │                              v
                              └──────────────────────>  (promotion, §3.2)
```

`*` = human-visible terminal state (label + head status + deduplicated audit comment + Slack).
Every `BLOCKED_*` terminal feeds the bounded recovery policy in §6, which either
**closes and regenerates** a fresh candidate on a later cycle or **abandons the topic**.

### 3.2 Promotion lifecycle (`staging` → `main`)

```
MERGED_STAGING ──dispatch──> PROMOTION_VALIDATING ──> PROMOTION_PR ──> CI ──> GATING
                    │                 │                                        │
       dispatch lost │   validation throw                            pass ─────┴──> PROMOTED_MAIN (terminal success)
                    │                 v                              fail ────────> BLOCKED_PROMOTION*
                    │        BLOCKED_VALIDATION*
                    v
          PROMOTION SWEEP (cron, >=every 6h): ahead_by > 0 AND staging head older than 24h
          AND no open promotion PR AND no dispatch this tick  ──> re-dispatch exact staging SHA
```

`no_changes = true` (main already contains staging) is a documented **no-op terminal**, not a block.

### 3.3 Terminal-outcome invariant

For every coordinator run, **exactly one** of
`{pass-generator, block-generator, validation-failed-generator}` (generator kinds) or
`{pass-promotion, block-promotion, validation-failed-promotion}` (promotion) must run —
*except* the two documented continuations `apply-generator-repair` and `heal-generator-base`,
which redispatch an exact new SHA and therefore hand the invariant to the next run, and the
promotion `no_changes` no-op. This is executed, not asserted by eye: the eval parses the real
workflow and evaluates every job's `if:` expression against synthetic `needs` contexts.

---

## 4. Trust boundaries

| Zone | Contents | Rule |
| --- | --- | --- |
| **Trusted** | tooling checked out from `main` (`scripts/automation/*`), `constants.mjs` policy, branch protection, GitHub-reported PR metadata | executes; is the only thing that decides |
| **Repo-controlled reference data** | `data/businesses.json` records supplied to the gate and fixer | read by trusted code, framed to the model inside `<<<UNTRUSTED_REFERENCE_DATA>>>`; never executed |
| **Untrusted** | PR diff, generated post text, model output (verdicts, repair plans), GSC query strings | data only; every model call runs `tools: []`; every plan is re-validated by trusted code before *and* after write |
| **Privileged jobs** | anything reading a model key or a write token, and anything that can merge | gated on same-repo + non-fork + `github-actions[bot]` author + exact SHA + policy paths (`validatePullRequest`) |

The gate is **grounded, not empowered**: Ticket 2 gives it reference *records*, never tools or
network. Its instruction is explicit — a claim unverifiable from diff + records is flagged
`unsupported`, never "corrected" from memory. (Root cause: the Balzac's false positive on #97,
where the ungrounded gate contradicted `businesses.json` and the fixer then corrupted a correct claim.)

---

## 5. Failure taxonomy

| # | Class | Concrete instance | Detection | Recovery | Bound | Terminal if unrecovered |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | Fabricated specific | "Hanna Ave meets Wellington St W" (#97); Labour Day "September 1" (#75); invented prices (#72) | claim linter pre-PR; grounded gate at review | draft discarded pre-PR; or repair **by deletion** | linter fail-closed; 3 repairs | `DISCARDED_PRE_PR` / `BLOCKED_EXHAUSTED` |
| F2 | Unrepairable file in the scored diff | `tasks/seo-data-latest.json` findings in 4/4 rounds on #97 | policy invariant: every scored text path is repairable | file removed from PR + `allowedPaths` | n/a (structural) | build-time test failure |
| F3 | Gate false positive from parametric memory | Balzac's address (#97 round 4) | reference records supplied with the diff | gate flags `unsupported` instead of asserting a correction | n/a | `BLOCKED_EXHAUSTED` |
| F4 | Non-convergent repair | 7.2→6.5 (#97), 5.0→4.5 (#75); fixer-introduced HIGH | `evaluateRepairProgress` over the ordered verdicts | abandon the repair loop early | 3 repairs; abandon on regression or new blocking finding | `BLOCKED_EXHAUSTED` |
| F5 | Structurally unrepairable verdict | duplicate slug; immutable-field error; finding on a non-repairable path | `classifyFindings` before dispatching the fixer | short-circuit; zero fixer spend | n/a | `BLOCKED_UNREPAIRABLE` |
| F6 | Silent validation rejection | validation throw at `coordinator.mjs:42` before `writeOutput` (stale SHA, staging race, duplicate promotion) | `validation-failed-*` job on `always()` | label + head status + deduped comment + Slack | 1 job per run | `BLOCKED_VALIDATION` |
| F7 | Transient infrastructure/model failure | GitHub 502/503/429; `agent failed closed: error_during_execution`; network timeout | `classifyRunFailure` | bounded redispatch with backoff | `MAX_TRANSIENT_RETRIES = 2` | `BLOCKED_*` (visible) |
| F8 | Base conflict with staging | both sides appended to `data/posts.json` (#75) | `generator-ci` merge-ref failure | append-union heal, then redispatch | `MAX_HEALS = 2` | `BLOCKED_EXHAUSTED` → regeneration |
| F9 | Exact-SHA race | PR head moved between dispatch and act | `validatePullRequest` / `assertSamePrIdentity` / `evaluateObservedMerge` | refuse and redispatch the new exact SHA | per run | `BLOCKED_VALIDATION` |
| F10 | Promotion dispatch loss | fire-and-forget dispatch dropped; 12-min observe timeout | promotion sweep cron | re-dispatch live staging head | 1 dispatch/tick | alert after 24h |
| F11 | Observe-timeout mislabel | a passing, auto-merge-armed PR relabelled `automation-blocked` | timeout made non-fatal | exit 0, hand off to the sweep | 12 min | none (sweep owns it) |
| F12 | Orphan PR | bot PR with no automation status/label, idle > 24h (the F6 fingerprint) | sentinel orphan pass | Slack escalation | daily | human |
| F13 | Destructive diff | PR #8 dropped 85 business records (pre-gate; hole still open in code) | `validateDestructiveDiff` at merge-time validation | hard fail; human `allow-record-deletion` label to override, logged loudly | n/a | `BLOCKED_VALIDATION` |
| F14 | Topic keeps failing | 3 bounded candidates all blocked | `nextCandidateAction` | abandon the topic, escalate once | `MAX_CANDIDATE_REGENERATIONS = 2` | `ABANDONED_TOPIC` (human) |

---

## 6. Bounded recovery policy

| Budget | Value | Scope | Exhaustion behaviour |
| --- | --- | --- | --- |
| `MAX_REPAIRS` | 3 | per candidate | `BLOCKED_EXHAUSTED` |
| fixer plan attempts | 4 | per repair round | repair round fails → block |
| `MAX_HEALS` | 2 | per candidate | fall through to block |
| `MAX_TRANSIENT_RETRIES` | 2 | per coordinator run | visible block |
| `MAX_CANDIDATE_REGENERATIONS` | 2 | per topic | `ABANDONED_TOPIC` |
| `REGENERATION_COOLDOWN_HOURS` | >= 24 | per candidate | — (this is what forbids a hot loop) |
| promotion sweep | 1 dispatch/tick, cron >= every 6h | repo | alert |

**Hard ceiling per topic:** 3 candidates × (1 gate + 3 repairs × 4 fixer plans) + 2 heals each,
with >= 24h between candidates, then a single human-visible abandonment. No path re-enters
generation without crossing the cooldown, and no path publishes below the gate.

**Regeneration is regeneration, not resubmission.** `nextCandidateAction(...).reuseDraft` must
never be `true`: the failed candidate's PR is closed and the next cycle generates a *fresh
grounded draft* through the linter. Re-pushing a rejected draft is an N4 violation.

---

## 7. SLOs

Carried from the audit; each is measurable from GitHub evidence alone.

| SLO | Target | Measurement | Baseline |
| --- | --- | --- | --- |
| Blog content acceptance | >= 1 blog PR auto-merged within 4 weekly cycles of tickets 1–2; thereafter >= 50% pass within the 3-repair budget | gate verdict audit comments per blog PR | 0/4 lifetime, all exhausted |
| Repair convergence | >= 80% of repair rounds Δscore >= 0; **zero** repairs introduce a new high/critical | ordered gate-verdict artifacts per PR | #97 7.2→6.5; #75 5.0→4.5; fixer-introduced HIGH |
| Terminal-state visibility | 100% of coordinator-dispatched PRs reach label + head status + deduped comment within 1h | sentinel orphan pass reports zero; eval §5 | silent-rejection hole confirmed in code |
| Promotion freshness | `main` never behind `staging` (`ahead_by > 0`) for > 24h | sweep tick compare | no sweep exists |
| Fixer budget discipline | zero fixer invocations on all-unrepairable verdicts; fixer p95 < 45 min | classifier logs + repair-plan artifacts | 3×4 attempts burned on foregone conclusions |
| Gate false-positive containment | zero gate findings that contradict a supplied `businesses.json` record | fixture reviews + audit-comment spot checks | 1 confirmed (Balzac's, #97) |
| Destructive-diff safety | 100% rejection of dropped-base-record diffs; 0 false rejections of append/modify | PR #8 vs #86/#92 replay in CI | hole unguarded |
| Human interventions | **0** per cycle after schedules are enabled | count of human comments/labels/closes on automation PRs | ~1 per blog cycle (manual close) |

---

## 8. Rollback and kill switch

Ordered from cheapest to heaviest. Every one is a single-file or single-line revert.

| Lever | Action | Effect | Trigger |
| --- | --- | --- | --- |
| **L1 Linter mode** | `LINT_MODE=warn` in `weekly-blog.yml` env | linter reports but stops discarding drafts | linter false-positive rate > 20% over 3 runs |
| **L2 Grounded-gate prompt** | revert the C6 prompt change only; keep the reference data (strictly additive context) | gate returns to prior behaviour | grounded gate disagrees with recorded history on > 1 of 5 frozen cases beyond ±1.5 drift |
| **L3 Classifier** | delete the short-circuit branch | falls back to always attempting repair | classifier short-circuits a verdict that was in fact repairable |
| **L4 Sweep** | comment out the `schedule:` line in `promotion-sweep.yml` | sweep stops; fire-and-forget path remains | sweep mis-dispatches twice |
| **L5 Regeneration** | set `MAX_CANDIDATE_REGENERATIONS = 0` | candidates block and wait for a human, as today | regeneration produces repeated near-identical failures |
| **L6 Cadence** | drop the Wednesday blog cron | halves blog volume | no blog merge after 4 cycles (audit's deferred pressure valve) |
| **L7 KILL SWITCH** | disable the `Weekly Blog Pipeline`, `Weekly SEO Improvements`, and `promotion-sweep` schedules (`gh workflow disable`) | no new candidates, no automated promotion; open PRs stay open, labelled, and inert; production is untouched | any loss of confidence |

`L7` is complete and reversible: nothing in the loop can merge without branch protection's
`automation/ci` + `automation/opus-gate`, so disabling the schedules stops the loop dead without
leaving a half-published state. **The destructive-diff guard has no rollback** — a false block is
working as designed; use the human `allow-record-deletion` label.

---

## 9. End-user-visible journey (summary; full contract in the journey doc)

The reader of `libertyvillage.co` sees exactly one thing: **new, factually grounded posts appear**
on the blog and topic pages, and nothing else about the site changes. There is no user-facing UI,
no new route, no new interaction. John's clicks and inputs after the schedules are enabled:
**none**. Everything else in this program is operator-visible evidence
(Actions runs, PR labels, head statuses, audit comments, Slack lines).

---

## 10. Implementation tickets — maximum 3 required + 1 optional

Consistent with the completed audit's ticket set. **No fourth required ticket may be added.**
Each new export below is locked by the eval; names are part of the contract.

### Ticket 1 (REQUIRED) — Content pre-gate: strip unrepairable files, ground the generator, fail-closed claim linter

Files: `.github/workflows/weekly-blog.yml`, `scripts/prompts/weekly-blog-system.md`,
`scripts/weekly-blog-agent.js`, `scripts/blog-lint.mjs` (new), `scripts/automation/constants.mjs`.

- **1a.** `weekly-blog.yml` stages **only** `data/posts.json` and `public/images/blog/`.
  Remove `tasks/seo-data-latest.json` and `tasks/auto-blog-runs/` from the `git add` **and** from
  `KIND_POLICIES.blog.allowedPaths`. Provenance goes to the GitHub step summary.
- **1b.** `weekly-blog-system.md`: targeted `jq`/node extraction instead of full ~1.67MB Reads;
  hard rule "every named-business fact must be copied verbatim from that business's
  `businesses.json` record; anything not in the record is omitted"; delete "prices" from the FAQ
  requirements and "numbers, addresses" from `keyTakeaways`; dedupe §2.4; reconcile Step 5 vs 6.1
  to abort-everywhere; delete the expired World Cup block and the single-period trending line.
- **1c.** New `scripts/blog-lint.mjs`, pure and deterministic, exporting:
  - `lintPost(post, { businesses, now }) -> { ok, findings: [{ rule, severity, claim, detail }] }`
    with rules `unrecorded-business`, `unsupported-address`, `unsupported-price`,
    `unsupported-hours`, `unsupported-date`. Bold (`**Name**`) business mentions must resolve to a
    `businesses.json` record (fail-closed by design); addresses, `$` amounts and hour ranges must
    appear verbatim in the referenced record; named statutory holidays must agree with the
    computed calendar date for the post's year (Labour Day = first Monday of September).
  - `resolveLintMode(env) -> 'fail' | 'warn'`, defaulting to `'fail'` for unset **and** invalid values.
  - `LINT_MODES`.
  Wired into `weekly-blog.yml` **before** the commit step, behind `LINT_MODE` (L1 rollback).
- **1d.** Policy invariant test: for every generator kind, every non-image `allowedPath` is covered
  by `repairablePaths`.

### Ticket 2 (REQUIRED) — Ground the gate, converge repairs, short-circuit foregone conclusions

Files: `scripts/automation/review-agent.mjs`, `scripts/automation/preflight.mjs`,
`scripts/automation/policy.mjs`, `scripts/automation/recovery.mjs` (new).

- **2a.** `review()` for `blog`/`news`: deterministically extract bold business names + related
  slugs, load those `businesses.json` records, append as `<<<UNTRUSTED_REFERENCE_DATA>>>`; add the
  lens line "verify named-business facts against the supplied records; if a claim is unverifiable
  from diff + records, flag it as unsupported — never assert a correction from memory."
- **2b.** `recordRepairPrompt()` carries the same reference records + linter output and instructs
  "resolve unsupported-specific findings by **removing** the specific, **never by substituting** a
  new one"; claim-deletion inside repairable text fields is permitted, record-deletion stays forbidden.
- **2c.** `preflight.mjs` exports `classifyFindings(kind, verdict, { changedFiles })
  -> { repairable, unrepairable, allUnrepairable }` against `RECORD_REPAIR_RULES` +
  `repairablePaths`; `preflightDecision(...)` returns the new value `'unrepairable'` when every
  blocking finding is structurally unrepairable, and the workflow treats it as block-without-fixer.
  Bias conservative: when in doubt, attempt the repair.
- **2d.** New `scripts/automation/recovery.mjs` exports
  `evaluateRepairProgress({ history }) -> { decision: 'continue' | 'abandon', reason, improving }`.
  `abandon` on a score regression or on any newly-introduced blocking finding; `continue` on a flat
  or improving round.
- **2e.** `evaluateVerdict`: `passed` becomes **optional and ignored** (strip, do not reject — 31
  frozen historical verdicts contain it); the decision derives solely from `overall` + findings.
  Interpolate `SCORE_THRESHOLD` into the review prompt instead of the literal `>= 8`.
- **2f.** Pin the generator review diff to `/compare/${merge_base}...${sha}` (the promotion path
  already does this).

### Ticket 3 (REQUIRED) — Mechanical terminal-state guarantees and self-recovery

Files: `.github/workflows/autonomous-coordinator.yml`, `.github/workflows/promotion-sweep.yml` (new),
`.github/workflows/blocked-sentinel.yml`, `scripts/automation/coordinator.mjs`,
`scripts/automation/policy.mjs`, `scripts/automation/constants.mjs`,
`scripts/automation/blocked-sentinel.mjs`, `scripts/automation/recovery.mjs`.

- **3a.** New jobs `validation-failed-generator` and `validation-failed-promotion`, each
  `if: ${{ always() && needs.validate-*.result != 'success' }}`, labelling `automation-blocked`,
  publishing a head status, and posting a deduplicated audit comment. Mutually exclusive with the
  `block-*` jobs (which stay gated on `trusted == 'true'`).
- **3b.** New `.github/workflows/promotion-sweep.yml` (`schedule:` at least every 6h +
  `workflow_dispatch`) driving `planPromotionSweep({ aheadBy, stagingHeadAt, openPromotionPrs,
  lastDispatchAt, stagingSha, now }) -> { action: 'dispatch' | 'skip', sha, reason }` from
  `recovery.mjs`. Dispatch only when `ahead_by > 0`, staging head older than 24h, no open promotion
  PR, and no dispatch already this tick. Writes what it did to the step summary each tick.
- **3c.** `observeAndPromote` timeout becomes non-fatal: `writeOutput` an observed-timeout handoff
  and exit 0, so a slow-but-merging PR is never relabelled blocked while auto-merge is armed.
- **3d.** `recovery.mjs` exports `classifyRunFailure(error) -> 'transient' | 'terminal'`,
  `nextRetry({ attempts, classification }) -> { action: 'retry' | 'block', delaySeconds }`, and
  `MAX_TRANSIENT_RETRIES` (<= 3). Transient = 5xx/429/network timeout/model `error_during_execution`.
  Terminal = every policy rejection. Exhaustion ends in a visible block.
- **3e.** `recovery.mjs` exports `nextCandidateAction({ attempts, maxRepairs, regenerations,
  healExhausted, blockedAt, now }) -> { action: 'repair' | 'wait' | 'close-and-regenerate' |
  'abandon-topic', closeCandidate, reuseDraft, reason }` plus `MAX_CANDIDATE_REGENERATIONS` and
  `REGENERATION_COOLDOWN_HOURS`. Never returns `publish`; never sets `lowerThreshold`.
- **3f.** `policy.mjs` exports `validateDestructiveDiff({ kind, files, sources, labels })` built on
  the existing `diffRecordsBySlug`, wired into `validatePullRequest` for all kinds; hard-fails on
  any dropped base record; human `allow-record-deletion` label
  (`constants.ALLOW_RECORD_DELETION_LABEL`) overrides and sets `overridden: true` so the audit
  comment can say so loudly.
- **3g.** Move `BLOCKED_LABEL` into `constants.mjs` (single binding site, imported by the sentinel
  and the coordinator). Add the sentinel orphan pass:
  `selectOrphanAutomationPrs(items, { now, staleHours })` selecting **bot-authored**, open PRs with
  no `automation/*` head status, no `automation-*` label, idle > 24h. Sentinel stays read-only.
- **3h.** `block-generator` re-reads the live attempt label rather than trusting a stale output.
  Do **not** reorder `set-attempt` relative to the push.

### Ticket 4 (OPTIONAL, LATER — only after 1–3 land and fixtures are frozen)

The audit's Tier 0–2 reliability backtest harness (`tests/reliability/`: gate backtest over the 31
frozen verdicts, repair-convergence report, destructive-diff mutation suite, terminal-state and
runtime baselines, wired into CI with a hard no-secrets assertion) plus the observability hygiene
batch (github retry/backoff, heal mergeability precheck, sentinel heartbeat, 500KB overflow
fallback, scoreboard `blocking_issues`, `FORCE_EDIT` threshold).

**Time-sensitive and additive, do first regardless of ticket order:** freeze the golden-10
fixtures under `tests/reliability/fixtures/` before the earliest artifact expiry
**2026-09-09**. Freeze the first merged blog PR as `F11` the moment it exists — blog has no
positive exemplar, so false-block rate cannot be backtested until one does.

---

## 11. RED baseline evidence (clean `origin/main` @ `d042881`)

Command (run from the repository root; offline, no secrets, zero model spend):

```
node --test tests/automation/full-autonomous-loop.eval.mjs
```

Observed 2026-08-21 on worktree `/tmp/lv-autonomy-eval` @ `d042881`:

```
ℹ tests 37
ℹ suites 0
ℹ pass 10
ℹ fail 24
ℹ cancelled 0
ℹ skipped 3
```

- **10 pass** — the `[GREEN]` regression guards over §2's already-working mechanisms. If any of
  these ever fails, the implementation broke something that was working.
- **3 skipped** — the `[CANARY]` block, opt-in via `LV_LIVE_CANARY=1`.
- **24 fail** — the expected RED baseline. Every one must be green at acceptance:

| # | RED test | Ticket |
| --- | --- | --- |
| 1 | verdict schema tolerates historical `passed` but always derives the decision itself | 2e |
| 2 | the blog claim linter rejects every frozen fabrication class and accepts a grounded draft | 1c |
| 3 | the linter defaults to fail-closed and runs before the blog PR is committed | 1c |
| 4 | no generator can ship a scored file its fixer is structurally unable to repair | 1a/1d |
| 5 | the blog PR carries content only — no provenance files in the scored diff | 1a |
| 6 | the fixer is instructed to resolve unsupported specifics by deletion, never substitution | 2b |
| 7 | a non-improving or self-harming repair round abandons the candidate instead of burning budget | 2d |
| 8 | a validation throw still produces exactly one visible terminal outcome (generator) | 3a |
| 9 | a validation throw still produces exactly one visible terminal outcome (promotion) | 3a |
| 10 | the validation-failed jobs are mutually exclusive with the block jobs and are deduplicated | 3a |
| 11 | transient infrastructure failures are classified and retried within a hard bound | 3d |
| 12 | an exhausted candidate is closed and regenerated on a later bounded retry — never hot-looped | 3e |
| 13 | a verdict whose blocking findings are all unrepairable short-circuits without spending the fixer | 2c |
| 14 | an unhealable conflict hands the candidate to the regeneration policy, not to a human queue | 3e |
| 15 | the generator review diff is pinned to `merge_base...head` like the promotion review already is | 2f |
| 16 | a lost promotion dispatch is swept up automatically, at most once per tick | 3b |
| 17 | the promotion sweep is a real scheduled workflow, not a hand-run script | 3b |
| 18 | the observe-and-promote timeout is non-fatal and never relabels a merging PR as blocked | 3c |
| 19 | the sentinel detects automation PRs that never reached a terminal state | 3g |
| 20 | the sentinel workflow actually runs the orphan pass and stays read-only | 3g |
| 21 | the blocked label has exactly one binding site | 3g |
| 22 | a diff that drops slug-keyed records is rejected before merge, with a human escape hatch | 3f |
| 23 | the merge-time guard is wired into pull-request validation for every kind | 3f |
| 24 | the promotion outcome writes durable evidence a human can read after the fact | 3b |

Acceptance = **34 pass, 0 fail, 3 skipped** offline, plus the live evidence in the journey doc.

---

## 12. Ambiguities requiring parent judgment

1. **Transient retry (F7 / ticket 3d) is a deliberate delta from the audit.** The audit *deferred*
   auto-retry on `DECISION=error` (its M8) with the trigger "only if the error count stays > 1/month
   after tickets 1–2". The parent objective, however, demands that *every recoverable failure
   self-recovers without John*, and a transient 502 today produces a terminal blocked state a human
   must clear. This spec therefore promotes a **minimal** form of M8 into ticket 3 (classification +
   one bounded redispatch with backoff, cap 2) rather than adding a fourth ticket. If the parent
   prefers strict audit fidelity, drop RED test 11 and rely on the next scheduled cycle plus the
   sweep as the recovery path — at the cost of one lost cycle per transient failure.
2. **PR #32 is human-authored, not a bot orphan.** The audit states the orphan sentinel pass "would
   have caught PR #32". Live check: PR #32 (`seo/parking-meta-homepage-worldcup`, base `main`) is
   authored by `jonkthomas` with `Vercel`/`CodeRabbit` statuses and no automation label. This spec
   scopes the orphan pass to **bot-authored** PRs (eval §12 asserts #32 is *excluded*), because a
   sentinel that flags human PRs will produce standing noise. If the parent wants stale human PRs
   swept too, that is a separate, wider tripwire and needs its own decision.
3. **Regeneration cadence vs. the Wednesday cron.** `REGENERATION_COOLDOWN_HOURS = 24` combined
   with the existing Sunday + Wednesday blog crons means a failed Sunday candidate can regenerate on
   Wednesday. If the audit's deferred cadence reduction (drop Wednesday) is exercised as rollback
   L6, regeneration effectively becomes weekly. Both are safe; the parent should confirm which
   cadence is intended once the first blog PR merges.
4. **Where regeneration state lives is left to the builder.** `nextCandidateAction` is pure and
   takes `regenerations` and `blockedAt` as inputs. Persisting them (PR labels such as
   `automation-regen-N`, or a small state file) is an implementation choice this spec does not
   constrain — but whatever is chosen must survive a rerun without buying extra budget, exactly as
   the existing single-controlled-label lifecycle does.
5. **The blog SLO remains an estimate until F11 exists.** Blog is 0/4 lifetime, so the eval can
   prove rejection correctness but not false-block rate. The first merged blog PR must be frozen as
   fixture F11 immediately; until then "blog acceptance >= 50%" is a target, not a measurement.
