# exe.dev content runner package

This package implements the six UTC jobs in `docs/specs/exedev-content-runner.md` r7. The root launcher reads the two mode-0600 env files, binds one target, and starts the same `lv-runner@.service` for calendar and on-demand work. The Node worker pins one public Git SHA per run and uses only the pinned tree for content export, submit, gate, deploy and smoke. It creates a disposable scratch copy for the blog and SEO SDK agents. The generator runs as `lv-generator` in a transient systemd unit with `ProtectSystem=strict`, `ReadWritePaths` limited to scratch and cache, `NoNewPrivileges`, and only its job's source/AI keys. It has no DB URL, deploy hook, Slack webhook, bypass, SerpApi, GitHub token, or exe.dev proxy. The trusted worker refuses scratch code edits and copies only bounded `data/*.json`, blog JPGs, and task artifacts into the trusted tree.

## Install on `lv-content-runner.exe.xyz`

Do this from a checkout containing the approved runner commit. Node **v22.23.2** is already installed on the VM; the installer asserts that version. The two root env files are already present and must remain owner root, mode 0600. `/etc/lv-runner.env` supplies common source keys; `/etc/lv-runner-staging.env` must supply `CONTENT_DATABASE_URL`, `CONTENT_DATABASE_URL_UNPOOLED`, `CONTENT_DB_NAME=lv_staging`, `CONTENT_SITE_URL` for the staging alias, `CONTENT_SITE_BYPASS`, `CONTENT_DEPLOY_HOOK_URL` for staging, `SLACK_WEBHOOK_URL`, plus source/AI keys. `GOOGLE_SERVICE_ACCOUNT_JSON` is converted to two private temporary files at run time. The production file `/etc/lv-runner-production.env` and `LV_RUNNER_PRODUCTION_ENABLED=1` are absent until the protected switch.

```sh
sudo bash ops/exedev-runner/install.sh
sudo env PLAYWRIGHT_BROWSERS_PATH=/opt/lv-runner/chromium npx --yes playwright@1.58.2 install --with-deps chromium
sudo systemctl daemon-reload
sudo systemctl list-timers --all | grep -E 'topic-discovery|seo-improvements|discover-businesses|news|weekly-growth-report|weekly-blog' || true
```

The installer creates `lv-runner` and `lv-generator`, installs the launcher, a narrow root generator helper entry, the service template and six timers. **It does not enable any timer.** The production timers refer to `/etc/lv-runner-production.env`, which must stay absent during staging UAT. The public origin must remain exactly `https://github.com/jonkthomas/libertyvillage.git`; no GitHub write integration or proxy access is used.

## Staging UAT commands

Each command creates a fresh slot. Copy the slot printed on success or read the private JSONL log name for a retry with `--slot`; include the same `--topic` and `--dry-run` options on that retry. A slot keeps one idempotency key, `runner:<job>:<target>:<slot>`, and resumes an existing submission before regenerating. A new invocation gets a new slot.

```sh
sudo lv-runner run topic-discovery --target staging
sudo lv-runner run seo-improvements --target staging
sudo lv-runner run discover-businesses --target staging
sudo lv-runner run news --target staging
sudo lv-runner run weekly-growth-report --target staging
sudo lv-runner report weekly-growth-report --latest
sudo lv-runner run weekly-blog --target staging --topic 'A verified Liberty Village topic'
sudo ls -l /var/log/lv-runner
```

