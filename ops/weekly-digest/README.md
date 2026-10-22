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
5. Push the JSON to the VM: `/var/lib/lv-digest/lv-digest-latest.json`.

Install/update: `bash ops/weekly-digest/install-mac.sh` (from the repo copy on
any branch — it installs a launchd-readable copy under
`~/.local/share/lv-weekly-digest/` and syncs `EXEDEV_API_KEY`/`TREG_TOKEN`
from the pi tool vault into `digest.env`, 0600; launchd cannot read
`~/Desktop`). Manual run: `node ops/weekly-digest/run-digest.mjs [--dry-run]
[--no-slack] [--no-push]`. Log: `~/Library/Logs/lv-weekly-digest.log`.

## 2. Fix-it agent (VM, `lv-digest-agent.timer`)

Every **Monday 09:00 America/Toronto** (systemd 255 tz-aware calendar), after
the digest pushes the JSON, `/opt/lv-digest-agent/agent.mjs` runs as the
**non-root `lv-digest` user** — which cannot read `/etc/lv-runner*.env`
(root:root 0600) and has no sudo. It feeds the digest JSON to a headless
`pi -p` run that may ONLY:

- file GitHub issues on `jonkthomas/libertyvillage` labeled `lv-digest-agent`
  (deduped against already-open labeled issues; ≤3 per run),
- open **DRAFT** PRs, base `staging`, only for P0/P1 findings with a small
  clear fix (≤3 per run).

It never merges, deploys, pushes protected branches, re-runs loops or touches
production data/credentials. Until `/etc/lv-digest-agent.env` (root:0600) sets
`GH_TOKEN` to a fine-grained token scoped to **jonkthomas/libertyvillage only**
(Contents: Read+Write, Issues: Read+Write, Pull requests: Read+Write — nothing
else), the agent runs in dry-run mode and only prints what it would file.

Install/update on the VM: `bash ops/weekly-digest/install-vm-agent.sh` (as root
on the VM; touches only lv-digest assets). Dry run:
`sudo -u lv-digest node /opt/lv-digest-agent/agent.mjs --dry-run`.
Logs: `/var/lib/lv-digest/agent-logs/` + `journalctl -u lv-digest-agent`.

## Tests

`npm run test:digest` (also part of the project `verify`): fixture JSONL with
failures, malformed lines, unknown sibling-added fields, window filtering, and
an HTML-render assertion that failures stay visible.
