# exe.dev content runner package

This package implements the six UTC jobs (plus the on-demand staging-only `weekly-roundup`) in `docs/specs/exedev-content-runner.md` r7. The root launcher reads the two mode-0600 env files, binds one target, and starts the same `lv-runner@.service` for calendar and on-demand work. The Node worker pins one public Git SHA per run and uses only the pinned tree for content export, submit, gate, deploy and smoke. It creates a disposable scratch copy for the blog and SEO SDK agents. The generator runs as `lv-generator` in a transient systemd unit with `ProtectSystem=strict`, `ReadWritePaths` limited to scratch and cache, `NoNewPrivileges`, and only its job's source/AI keys. It has no DB URL, deploy hook, Slack webhook, bypass, SerpApi, GitHub token, or exe.dev proxy. The trusted worker treats scratch as disposable: it copies only bounded, regular-file `data/*.json`, blog JPGs, and declared task artifacts into the trusted tree; it never parses, executes or copies scratch code/config. All other changed paths are logged with a bounded name list and discarded without application-level reads or copying; the trusted Git status path census may hash tracked bytes. A missing required output or invalid transfer artifact fails closed.

## Install on `lv-content-runner.exe.xyz`

Do this from a checkout containing the approved runner commit. Node **v22.23.2** is already installed on the VM; the installer asserts that version. The two root env files are already present and must remain owner root, mode 0600. `/etc/lv-runner.env` supplies common source keys; `/etc/lv-runner-staging.env` must supply `CONTENT_DATABASE_URL`, `CONTENT_DATABASE_URL_UNPOOLED`, `CONTENT_DB_NAME=lv_staging`, `CONTENT_SITE_URL` for the staging alias, `CONTENT_SITE_BYPASS`, `CONTENT_DEPLOY_HOOK_URL` for staging, `SLACK_WEBHOOK_URL`, plus source/AI keys. `GOOGLE_SERVICE_ACCOUNT_JSON` is converted to two private temporary files at run time. The production file `/etc/lv-runner-production.env` and `LV_RUNNER_PRODUCTION_ENABLED=1` are absent until the protected switch.

```sh
sudo bash ops/exedev-runner/install.sh
sudo env PLAYWRIGHT_BROWSERS_PATH=/opt/lv-runner/chromium npx --yes playwright@1.58.2 install --with-deps chromium
sudo systemctl daemon-reload
sudo systemctl list-timers --all | grep -E 'topic-discovery|seo-improvements|discover-businesses|news|weekly-growth-report|weekly-blog' || true
```

The installer creates `lv-runner` and `lv-generator`, installs the launcher, a narrow root generator helper entry, the service template and six timers. **It does not enable any timer and always disables `lv-runner-seo-improvements.timer`, including on reinstalls; it leaves the other five timers' existing enable states unchanged.** The SEO staging fixer failed twice with submission 5 still gating, so [issue #182](https://github.com/jonkthomas/libertyvillage/issues/182) holds this lane off until an independently observed staging acceptance. The production timers refer to `/etc/lv-runner-production.env`, which must stay absent during staging UAT. The public origin must remain exactly `https://github.com/jonkthomas/libertyvillage.git`; no GitHub write integration or proxy access is used.

## Staging UAT commands

Each command creates a fresh slot. Copy the slot printed on success or read the private JSONL log name for a retry with `--slot`; include the same `--topic` and `--dry-run` options on that retry. Other jobs keep one idempotency key per slot, `runner:<job>:<target>:<slot>`, and resume an existing submission before regenerating. A new invocation gets a new slot.

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

The weekly-blog acceptance run must omit `--dry-run` and show a new post through staging gate, deploy, and smoke. Generator-created backup, draft and note files outside the transfer allowlist stay scratch-only; even unexpected files do not block a valid data transfer. SEO scratch code suggestions are logged and send a run-reference-only human-PR Slack notice, never a bot code PR. The news job resumes any `open` or `gating` news submission, or pending published propagation, before drafting another candidate. At least one healthy source is required. Zero qualified news posts and zero discoveries are normal. `--dry-run` on news does not resume or publish. SEO captures the exported baseline before generation, checks the accepted data lane, and routes code suggestions to the private log and a run-reference-only informational Slack notice for a human PR. Weekly-blog and weekly-roundup use the durable cadence tables instead of local topic state; see below.

## Durable cadence (weekly-blog, weekly-roundup)

`docs/specs/content-cadence-2026.md` governs both jobs; `/var/lib/lv-runner/topic-state.json` is no longer read. Their idempotency key is the DB attempt key (`cadence:sha256(target|week|lane|slot|ordinal)`), not the run slot, so any later run resumes the same submission.

