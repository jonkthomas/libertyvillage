import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { evaluateSentinel } from '../../scripts/supervisor/sentinel.mjs';

const SHA = 'a'.repeat(40);
const ownedPr = { number: 10, state: 'open', head: { sha: SHA, ref: 'blog/auto-owned', repo: { fork: false } }, base: { ref: 'staging' }, user: { login: 'github-actions[bot]' } };
const status = { sha: SHA, statuses: [] };

test('unrelated bot PR cannot trigger the ledger-scoped VM sentinel', () => {
  const ledger = { lease: null, runs: [{ run_id: 'owned', pr_number: 10, head_sha: SHA, started_at: '2026-08-24T09:00:00Z', terminal: null }] };
  const observations = new Map([[10, { pr: { ...ownedPr, state: 'closed' }, status }], [999, { pr: { ...ownedPr, number: 999 }, status }]]);
  assert.deepEqual(evaluateSentinel({ ledger, observations, now: Date.parse('2026-08-24T14:00:00Z'), pidAlive: () => true }), []);
});

test('owned open PR beyond the pilot bound alerts', () => {
  const ledger = { lease: null, runs: [{ run_id: 'owned', pr_number: 10, head_sha: SHA, started_at: '2026-08-24T09:00:00Z', terminal: null }] };
  const findings = evaluateSentinel({ ledger, observations: new Map([[10, { pr: ownedPr, status }]]), now: Date.parse('2026-08-24T14:00:00Z'), pidAlive: () => true });
  assert.equal(findings[0].key, 'owned:open-beyond-bound');
});

test('systemd, checksum, smoke, environment, and rollback artifacts are bounded', () => {
  const read = (name) => fs.readFileSync(new URL(`../../ops/exedev-supervisor/${name}`, import.meta.url), 'utf8');
  const supervisorUnit = read('systemd/lv-supervisor.service');
  const sentinelUnit = read('systemd/lv-supervisor-sentinel.service');
  const smokeUnit = read('systemd/lv-supervisor-smoke.service');
  assert.match(read('install-node22.sh'), /NODE_VERSION=22\.23\.2/);
  assert.match(read('install-node22.sh'), /NODE_SHA256=[0-9a-f]{64}/);
  assert.match(read('systemd/lv-supervisor.timer'), /OnCalendar=Sun,Wed/);
  assert.match(read('systemd/lv-supervisor-sentinel.timer'), /OnCalendar=hourly/);
  assert.match(supervisorUnit, /TimeoutStartSec=21600/);
  assert.match(supervisorUnit, /NoNewPrivileges=yes/);
  assert.match(supervisorUnit, /ProtectSystem=strict/);
  assert.match(supervisorUnit, /ProtectHome=read-only/);
  assert.match(supervisorUnit, /InaccessiblePaths=.*\.config\/gh/);
  assert.doesNotMatch(supervisorUnit, /InaccessiblePaths=.*lv-supervisor\/pi-runtime/);
  assert.doesNotMatch(sentinelUnit, /InaccessiblePaths=.*lv-supervisor\/pi-runtime/);
  assert.doesNotMatch(supervisorUnit, /ExecStartPre=.*git fetch/);
  for (const unit of [supervisorUnit, sentinelUnit]) {
    assert.match(unit, /After=network-online\.target/);
    assert.match(unit, /Environment=GIT_CONFIG_GLOBAL=\/dev\/null/);
    assert.match(unit, /Environment=GIT_CONFIG_NOSYSTEM=1/);
    assert.doesNotMatch(unit, /LoadCredential|CREDENTIALS_DIRECTORY|GH_CONFIG_DIR|GH_TOKEN=|GITHUB_TOKEN=|token-refresh/);
  }
  assert.match(smokeUnit, /ProtectSystem=strict/);
  assert.match(smokeUnit, /ProtectHome=read-only/);
  assert.match(smokeUnit, /ReadWritePaths=\/var\/lib\/lv-supervisor \/home\/exedev\/libertyvillage/);
  assert.match(smokeUnit, /cli\.mjs smoke --agent-dir \/var\/lib\/lv-supervisor\/pi-runtime/);
  assert.match(read('health-smoke.sh'), /systemctl start lv-supervisor-smoke\.service/);
  assert.doesNotMatch(read('health-smoke.sh'), /gh variable (?:get|set) LV_WEEKLY_OWNER/);
  assert.match(read('health-smoke.sh'), /origin\/\$required_branch:ops\/exedev-supervisor\/owner\.txt/);
  assert.match(read('health-smoke.sh'), /branch_owners\[0\].*branch_owners\[1\]/s);
  assert.match(read('health-smoke.sh'), /committed=.*VM=/);
  assert.match(read('health-smoke.sh'), /env -i HOME=\/var\/empty/);
  assert.match(read('health-smoke.sh'), /GIT_CONFIG_GLOBAL=\/dev\/null GIT_CONFIG_NOSYSTEM=1/);
  assert.match(read('health-smoke.sh'), /gh repo view "\$LV_GITHUB_REPOSITORY" --json nameWithOwner/);
  assert.match(read('health-smoke.sh'), /curl --fail --silent --show-error "\$GITHUB_API_URL\/repos\/\$LV_GITHUB_REPOSITORY"/);
  assert.match(read('health-smoke.sh'), /gh api --hostname "\$GH_HOST" "repos\/\$LV_GITHUB_REPOSITORY"/);
  assert.match(read('health-smoke.sh'), /git ls-remote "\$repo_url" HEAD/);
  assert.match(read('health-smoke.sh'), /"\$\{service_env\[@\]\}" git -C "\$repo_dir" fetch --no-tags origin main staging/);
  assert.match(read('health-smoke.sh'), /LV_EXE_GITHUB_PROXY_AUTH/);
  assert.doesNotMatch(read('health-smoke.sh'), /GH_TOKEN|GITHUB_TOKEN|credential_file|token-refresh/);
  assert.match(read('health-smoke.sh'), /LV_SEO_PREFETCH_COMMAND is required/);
  assert.match(read('health-smoke.sh'), /SEO snapshot stale/);
  assert.doesNotMatch(read('install.sh'), /GH_CONFIG_DIR|gh auth setup-git|github-token|token-refresh/);
  assert.doesNotMatch(read('install.sh'), /\/dev\/stdin/);
  assert.match(read('install.sh'), /complete supervisor change must land on both main and staging/);
  assert.match(read('install.sh'), /scripts\/automation\/promotion-control\.mjs/);
  assert.match(read('install.sh'), /scripts\/automation\/weekly-owner\.mjs/);
  assert.match(read('install.sh'), /ops\/exedev-supervisor\/owner\.txt/);
  assert.match(read('health-smoke.sh'), /scripts\/automation\/promotion-control\.mjs/);
  assert.match(read('install.sh'), /lv-supervisor\/context/);
  assert.match(read('install.sh'), /install -o root -g exedev -m 0640 .*lv-supervisor\.env\.example/);
  assert.match(read('install.sh'), /chown root:exedev \/etc\/lv-supervisor\.env/);
  assert.match(read('install.sh'), /chmod 0640 \/etc\/lv-supervisor\.env/);
  assert.match(read('README.md'), /merged to both `main` and `staging` before installation or cutover/);
  assert.match(read('refresh-seo.sh'), /scripts\/pull-seo-data\.js/);
  assert.match(read('refresh-seo.sh'), /successful current GSC data/);
  assert.doesNotMatch(read('lv-supervisor.env.example'), /(?:sk-|ghp_|github_pat_)[A-Za-z0-9]/);
  assert.match(read('lv-supervisor.env.example'), /LV_EXE_GITHUB_PROXY_AUTH=true/);
  assert.match(read('lv-supervisor.env.example'), /exe\.dev-only/);
  assert.doesNotMatch(read('lv-supervisor.env.example'), /GH_CONFIG_DIR|TOKEN_MAX_AGE/);
  assert.match(read('lv-supervisor.env.example'), /LV_GCP_CREDENTIALS_PATH=\/home\/exedev\/libertyvillage\/gcp-credentials\.json/);
  assert.match(read('disable-rollback.sh'), /systemctl disable --now/);
  assert.doesNotMatch(read('disable-rollback.sh'), /gh variable set/);
  assert.match(read('disable-rollback.sh'), /owner\.txt PR/);
  assert.match(read('disable-rollback.sh'), /no-run gap/);
});