The weekly-blog acceptance run must omit `--dry-run` and show a new post through staging gate, deploy, and smoke. Generator-created `data/posts.json.backup` and `tasks/pipeline-summary.txt` are scratch-only and are never transferred; every other non-allowlisted output still blocks the run. The news job resumes any `open` or `gating` news submission, or pending published propagation, before drafting another candidate. At least one healthy source is required. Zero qualified news posts and zero discoveries are normal. `--dry-run` on news does not resume or publish. SEO captures the exported baseline before generation, checks the accepted data lane, and routes code suggestions to the private log and failure Slack for a human PR. Topic attempts and consumed keys are stored only in `/var/lib/lv-runner/topic-state.json`; consumption is marked after gate and smoke. The local state does not survive VM rebuild. [Issue #176](https://github.com/jonkthomas/libertyvillage/issues/176) tracks durable GitHub issue candidate-state integration; do not claim that acceptance until it exists. An unused queue whose attempts are exhausted alerts instead of silently falling back.

## Evaluator retirement

The Git-era `full-autonomous-loop.eval.mjs` and its lock were retired with the autonomous coordinator. The original `canary104-grounding.eval.mjs` and `evals/canary104-grounding.sha256` remain byte-for-byte archived, not relocked; ordinary `test:automation` runs the live canary assertions through `canary104-successor.test.mjs`, superseding only its obsolete coordinator-workflow wiring check. The historical citations in `docs/specs/neon-content-store.md` describe the retired evaluator, not active runner coverage.

## Negative checks

```sh
node --test tests/runner/runner.test.mjs
bash -n ops/exedev-runner/launcher.sh ops/exedev-runner/install.sh
node --check ops/exedev-runner/runner.mjs
sudo test ! -e /etc/lv-runner-production.env
sudo systemctl is-enabled lv-runner-topic-discovery.timer lv-runner-seo-improvements.timer lv-runner-discover-businesses.timer lv-runner-news.timer lv-runner-weekly-growth-report.timer lv-runner-weekly-blog.timer
```

The `is-enabled` command should report `disabled` for every timer during UAT. The test suite covers wrong DB/site/bypass bindings, same timer and on-demand service, stable slot keys, scratch CLI poisoning, the agent's key allowlist, topic state and news handoff. On the VM, the anonymous public clone's `git push --dry-run` has already been observed to fail with `could not read Username`; repeat after install using a disposable clone if the GitHub integration or proxy configuration changes. Do not put tokens in the negative test environment.

```sh
sudo -u lv-generator env -i HOME=/var/cache/lv-generator PATH=/usr/local/bin:/usr/bin:/bin GIT_TERMINAL_PROMPT=0 git clone https://github.com/jonkthomas/libertyvillage.git /var/cache/lv-generator/push-negative
sudo -u lv-generator env -i HOME=/var/cache/lv-generator PATH=/usr/local/bin:/usr/bin:/bin GIT_TERMINAL_PROMPT=0 git -C /var/cache/lv-generator/push-negative push --dry-run origin HEAD:refs/heads/lv-runner-negative-check
```

The second command must fail without credentials. The generator unit also sets an invalid push URL. Treat any successful dry-run push as a blocker.

## Protected switch

Parent owns protected branch settings, production credentials, timers and production on-demand runs. Only after staging UAT, exact-head gate, branch switch checks, and confirmation: install `/etc/lv-runner-production.env` mode 0600 with `CONTENT_DB_NAME=neondb`, production URL/site/hook, no bypass, and `LV_RUNNER_PRODUCTION_ENABLED=1`. Keep `/etc/lv-runner.hold` available as the immediate write stop. Disable `lv-supervisor.timer` **and** `lv-supervisor-sentinel.timer` before enabling the weekly-blog timer. In the coordinated window after GHA writer schedules stop, enable the six runner timers using `systemctl enable --now lv-runner-<job>.timer`; keep gap at most one interval. Production on-demand requires `--production-approved` after parent/John authorization. For rollback, disable runner timers first, then restore GHA triggers in the protected PR and restore supervisor timers only after the runner blog timer is off.

The runner logs only job, target, slot, code SHA, submission ID, gate/deploy exit, and bounded error codes under `/var/log/lv-runner` mode 0700. Candidate bytes and env values are not logged. Slack failure text uses only job, target and slot; alert failures are logged locally. `flock -n` makes overlap visible and skips the second run. No production job is run by installation.
