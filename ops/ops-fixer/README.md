# Ops fixer (lv-content-runner)

Autonomous, bounded fixes for known content/ops failures (John's decision 1a).
Code bugs and unknown failures still go to the fix-it agent (`ops/weekly-digest/agent`),
which files GitHub issues from the Monday digest. The fixer never edits code, publishes
code changes, touches the hold switch or writes the content DB itself.

## What it does

Every pass (`lv-ops-fixer.timer`, every 3 hours at :50 UTC once enabled) reads the
runner logs in `/var/log/lv-runner`, takes the **latest** production run of each job
and, if it failed in the last 48 hours, looks its code up in the allowlist
(`policy.mjs`, `ALLOWLIST`):

| Codes | Action | What starts | Budget (per code) |
|---|---|---|---|
| cli-network, cli-server, cli-timeout, cli-conflict, timeout | `rerun-job` | `lv-runner@<job>:production:scheduled` (what its timer starts) | 1/day, 3/week |
| no healthy news source, roundup model technical failure, writer safety rule, prior content unresolved | `rerun-job` | same | 1/day, 2/week |
| no terminal event (stale run) | `rerun-job` | same | 1/day, 1/week |
| bad/duplicate topic: business-outside-pack, draft-changed-topic, blog-lint, unsupported-grounding, blog generated no post, gate blocked or rejected, not-converging, unrepairable, exhausted, block, (cli-)validation | `next-topic` (weekly blog only) | `lv-runner@weekly-blog:production:scheduled`; this week's tried topics are excluded by the DB cadence attempts | 1/day, 2/week |
| hook-failed, smoke-timeout, publish or propagation pending | `retry-deploy` | `lv-runner@deploy-retry:production:scheduled` (`content deploy --target production`) | 2/day, 4/week |

Anything else: code bugs (`operational-error`, `cli-operation`, `cli-target`,
`cli-permission`, `invalid-json`, `safety stop`, `state-error`) and unknown codes are
logged as `escalated` and left for the fix-it agent; "needs you" and benign codes are
ignored (they already reach Slack). A spent weekly budget is logged once as
`budget-exhausted`. Guards: hold switch on, any runner unit active (or state unknown),
the job's timer not enabled, or a later run of the same job: nothing happens. At most
one action per pass and six per day.

Every decision is appended to `/var/lib/lv-ops-fixer/actions.jsonl` (who, what, why,
which run, unit started, result). The Mac digest reads it for "What the agent fixed".

## Install / turn on (parent only)

```
bash ops/ops-fixer/install-vm.sh             # as root on the VM; installs code + units, timer untouched
node /opt/lv-ops-fixer/ops-fixer/fixer.mjs   # dry run: prints the plan, writes and starts nothing
systemctl enable --now lv-ops-fixer.timer    # only after the dry run looks right
```
Reinstall the runner (`ops/exedev-runner/install.sh`) first so the `deploy-retry` job exists.
