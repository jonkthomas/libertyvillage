import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Imports stay inside each test: the same named regressions fail individually
// when run against the release's original files (which lack these boundaries).
const agent = () => {
  assert.match(fs.readFileSync(new URL('../../ops/weekly-digest/agent/agent.mjs', import.meta.url), 'utf8'), /export function runModel/, 'release lacks the credential-free model boundary');
  return import('../../ops/weekly-digest/agent/agent.mjs');
};
const publisher = () => import('../../ops/weekly-digest/agent/publisher.mjs');
const fixture = {
  generatedAt: '2026-10-22T12:00:00Z', window: { from: '2026-10-15T12:00:00Z', to: '2026-10-22T12:00:00Z' },
  failures: [{ job: 'news', startedAt: '2026-10-21T12:00:00Z', code: 'REFUSED', reason: 'timeout GH_TOKEN=ghp_fixtureSecret', file: 'PRIVATE_FILE_MARKER' }],
  runs: { list: [{ error: 'RAW_RUN_MARKER' }] },
  queue: { held: false, timers: [{ unit: 'lv-news.timer', next: 'tomorrow', schedule: 'daily', note: 'QUEUE_NOTE_MARKER' }], note: 'PRIVATE_QUEUE_MARKER' },
  posted: { items: [{ title: 'Public title', url: 'https://libertyvillage.co/blog/public?query=PRIVATE_URL_QUERY#PRIVATE_FRAGMENT' }] },
  gsc: { source: 'vm', topQueries: ['GSC_QUERY_MARKER'], topPages: ['GSC_PAGE_MARKER'], weeks: [{ topQueries: ['NESTED_QUERY_MARKER'] }], note: 'GSC_NOTE_MARKER', tregError: 'TREG_ERROR_MARKER' },
  notes: ['ROOT_VM_OUTPUT_MARKER GOOGLE_SERVICE_ACCOUNT_JSON=private'], links: { digestUrl: 'TAILNET_MARKER' },
};
const pr = (overrides = {}) => ({ type: 'pr', title: 'Fix timeout', body: 'P1: timeout', base: 'staging', draft: true, head: 'lv-agent/2026-10-22-timeout', patch: 'diff --git a/example.txt b/example.txt\n--- a/example.txt\n+++ b/example.txt\n@@ -1 +1 @@\n-before\n+after\n', ...overrides });
const outbox = (...actions) => ({ version: 1, actions });
const temp = (t) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-agent-test-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };

