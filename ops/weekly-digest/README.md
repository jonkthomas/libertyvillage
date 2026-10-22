# LV weekly digest + fix-it agent

Two pieces, one contract: every Monday the loops get audited, and the audit
feeds an agent that proposes fixes.

## 1. Weekly digest (Mac, `com.jonkthomas.lv-weekly-digest`)

Every **Monday 08:00 America/Toronto** (launchd, this Mac — the one hosting the
spec-deck tailnet server at `127.0.0.1:8787` behind
`tailscale serve --set-path /decks 8787`):

1. Fetch, tolerantly (any failure degrades to a note on the page):
   - runner JSONL from `lv-content-runner` (`/var/log/lv-runner/*.jsonl`, via
     exe.dev API → ssh; logs older than the window are skipped by mtime),
   - the live `libertyvillage.co/sitemap.xml` (+ `<title>` for new URLs) for
     "what was posted",
   - timer queue + hold state from the VM,
   - Google Search Console: **treg** first (`google-search-console.*`,
     `TREG_TOKEN`); on failure a **read-only searchanalytics query run on the VM
     as root** using the runner env's `GOOGLE_SERVICE_ACCOUNT_JSON` (materialized
     to a tmpfs key file, deleted on exit; the credential never leaves the VM
     and only aggregate stats come back).
2. Build a dense single-page HTML audit + machine JSON (`ops/weekly-digest/lib/`).
3. Publish to `~/.pi/agent/spec-decks/lv-digest/lv-digest-YYYY-MM-DD.html`
   → `https://ofia.tail97aece.ts.net/decks/lv-digest/…`.
4. Post the link + 3-line summary to Slack `C0B6HEAHZT4` (`hermes send -t slack:C0B6HEAHZT4`).
5. Push only an allowlisted, redacted projection to the VM:
   `/var/lib/lv-digest/lv-digest-latest.json`. It contains failure/refusal job,
   timestamp, code and short reason, queue state, public posted titles/URLs,
   and GSC `ok`/`unavailable`. No queries, analytics pages, raw runs, notes,
   VM diagnostics, private links or GSC error details go to the model.

Install/update: `bash ops/weekly-digest/install-mac.sh` (from the repo copy on
any branch — it installs a launchd-readable copy under
`~/.local/share/lv-weekly-digest/` and syncs `EXEDEV_API_KEY`/`TREG_TOKEN`
from the pi tool vault into `digest.env`, 0600; launchd cannot read
`~/Desktop`). Manual run: `node ops/weekly-digest/run-digest.mjs [--dry-run]
[--no-slack] [--no-push]`. Log: `~/Library/Logs/lv-weekly-digest.log`.

## 2. Fix-it agent (VM, `lv-digest-agent.timer`)

Every **Monday 09:00 America/Toronto**, `lv-digest-agent.service` runs the
proposal model as **`lv-digest`**. It projects the input again before building
the prompt and starts `pi -p` with a positive environment allowlist. Neither
the model nor its parent unit loads GitHub credentials. The user has no sudo,
cannot read the runner env files, publisher home or publisher credential,
and cannot authenticate a protected-branch write or merge.

The model writes `/var/lib/lv-digest/outbox/proposals.json`:

```json
{"version":1,"actions":[
  {"type":"issue","title":"[digest] A failure","body":"P1: public-safe evidence"},
  {"type":"issue","title":"Fix the failure","body":"P1: reason and checks","patch":"diff --git ..."}
]}
```

After the model unit exits successfully and its descendants are stopped,
systemd starts **`lv-digest-publisher.service` as `lv-digest-publisher`**.
Only this deterministic publisher receives the PAT through `LoadCredential`.
It snapshots and validates the entire outbox before any write, rejects unknown
operations/fields, caps issues at 3, redacts every public title/body again,
and creates **labeled issues only**. An issue's optional `patch` is attached
to its body as fenced `diff` text for a human to review and apply. Patch text
is capped at **30 KiB of UTF-8**, with a note when truncated; incomplete diffs
must not be applied. The entire patch is checked before truncation, and
secret-shaped or binary patches are refused instead of rewritten. The publisher
never clones, applies, commits, pushes a branch, or creates a PR. This prevents
model-proposed code from reaching credentialed Actions or Vercel previews before
human review. Legacy PR proposals and all push/merge actions are refused before
any operation; the model must regenerate them as issues with optional patches.

The separate unit/user is necessary: removing a token from the child's env
alone leaves it accessible through a same-uid parent's `/proc` or auth files.
The two units conflict, and only the publisher's private credential directory
ever contains the runtime PAT. With no installed PAT, publication is skipped;
proposal generation still runs locally.

Install/update on the VM, when explicitly authorized: run
`bash ops/weekly-digest/install-vm-agent.sh` as root. It stops the old agent,
removes its old auth/cache/scratch clone/logs and full digest, installs both
units, and verifies that `lv-digest` cannot read runner or publisher secrets.
Reinstall the Mac digest too (`bash ops/weekly-digest/install-mac.sh`) and send
a fresh sanitized digest before the next agent run. Do not restore the old
full digest into the model user's home.

**Token installation changed:** revoke the old agent PAT. Create a new
fine-grained PAT for **jonkthomas/libertyvillage only**, with **Issues Read+Write
only**. Read-only Metadata is implicit; grant no Contents or Pull requests
permissions, other permissions, or access to other repositories. Revoke any old
publisher PAT that granted Contents or Pull requests access too.
As root, store the **raw token text**, without `GH_TOKEN=` or quotes, in
`/etc/lv-digest-publisher.token`, owned by `root:root`, mode **0600**. Enter it
through a private interactive input or root-only file, never a command-line
argument, shell history, `gh auth login`, or any model environment/config.
Remove `/etc/lv-digest-agent.env` after migration. The publisher is the only
holder; do not add an `EnvironmentFile` to the model unit. Rerunning the
installer checks file isolation but cannot verify PAT scope; check the scope
in GitHub before installing it.

Dry-run the prompt (no model or GitHub calls):
`sudo -u lv-digest node /opt/lv-digest-agent/agent/agent.mjs --dry-run`.
Validate an outbox locally without a token or GitHub calls:
`node ops/weekly-digest/agent/publisher.mjs --outbox /path/to/proposals.json`.
Logs: private `/var/lib/lv-digest/agent.log` and
`journalctl -u lv-digest-agent -u lv-digest-publisher`.
Publication is not retried automatically. If a run partly succeeds, inspect
created artifacts before manually retrying; cross-run deduplication is deferred.

## Tests

`LC_ALL=C LANG=C ~/.pi/agent/bin/memguard -- npm run test:digest`
(also part of the project `verify`): digest fixtures plus private-input
exclusion, actual child env capture, rejected publisher operations, final
publication redaction, workflow patches published only as issue text, patch
truncation and refusal, and CLI refusal of unsupported actions.
`bash -n ops/weekly-digest/install-vm-agent.sh ops/weekly-digest/install-mac.sh`
checks shell syntax. These local checks do not execute the Linux systemd
units or install anything on the VM.
