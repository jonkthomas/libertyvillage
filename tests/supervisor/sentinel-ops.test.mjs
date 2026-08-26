import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { evaluateSentinel } from '../../scripts/supervisor/sentinel.mjs';

const SHA = 'a'.repeat(40);
const ownedPr = { number: 10, state: 'open', head: { sha: SHA, ref: 'blog/auto-owned', repo: { fork: false } }, base: { ref: 'main' }, user: { login: 'github-actions[bot]' } };
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

test('merged-to-main nonterminal past the bound screams', () => {
  const ledger = { lease: null, runs: [{ run_id: 'owned', pr_number: 10, head_sha: SHA, started_at: '2026-08-24T09:00:00Z', terminal: null }] };
  const merged = {
    ...ownedPr, state: 'closed', merged: true, merge_commit_sha: 'b'.repeat(40),
    base: { ref: 'main' },
  };
  const findings = evaluateSentinel({
    ledger, observations: new Map([[10, { pr: merged, status }]]),
    now: Date.parse('2026-08-24T14:00:00Z'), pidAlive: () => false,
  });
  assert.equal(findings.some((finding) => finding.runId === 'owned' && finding.key === 'owned:merged-nonterminal'), true);
});

test('systemd, checksum, smoke, environment, and rollback artifacts are bounded', () => {
  const read = (name) => fs.readFileSync(new URL(`../../ops/exedev-supervisor/${name}`, import.meta.url), 'utf8');
  const supervisorUnit = read('systemd/lv-supervisor.service');
  const sentinelUnit = read('systemd/lv-supervisor-sentinel.service');
  const smokeUnit = read('systemd/lv-supervisor-smoke.service');
  assert.match(read('install-node22.sh'), /NODE_VERSION=22\.23\.2/);
  assert.match(read('install-node22.sh'), /NODE_SHA256=[0-9a-f]{64}/);
  assert.match(read('install.sh'), /pi_sdk_version=0\.84\.2/);
  assert.match(read('install.sh'), /pi_sdk_path=\$pi_sdk_prefix\/lib\/node_modules\/@earendil-works\/pi-coding-agent/);
  assert.match(read('install.sh'), /\/usr\/local\/bin\/pi --version/);
  assert.match(read('install.sh'), /npm install --global --prefix "\$pi_sdk_prefix".*--ignore-scripts.*@earendil-works\/pi-coding-agent@\$pi_sdk_version/);
  assert.match(read('install.sh'), /test -f "\$pi_sdk_path\/node_modules\/typebox\/build\/index\.mjs"/);
  assert.match(read('install.sh'), /Pinned pi SDK install is missing TypeBox/);
  assert.match(read('install.sh'), /sdk\.VERSION !== '\$pi_sdk_version'/);
  assert.match(read('install.sh'), /sed -i .*\^PI_SDK_PATH=.*PI_SDK_PATH=\$pi_sdk_path/);
  assert.match(read('install.sh'), /printf '\\nPI_SDK_PATH=%s\\n'/);
  assert.match(read('install.sh'), /tee -a \/etc\/lv-supervisor\.env/);
  assert.match(read('lv-supervisor.env.example'), /PI_SDK_PATH=\/opt\/lv-supervisor-sdk\/lib\/node_modules\/@earendil-works\/pi-coding-agent/);
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
  assert.match(read('health-smoke.sh'), /origin\/\$required_branch:data\/topic-queue\.json/);
  assert.match(read('health-smoke.sh'), /queue\?\.version !== 1/);
  assert.match(read('health-smoke.sh'), /\["key", "kind", "title", "source", "rationale", "addedAt", "branchPrefix"\]/);
  assert.match(read('health-smoke.sh'), /entry\?\.kind === "blog"/);
  assert.doesNotMatch(read('install.sh'), /GH_CONFIG_DIR|gh auth setup-git|github-token|token-refresh/);
  assert.doesNotMatch(read('install.sh'), /\/dev\/stdin/);
  assert.match(read('install.sh'), /complete supervisor change must land on both main and staging/);
  assert.match(read('install.sh'), /scripts\/automation\/promotion-control\.mjs/);
  assert.match(read('install.sh'), /scripts\/automation\/weekly-owner\.mjs/);
  assert.match(read('install.sh'), /ops\/exedev-supervisor\/owner\.txt/);
  assert.match(read('health-smoke.sh'), /scripts\/automation\/promotion-control\.mjs/);
  assert.doesNotMatch(read('install.sh'), /lv-supervisor\/context/);
  assert.match(read('install.sh'), /install -o root -g exedev -m 0640 .*lv-supervisor\.env\.example/);
  assert.match(read('install.sh'), /chown root:exedev \/etc\/lv-supervisor\.env/);
  assert.match(read('install.sh'), /chmod 0640 \/etc\/lv-supervisor\.env/);
  assert.match(read('README.md'), /merged to both `main` and `staging` before installation or cutover/);
  assert.doesNotMatch(read('lv-supervisor.env.example'), /(?:sk-|ghp_|github_pat_)[A-Za-z0-9]/);
  assert.match(read('lv-supervisor.env.example'), /LV_EXE_GITHUB_PROXY_AUTH=true/);
  assert.match(read('lv-supervisor.env.example'), /exe\.dev-only/);
  assert.doesNotMatch(read('lv-supervisor.env.example'), /GH_CONFIG_DIR|TOKEN_MAX_AGE/);
  const supervisorOps = [
    read('health-smoke.sh'), read('install.sh'), read('lv-supervisor.env.example'), read('README.md'),
    supervisorUnit, sentinelUnit, smokeUnit,
  ].join('\n');
  assert.doesNotMatch(supervisorOps, /LV_SEO_CONTEXT|LV_SEO_PREFETCH_COMMAND|LV_GCP_CREDENTIALS_PATH|refresh-seo|seo-data-latest/);
  assert.match(read('disable-rollback.sh'), /systemctl disable --now/);
  assert.doesNotMatch(read('disable-rollback.sh'), /gh variable set/);
  assert.match(read('disable-rollback.sh'), /owner\.txt PR/);
  assert.match(read('disable-rollback.sh'), /no-run gap/);
});
