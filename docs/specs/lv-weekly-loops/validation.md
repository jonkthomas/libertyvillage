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

VM diagnosis used only read-only filesystem/journal checks and explicit
`BEGIN READ ONLY` database transactions. No `/etc` changes, unit starts/stops,
production-target runs, deploys, production writes, merges, or hold removal.
The legacy supervisor remained untouched.

**Parent decision: no VM staging UAT before merge.** Local real-CLI/DB journeys
are the authorized pre-merge evidence. All five new-code VM journeys remain
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

- `npm run test:content`: 206 passed with the local PostgreSQL URL above.
- `node --test tests/runner/*.test.mjs`: 148 passed, including the real-DB
  backfill case and both focused review regressions. No DB tests skipped.
- Independent reviewer ran focused acceptance plus news publisher tests: 36
  passed, including the real-CLI backfill case and both P1 rechecks.
- `npm run test:automation`: 178 passed, including the explicit schema/date
  regression.
- `npm run test:news-pilot`: 273 passed. `npm run test:supervisor`: 88 passed.
- `npm run lint`: fails with 81 existing errors and 28 warnings across the repo;
  changed production files have zero lint errors. These existing errors are
  outside this fix's scope; explicit changed-file ESLint is reported separately (`lint:changed` sees only
  committed differences).
- Verify screenshots are under `$TMPDIR/pi-verify/gh-jonkthomas-libertyvillage/`
  (desktop 1440x900 and mobile 390x844); all twelve routes passed. The verify
  script now also runs the focused loop regressions (kept in the harness project
  store, not this product repository).

The independent Astra review found and verified fixes for two P1s: historical
backfill slots must accept later distinct topics after three rejections, and
early draft schema rejection must retain its actionable explanation. Recheck
at `bef819411556e686552e283c67bf5042d285a5ba`: 36 passed, zero failed/skipped.
Final runbook changes implement the parent's staged-activation decision. The
parent owns the additional non-GPT reviews, doomsday verification/John triage,
and gate completion against the final candidate; no PR opens until it passes.
