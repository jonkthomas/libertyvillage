# Content loops: reviewed activation and October backfill

Status: activation is **John's protected action**, after this fix PR merges into
`staging` and the release PR from `staging` to `main` merges. In the protected
window, staging acceptance must pass before production timers start. The builder
has not executed these commands and leaves the hold untouched. Only John's go
authorizes Stage 1. Do not activate an unreviewed branch, run both writers, or
start SEO (#182).

## What diagnosis established (2026-10-22, read-only)

- `/etc/lv-runner.hold` exists. All five non-SEO timers are inactive. A global hold
  blocks staging too, in both launcher paths and the Node worker.
- Blog `weekly-blog-production-202609301100-scheduled.jsonl` pinned `991dcfed`,
  accepted six generated paths, then failed `cli-validation`, exit 2. No CLI
  message was retained; the draft/scratch was subsequently cleaned. The specific
  September validation error is **unrecoverable**, so do not claim an exact
  historical root cause. The reproduced code defect is that source-pack checks
  accepted storage-invalid drafts (e.g. `relatedBusinesses`), which submit then
  refused. Storage validation now runs before handoff; the prompt requires the
  same validator and real dates. Submit/gate explanations now survive in private
  JSONL as additive `message`/`decision` fields, with secrets/URLs redacted.
- Topic submission #2: `blocked`, `unrepairable`, score 6, one high finding: raw
  navigational GSC query with duplicated Toronto. GSC queries now map only to
  supported editorial category themes; brand/navigation lookups stay out.
- Business submission #3: `blocked` after three repairs, score 5.5. A private
  Raptors practice facility was labelled a public gym with invented default
  `$$` pricing; M6K admitted Exhibition grounds as Liberty Village. Discovery
  now accepts reviewed core addresses or an address missing only from that table
  with an M6K postal code, excludes private/team facilities,
  and leaves unknown prices empty. The gate remains unchanged in strictness.
- News September 29 and 30: 25 evaluated each, seven reached evidence. Four
  failed extraction (403 responses included); three had only a single
  substantive lead publisher for consequential claims. Other candidates were
  risk/duplicate/stale/low-score refusals. We retain these rules. A bounded
  corroboration lookup (at most four searches/run, three matching dated leads
  per lookup) now fetches additional articles and repeats the existing evidence
  and publish gates. Search snippets cannot count as evidence. Zero publish is
  still valid when sources cannot support an accurate local story; JSONL now
  records refusal counts by code. No October news backfill.
- Growth `weekly-growth-report-production-20260928222228-2346ecce.jsonl` succeeded
  at 22:22:47Z; `weekly-growth.json` and `.md` exist with GSC and PostHog both `ok`.
  This is an artifact/report loop, not a content submission. New JSONL explicitly
  records artifact names and source statuses.
- Production migrations 0001–0005 already exist. The production env file is
  already installed with `CONTENT_DB_NAME=neondb` and production enabled. This
  does not authorize a production run.

## Before the protected go

From the reviewed release checkout, record the exact release SHA. John installs
that release's **matching** runner, launcher and helper on `lv-content-runner`:

```sh
git fetch origin main staging
git checkout --detach origin/main
git rev-parse HEAD
sudo bash ops/exedev-runner/install.sh
```

The installer changes `/etc` units and disables SEO, so the builder did not run
it. It installs the optional backfill timer but does not enable timers. Retain
the previous installed runner/launcher/helper and units for rollback. Confirm the
new code is on both main and staging and the installed worker matches the release:

```sh
sha256sum ops/exedev-runner/runner.mjs /usr/local/libexec/lv-runner-runner.mjs
sudo test -e /etc/lv-runner.hold
sudo systemctl is-active 'lv-runner@*'
sudo systemctl is-active lv-runner-seo-improvements.timer
```

On `lv-supervisor-staging`, use read-only `systemctl is-active` for
`lv-supervisor.timer`, `lv-supervisor-sentinel.timer`, and `lv-supervisor.service`.
They must be inactive; if not, stop and obtain separate authority to stop them.
Do not start either old writer. Confirm GHA content writer schedules remain off.

**Exact env change**, using `sudoedit` on the VM (never print the files):

```sh
sudoedit /etc/lv-runner-production.env
sudoedit /etc/lv-runner-staging.env
```

Set exactly one line `CADENCE_START_ISO_WEEK=2026-09-28` in **each target file**.
Keep it out of `/etc/lv-runner.env`. Keep mode 0600/root ownership. This fixed UTC
Monday lets an active prior week alert even with zero slots; earlier weeks are
ignored. Existing bounded catch-up checks up to four older row-bearing weeks.
Do not change production DB/site bindings or staging bypass. Do not add secrets
to the shared file or copy production credentials into staging.

## Stage 1 — John's go to lift the hold

Production timers and backfill must still be inactive. After John's explicit go
for the hold-removal and staging-run window, on `lv-content-runner`:

```sh
sudo test -e /etc/lv-runner.hold
sudo systemctl list-timers --all 'lv-runner-*'
sudo systemctl is-active 'lv-runner@*'
sudo rm -- /etc/lv-runner.hold
```

**Stop here** if any writer or production timer is unexpectedly active, bindings
are uncertain, or the installed SHA differs from the approved release. Keep the
hold in that case. If a problem appears after removal, immediately restore it;
leave production timers/backfill inactive:

```sh
sudo install -o root -g root -m 0600 /dev/null /etc/lv-runner.hold
```

## Stage 2 — exactly one staging run of each loop

With the hold lifted by John, run each command **once**, sequentially. Wait for
its service to terminate and inspect its private JSONL before proceeding to the
next command. Do not run this whole block unattended or retry a failed loop
under a fresh slot. These commands use the runner global lock:

```sh
sudo lv-runner run topic-discovery --target staging
# Check that slot's JSONL before the next command.
sudo lv-runner run discover-businesses --target staging
# Check that slot's JSONL before the next command.
sudo lv-runner run news --target staging
# Check that slot's JSONL before the next command.
sudo lv-runner run weekly-growth-report --target staging
# Check that slot's JSONL/report before the next command.
sudo lv-runner run weekly-blog --target staging
# Check that slot's JSONL before the next command.
sudo lv-runner run october-blog-backfill --target staging
```

For every content submission require its ID, passing real-model gate (score >=8,
zero blocking findings), publication and smoke, plus the route on the staging
alias. `code-pinned` must name the approved staging SHA. A legitimate empty
news/discovery run must carry explained refusal counts; it does **not** prove
publication. Record that distinction for John rather than weakening the gate.
Growth requires new `.json`/`.md` artifacts and both source statuses, not a
submission ID. If weekly blog reports an already-met quota, record the existing
live IDs and smoke evidence rather than inventing a new post.
Backfill requires one real-date post under its historical slot, passing gate and
smoke on the staging alias; it must not count toward the live weekly-blog quota.

**Stop before production** on a failed gate, missing smoke, incorrect target/SHA,
unexplained no-change, unusable report or any uncertain result. Restore the hold
with the Stage 1 command, inspect the exact failed run, and return evidence to
John. Do not rerun loops or start production timers to find out what happens.
The hold blocks new runs but does not cancel one already in flight; wait for it
to terminate, or obtain separate authority for its exact service stop. Keep the
old supervisor idle. The builder's local real-CLI tests are the pre-merge
evidence; VM staging acceptance happens only in this protected window.

## Stage 3 — start production timers and the optional backfill

Only after all six Stage 2 outcomes are checked and John accepts any explicitly
recorded publication-proof limitation, proceed under his production activation
go. Start the five already-enabled non-SEO timers:

```sh
sudo systemctl start lv-runner-topic-discovery.timer lv-runner-discover-businesses.timer lv-runner-news.timer lv-runner-weekly-growth-report.timer lv-runner-weekly-blog.timer
sudo systemctl list-timers --all 'lv-runner-*'
```

`Persistent=true` can immediately catch up overdue fires. The global flock
serializes writers; exit 75 means overlap was skipped, not published. Inspect
first catch-up services and wait until they terminate before the backfill start.
Check that all five timers have a next elapse and the expected enabled state;
`start` does not make a disabled timer survive reboot. SEO must remain inactive
and disabled. Never start the old supervisor.

After the separate backfill-start go, enable and start its opt-in daily timer:

```sh
sudo systemctl enable --now lv-runner-october-blog-backfill.timer
sudo systemctl list-timers --all 'lv-runner-*'
```

**Stop/rollback at this stage** if a timer has no next elapse, a first fire fails,
a binding/SHA is wrong or live smoke fails: restore the hold, then use the six
explicit timer-stop commands in the rollback section below. Inspect any service
already running before restoring code. Do not leave the remaining timers running
while investigating a publication error.

It runs at 15:37 UTC, reserves ordinary content cadence slots 101–107 under the
historical label's ISO week, and passes through the same trusted pack, submit,
gate, deploy and smoke. Labels are the requested **Oct 1, 5, 8, 12, 15, 19, 22**;
they are identifiers, not a derivation of the 2026 Wed/Sun calendar. At most one
post per UTC date; retries preserve their original open submission/key. Each
invocation has a bounded generation budget. The ledger persists the three normal
attempts per slot, two reserves per week, and used reserve categories across daily
runs. Reserves also spend the real attempt week's allowance across historical
labels. Exhaustion fails visibly and needs operator review; a new day cannot reset
the cap. Posts use the
actual date they are generated/published, never the historical label. A late
smoke closes as `late-smoked`; the current-live post counts only toward its own
historical attempt week. It cannot satisfy the live weekly-blog quota or suppress
that week's missed-cadence alert. Existing missed-alert records remain historical
evidence. A lack of grounded inventory or a rejected draft fails visibly; retries
on a later day preserve the same caps and original open key.

For an immediate first attempt, **only with an explicit production-run go**:

```sh
sudo lv-runner run october-blog-backfill --target production --production-approved
```

Do not run that command in parallel with an active scheduled writer. After seven
successful labels, future backfill invocations are no-ops with
`october-backfill-complete`; John can then disable its timer:

```sh
sudo systemctl disable --now lv-runner-october-blog-backfill.timer
```

## Verify first fires

```sh
sudo systemctl list-timers --all 'lv-runner-*'
sudo journalctl -u 'lv-runner@*' --since '1 hour ago' --no-pager
sudo ls -lt /var/log/lv-runner
sudo lv-runner report weekly-growth-report --latest
```

Inspect only the selected root-only JSONL (never dump prompts, scratch, or env):
`code-pinned`, `submission`, `gate` exit 0, and `success`; `news-decision` explains
no-publish counts; `growth-report` names both artifacts and source statuses;
`october-backfill-published` identifies the historical label, trusted submission
ID and real date. A `success` with `noChanges:true` is not publication proof.
Use the correctly bound content CLI's read-only `show --submission ID --target
production` to check `state=published`, `smoke_passed_at`, the final gate score
>=8 and zero blocking findings. Verify the published route at
`https://libertyvillage.co/blog/SLUG` with the actual publish date and content.
On a private failure log, `message`/`decision` is the bounded reason to fix.
Verify the next weekly blog run creates prior-week deadline intents and delivers
them; webhook failures remain durable and retriable.

## Rollback (John only)

First restore the write stop, then stop the six possible non-SEO timers:

```sh
sudo install -o root -g root -m 0600 /dev/null /etc/lv-runner.hold
sudo systemctl stop lv-runner-topic-discovery.timer lv-runner-discover-businesses.timer lv-runner-news.timer lv-runner-weekly-growth-report.timer lv-runner-weekly-blog.timer lv-runner-october-blog-backfill.timer
sudo systemctl disable lv-runner-october-blog-backfill.timer
sudo systemctl list-timers --all 'lv-runner-*'
sudo systemctl is-active 'lv-runner@*'
```

The hold blocks new runs; it does not cancel an already running process. Wait for
an in-flight run, or get explicit authority for its exact service stop, before
restoring the saved matching runner/launcher/helper/units and daemon-reloading.
Do not delete cadence rows, reset submissions, backdate records, or resume the
old supervisor. Published content rollback is a separate reviewed content action;
stopping timers does not unpublish an existing post.