- **weekly-blog**: `cadence count` first; two current-live content posts is a no-op with no model spend. Otherwise it reserves content slot 1 then 2, resumes an open attempt by its original key (lookup → attach → gate), or retries a crash-before-submit with the same key only when the rebuilt trusted pack is identical. New intents come from `data/topic-queue.json` blog topics filtered by `checkTopicGroundability` (live posts plus all-time smoked/consumed fingerprints from `cadence consumed`) before any generator spend; at most three normal intents per slot per week, four generations per run, and on Sunday only up to two directory-derived reserve guides (one per business category whose live records pass `reserveGuideEligibility`; the pack is built only from that category, a category already reserved this week is never reused, and a category whose full-directory selection is not category-pure is skipped before spend). The runner builds the source pack from the fresh export, records `cadence attempt` with `pack.fingerprint` as digest, runs the generator, and requires the scratch sidecar fingerprint to equal it and `verifySourcePack` to pass against the pre-generation export. It then submits `--source-pack <trusted pack>` (never the sidecar). No post, a bad sidecar or a submit refusal records `failed-before-submit`; gate reject/block records that outcome; then the next distinct intent runs. Smoke records `smoked` then `consumed` (the CLI observes the hosted alias); pending propagation keeps the attempt open. Any run ending below two posts fails with a safe class (`weekly content missed` on Sunday). Every weekly-blog/roundup run first runs `cadence deadline` for the prior week plus up to four older weeks with cadence rows (oldest first, idempotent), then `cadence deliver-alerts`; the current week is never deadline-evaluated. Scratch receipts never count. **Missed-alert start week:** set `CADENCE_START_ISO_WEEK=YYYY-MM-DD` (UTC Monday) only in `/etc/lv-runner-staging.env` or `/etc/lv-runner-production.env` for that target when activating its cadence. Earlier weeks are skipped, including the immediate prior week; a configured active prior week still alerts even if it has no slots. With no setting, each run defaults to its current week and logs `cadence-start-week-defaulted`: missed-week alerts stay suppressed until a fixed start week is configured. An invalid date fails before content attempts. This setting does not enable a timer or publication. Older catch-up still requires a slot or attempt and stays bounded to four prior weeks. Production weekly-blog will also alert for missing news while weekly-roundup remains staging-only; John must decide production roundup activation separately.
- **weekly-roundup** (on-demand, no timer, **staging only**; runner and launcher refuse production): `cadence count` no-op at one roundup; reserve the week's single roundup slot (losers do nothing). It runs the news discovery, then `scripts/news-pilot/roundup-run.mjs --run --out --root --now`. `result.json`/`pack.json` are schema-checked first. A consistent zero (`published 0`, `decision hold`, no items, no new post) is a non-terminal hold: no attempt, no alert, slot released, `{noChanges, reason: 'zero-eligible-hold'}`. Otherwise exactly one new `news` post with the week's slug and `packDigest == sha256(canonical pack)` is required before `cadence attempt` (digest as fingerprint), then submit `--kind roundup --roundup-out`, attach, gate, smoked → consumed. Item eligibility stays in the writer/evidence modules; the runner checks only post identity.

```sh
sudo lv-runner run weekly-blog --target staging
sudo lv-runner run weekly-roundup --target staging
```

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

Parent owns protected branch settings, production credentials, timers and production on-demand runs. Only after the five accepted staging job journeys, exact-head gate, branch switch checks, and confirmation: install `/etc/lv-runner-production.env` mode 0600 with `CONTENT_DB_NAME=neondb`, production URL/site/hook, no bypass, and `LV_RUNNER_PRODUCTION_ENABLED=1`. Keep `/etc/lv-runner.hold` available as the immediate write stop. Disable `lv-supervisor.timer` **and** `lv-supervisor-sentinel.timer` before enabling the weekly-blog timer. In the coordinated window after GHA writer schedules stop, enable only `lv-runner-topic-discovery.timer`, `lv-runner-discover-businesses.timer`, `lv-runner-news.timer`, `lv-runner-weekly-growth-report.timer`, and `lv-runner-weekly-blog.timer`. **Keep `lv-runner-seo-improvements.timer` disabled** even though the old GHA SEO schedule is retired; this is a deliberate temporary no-writer gap, not an unverified SEO acceptance. Enable SEO only after #182 reaches real staging gate acceptance and a separately guarded production decision; never enable old and new SEO writers together. Production on-demand requires `--production-approved` after parent/John authorization. For rollback, disable runner timers first, then restore GHA triggers in the protected PR and restore supervisor timers only after the runner blog timer is off.

The runner logs only job, target, slot, code SHA, submission ID, gate/deploy exit, and bounded error codes under `/var/log/lv-runner` mode 0700. The root helper separately writes a maximum 64 KiB root:root 0600 per-slot JSONL diagnostic under root-only `/var/log/lv-generator`: model/MCP status, tool counts, SDK summary, postWritten and closed-set stop reason only. Raw assistant/tool text, candidate bytes and env values are not persisted. Slack failure text uses only job, target and slot; alert failures are logged locally. `flock -n` makes overlap visible and skips the second run. No production job is run by installation.