test('D3 prompt and projection exclude GSC queries/pages and raw diagnostic markers', async () => {
  const { agentInput } = await import('../../ops/weekly-digest/lib/agent-input.mjs');
  const { prompt } = await agent();
  const input = agentInput(fixture);
  const rendered = prompt(fixture);
  for (const marker of ['GSC_QUERY_MARKER', 'GSC_PAGE_MARKER', 'NESTED_QUERY_MARKER', 'GSC_NOTE_MARKER', 'TREG_ERROR_MARKER', 'ROOT_VM_OUTPUT_MARKER', 'PRIVATE_FILE_MARKER', 'RAW_RUN_MARKER', 'QUEUE_NOTE_MARKER', 'PRIVATE_QUEUE_MARKER', 'PRIVATE_URL_QUERY', 'PRIVATE_FRAGMENT', 'TAILNET_MARKER', 'ghp_fixtureSecret']) {
    assert.ok(!JSON.stringify(input).includes(marker), marker);
    assert.ok(!rendered.includes(marker), marker);
  }
  assert.equal(input.gsc, 'ok');
  assert.equal(input.failures[0].refusalCode, 'REFUSED');
  assert.equal(input.posted.items[0].url, 'https://libertyvillage.co/blog/public');
  assert.deepEqual(agentInput(input), input, 'safe transfer can be projected again before the prompt');
  const transfer = fs.readFileSync(new URL('../../ops/weekly-digest/run-digest.mjs', import.meta.url), 'utf8');
  assert.match(transfer, /Buffer\.from\(JSON\.stringify\(agentInput\(model\)\)/);
});

test('D1 model child environment has no GH_TOKEN or alternate GitHub/credential environment', async (t) => {
  const { runModel } = await agent();
  const dir = temp(t);
  const probe = path.join(dir, 'probe.mjs');
  // A real child process captures the environment it actually received.
  fs.writeFileSync(probe, `import fs from 'node:fs'; fs.writeFileSync('child-env.json',JSON.stringify(process.env)); fs.writeFileSync('proposals.json','{"version":1,"actions":[]}');`);
  const box = path.join(dir, 'outbox');
  runModel({ digest: fixture, outbox: box, home: dir, env: { ...process.env,
    GH_TOKEN: 'fake-pat', GITHUB_TOKEN: 'fake-alternate', GH_ENTERPRISE_TOKEN: 'fake-enterprise', GH_CONFIG_DIR: '/secret',
    GH_FUTURE_TOKEN: 'future', GIT_CONFIG_COUNT: '1', SSH_AUTH_SOCK: '/ssh', NODE_OPTIONS: '--inspect' },
    piBin: process.execPath, spawn: (bin, args, opts) => spawnSync(bin, [probe, ...args], opts) });
  const child = JSON.parse(fs.readFileSync(path.join(box, 'child-env.json'), 'utf8'));
  for (const key of Object.keys(child)) assert.doesNotMatch(key, /^(GH_|GITHUB_|GIT_|SSH_|NODE_OPTIONS)/);
  assert.equal(child.HOME, dir);
});

for (const [name, action] of [
  ['base main', pr({ base: 'main' })],
  ['non-draft PR', pr({ draft: false })],
  ['merge action', { type: 'merge', number: 202 }],
  ['non-lv-agent head branch', pr({ head: 'main' })],
]) {
  test(`D1 publisher refuses ${name} before any operation`, async (t) => {
    const { publish } = await publisher();
    let operations = 0;
    assert.throws(() => publish(outbox({ type: 'issue', title: 'Earlier valid issue', body: 'P1 issue' }, action), {
      token: 'fake-pat', stateDir: temp(t), execute: () => { operations++; return { status: 0 }; },
    }));
    assert.equal(operations, 0);
  });
}

test('D3 published issue and PR titles/bodies are redacted at the final boundary', async (t) => {
  const { publish } = await publisher();
  const dir = temp(t);
  const privateText = 'github_pat_fixturevalue Bearer bearer-value https://u:p@db.local/private\nGH_TOKEN=short-value\n-----BEGIN PRIVATE KEY-----\nprivate\n-----END PRIVATE KEY-----\nactual-publisher-token';
  const calls = [];
  publish(outbox({ type: 'issue', title: privateText, body: privateText }, pr({ title: privateText, body: privateText })), {
    token: 'actual-publisher-token', stateDir: dir,
    execute: (bin, args, opts) => {
      calls.push({ bin, args });
      if (bin.endsWith('/gh')) {
        const body = fs.readFileSync(args[args.indexOf('--body-file') + 1], 'utf8');
        const title = args[args.indexOf('--title') + 1];
        for (const value of ['fixturevalue', 'bearer-value', 'u:p', 'short-value', 'actual-publisher-token', 'BEGIN PRIVATE KEY', '\nprivate\n']) {
          assert.ok(!body.includes(value), value); assert.ok(!title.includes(value), value);
        }
        assert.match(body, /REDACTED/);
      }
      return { status: 0, stdout: 'https://github.com/example' };
    },
  });
  const ghCalls = calls.filter((c) => c.bin.endsWith('/gh'));
  assert.deepEqual(ghCalls.map((c) => c.args.slice(0, 2)), [['issue', 'create'], ['pr', 'create']]);
  assert.ok(ghCalls[1].args.includes('--draft'));
  assert.equal(ghCalls[1].args[ghCalls[1].args.indexOf('--base') + 1], 'staging');
  const push = calls.find((c) => c.args.includes('push')).args;
  assert.equal(push.at(-1), 'HEAD:refs/heads/lv-agent/2026-10-22-timeout');
});

test('D1 publisher applies proposal in a fresh local git clone and only pushes its permitted head', async (t) => {
  const { publish } = await publisher();
  const dir = temp(t);
  const source = path.join(dir, 'source'); fs.mkdirSync(source);
  const git = (...args) => {
    const result = spawnSync('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=Test', '-c', 'user.email=test@example.test', ...args], { cwd: source, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); return result.stdout;
  };
  git('init', '-b', 'staging'); fs.writeFileSync(path.join(source, 'example.txt'), 'before\n'); git('add', '.'); git('commit', '-m', 'Fixture');
  const remote = path.join(dir, 'remote.git'); git('clone', '--bare', source, remote);
  const artifacts = [];
  publish(outbox(pr()), { token: 'local-fixture-token', stateDir: path.join(dir, 'publisher'), execute: (bin, args, opts) => {
    if (bin.endsWith('/gh')) { artifacts.push(args); return { status: 0, stdout: 'local://draft/1' }; }
    const localArgs = args.map((arg) => arg === 'https://github.com/jonkthomas/libertyvillage.git' ? remote : arg);
    return spawnSync(bin, localArgs, opts);
  } });
  assert.equal(git('--git-dir', remote, 'show', 'refs/heads/lv-agent/2026-10-22-timeout:example.txt'), 'after\n');
  assert.equal(git('--git-dir', remote, 'show', 'refs/heads/staging:example.txt'), 'before\n');
  assert.ok(artifacts[0].includes('--draft'));
});

test('D1 deployment separates Unix users and loads the PAT only after the model exits', () => {
  const unit = (name) => fs.readFileSync(new URL(`../../ops/weekly-digest/systemd/${name}.service`, import.meta.url), 'utf8');
  const model = unit('lv-digest-agent'), pub = unit('lv-digest-publisher');
  assert.doesNotMatch(model, /^EnvironmentFile=|^LoadCredential=/m);
  assert.match(model, /^User=lv-digest$/m);
  assert.match(pub, /^User=lv-digest-publisher$/m);
  assert.match(model, /^OnSuccess=lv-digest-publisher.service$/m);
  assert.match(pub, /^After=.*lv-digest-agent.service/m);
  assert.match(pub, /^LoadCredential=github-token:\/etc\/lv-digest-publisher.token$/m);
  assert.match(model, /^KillMode=control-group$/m);
  const installer = fs.readFileSync(new URL('../../ops/weekly-digest/install-vm-agent.sh', import.meta.url), 'utf8');
  assert.match(installer, /chmod 0600 \/etc\/lv-digest-publisher.token/);
  assert.match(installer, /chown root:root \/etc\/lv-digest-publisher.token/);
  assert.match(installer, /rm -rf .*\.config\/gh/);
});

test('publisher rejects symlink outboxes and secret-bearing patches without publishing', async (t) => {
  const { publish, readOutbox } = await publisher();
  const dir = temp(t); fs.writeFileSync(path.join(dir, 'real'), JSON.stringify(outbox()));
  fs.symlinkSync(path.join(dir, 'real'), path.join(dir, 'link'));
  assert.throws(() => readOutbox(path.join(dir, 'link')));
  assert.throws(() => publish(outbox(pr({ patch: pr().patch + '\n+GH_TOKEN=private\n' })), { dryRun: true }));
});

test('publisher CLI previews redacted artifacts locally and refuses a main-targeted proposal', (t) => {
  const dir = temp(t), file = path.join(dir, 'proposals.json');
  const script = new URL('../../ops/weekly-digest/agent/publisher.mjs', import.meta.url);
  fs.writeFileSync(file, JSON.stringify(outbox({ type: 'issue', title: 'Fixture issue', body: 'Bearer private-cli-value' }, pr())));
  const run = () => spawnSync(process.execPath, [script.pathname, '--outbox', file], { encoding: 'utf8' });
  let result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /private-cli-value/);
  assert.equal(JSON.parse(result.stdout)[1].draft, true);
  fs.writeFileSync(file, JSON.stringify(outbox(pr({ base: 'main' }))));
  result = run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /publisher refused/);
});