test('trusted SEO wrapper atomically installs fresh output from the existing pull script', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-seo-refresh-'));
  const repo = path.join(directory, 'repo');
  const contextDir = path.join(directory, 'context');
  fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true });
  fs.mkdirSync(contextDir);
  fs.writeFileSync(path.join(repo, 'scripts', 'pull-seo-data.js'), '// trusted script fixture\n');
  const credential = path.join(repo, 'gcp-credentials.json');
  fs.writeFileSync(credential, '{}\n', { mode: 0o600 });
  fs.chmodSync(credential, 0o600);
  const nodeStub = path.join(directory, 'node-stub');
  fs.writeFileSync(nodeStub, '#!/usr/bin/env bash\nset -euo pipefail\nif [[ "$1" == "-e" ]]; then exit 0; fi\nprintf \'{"collectedAt":"2026-08-24T12:00:00Z","gsc":{"thisWeek":{"rows":[]}},"ga4":{"totals":{"rows":[]}}}\\n\' > "$LV_SEO_OUTPUT_PATH"\n', { mode: 0o700 });
  const context = path.join(contextDir, 'seo-data-latest.json');
  execFileSync(fileURLToPath(new URL('../../ops/exedev-supervisor/refresh-seo.sh', import.meta.url)), [], {
    env: { ...process.env, LV_REPO_DIR: repo, LV_SEO_CONTEXT: context, LV_NODE_BINARY: nodeStub, LV_GCP_CREDENTIALS_PATH: credential },
  });
  assert.equal(JSON.parse(fs.readFileSync(context, 'utf8')).collectedAt, '2026-08-24T12:00:00Z');
  assert.equal(fs.statSync(context).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(contextDir), ['seo-data-latest.json']);
});
