# Local validation and outstanding live acceptance

The builder ran the local project verify first. Its routes and typecheck passed;
Playwright needed the installed Chrome path. The final verify command is:

```sh
PI_CHROMIUM_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' LC_ALL=C LANG=C ~/.pi/agent/bin/memguard -- ~/Desktop/important-coding-projects/claude-config/projects/pi/gh-jonkthomas-libertyvillage/verify
```

Local content and real-CLI cadence tests use a dedicated disposable PostgreSQL
17 container at `127.0.0.1:55432` (no hosted credentials, no other project stack).
The focused regression command is:

```sh
CONTENT_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55432/postgres LC_ALL=C LANG=C ~/.pi/agent/bin/memguard -- node --test tests/runner/loops-unblock.test.mjs tests/runner/cadence-runner-db.test.mjs
```

The fake-cadence tests drive seven separate real-date ticks, waiting/restart,
original idempotency keys, redacted validation messages, discovery incident
inputs, and bounded corroboration without source-tier inflation. The DB tests
run the actual content CLI, durable ledger, submit, scripted gate, local deploy
hook, smoke and alias observation. Model generation/review are fixtures in these
local tests; this is **not real-model staging acceptance**.

The review-revision regressions reproduce the failures at `bd4ca13`: 12/12
targeted tests failed there, plus the real-Postgres D1 case observed two backfill
posts wrongly counted in the live week. Current tests require date-agnostic
submit/gate binding, the approved M6K fallback, persistent attempt/reserve caps,
independent extracted reporting, and recovery isolated from backfill. The DB
journey checks the live-week count is zero and historical count is one after a
real-CLI backfill publication and smoke.

VM diagnosis used only read-only filesystem/journal checks and explicit
`BEGIN READ ONLY` database transactions. No `/etc` changes, unit starts/stops,
production-target runs, deploys, production writes, merges, or hold removal.
The legacy supervisor remained untouched.

**Parent decision: no VM staging UAT before merge.** Local real-CLI/DB journeys
are the authorized pre-merge evidence. All six new-code VM journeys remain
UNVERIFIED; no hold bypass or unit start is required or allowed for this handoff.
After John's go, the runbook requires hold removal, each loop once with
`--target staging` plus checked results, then the five production timers and
backfill. Each stage has a stop/rollback path. News/discovery can legitimately
publish nothing; record that limit rather than weaken rules. Growth report
success is an artifact outcome, not a submission.

The exact September 30 blog CLI validation message is unavailable because the
old JSONL dropped it and its scratch draft was cleaned. New schema checking
closes a reproduced validation gap; it does not prove that gap was the only
cause of that historical failure.

Later (P2): automatic retirement of the exhausted optional backfill timer;
operator can disable it once it logs completion. Subsequent fires are no-ops.

Builder observations:

- `npm run test:content`: 208 passed with the local PostgreSQL URL above. The
  earlier 206-pass claim was stale: Fable reproduced 205 passed / 1 failed at
  `bd4ca13`; explicit generation-only date enforcement fixes that R4 failure.
- `node --test --test-concurrency=1 tests/runner/*.test.mjs`: 157 passed, zero
  skipped, including real submit, scripted gate, deploy hook and hosted-alias
  smoke against the disposable PostgreSQL stack.
- `npm run test:automation`: 178 passed, including the explicit schema/date
  regression.
- `npm run test:news-pilot`: 276 passed. The prior candidate's unchanged
  supervisor suite passed 88 tests.
- Explicit ESLint over all 19 changed JS/MJS files: zero errors, one existing
  unused-import warning in `publish.mjs`.
- `npm run lint`: fails with 81 existing errors and 28 warnings across the repo;
  changed production files have zero lint errors. These existing errors are
  outside this fix's scope; explicit changed-file ESLint is reported separately (`lint:changed` sees only
  committed differences).
- Verify screenshots are under `$TMPDIR/pi-verify/gh-jonkthomas-libertyvillage/`
  (desktop 1440x900 and mobile 390x844); all twelve routes passed. The verify
  script now also runs the focused loop regressions (kept in the harness project
  store, not this product repository).

The parent-directed D4 fix supersedes the earlier Astra recommendation to allow
fresh topics after three terminal rejections: the persisted three-attempt cap
now wins. Early draft schema rejection still retains its actionable explanation.
F1/F3 date enforcement is explicit only at generation/pre-submit; later binding
rounds keep the original real dates. F7 is covered by D1: backfill cannot meet the
live weekly goal or suppress that week's alert. D5/F9 isolates live recovery.
The parent owns non-GPT re-review, doomsday proof and gate completion against the
new candidate; no PR opens until it passes. D6 (reboot during staging with enabled
persistent production timers) and F8 (broad athletic-centre exclusion) remain
Later, as directed.
