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
const issue = (overrides = {}) => ({ type: 'issue', title: 'Fix timeout', body: 'P1: timeout', patch: 'diff --git a/example.txt b/example.txt\n--- a/example.txt\n+++ b/example.txt\n@@ -1 +1 @@\n-before\n+after\n', ...overrides });
const workflowPatch = 'diff --git a/.github/workflows/x.yml b/.github/workflows/x.yml\nnew file mode 100644\n--- /dev/null\n+++ b/.github/workflows/x.yml\n@@ -0,0 +1,3 @@\n+on: push\n+jobs: {}\n+# human review required\n';
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

for (const type of ['pr', 'push', 'merge']) {
  test(`D1 issues-only publisher refuses ${type} before any operation`, async (t) => {
    const { publish } = await publisher();
    let operations = 0;
    const action = type === 'pr'
      ? { type, title: 'Old draft proposal', body: 'P1 issue', base: 'staging', draft: true, head: 'lv-agent/fixture', patch: workflowPatch }
      : { type, number: 202 };
    assert.throws(() => publish(outbox({ type: 'issue', title: 'Earlier valid issue', body: 'P1 issue' }, action), {
      token: 'fake-pat', stateDir: temp(t), execute: () => { operations++; return { status: 0 }; },
    }));
    assert.equal(operations, 0);
  });
}

test('D3 published issue titles and bodies are redacted at the final boundary', async (t) => {
  const { publish } = await publisher();
  const dir = temp(t);
  const privateText = 'github_pat_fixturevalue Bearer bearer-value https://u:p@db.local/private\nGH_TOKEN=short-value\n-----BEGIN PRIVATE KEY-----\nprivate\n-----END PRIVATE KEY-----\nactual-publisher-token';
  const calls = [];
  publish(outbox(issue({ title: privateText, body: privateText })), {
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
  assert.equal(calls.length, 1);
  assert.deepEqual(ghCalls.map((c) => c.args.slice(0, 2)), [['issue', 'create']]);
});

test('D1 workflow patch is issue text with zero git push or PR operations', async (t) => {
  const { publish } = await publisher();
  const calls = [];
  const urls = publish(outbox(issue({ patch: workflowPatch })), {
    token: 'local-fixture-token', stateDir: temp(t), execute: (bin, args, opts) => {
      calls.push({ bin, args });
      assert.equal(bin, '/usr/local/bin/gh');
      assert.deepEqual(args.slice(0, 2), ['issue', 'create']);
      assert.deepEqual(Object.keys(opts.env).filter((k) => k.startsWith('GIT_')), []);
      const body = fs.readFileSync(args[args.indexOf('--body-file') + 1], 'utf8');
      assert.ok(body.includes('```diff\n' + workflowPatch + '```'));
      return { status: 0, stdout: 'local://issue/1' };
    },
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(urls, ['local://issue/1']);
});

test('D1 publisher source has no git or PR execution path', () => {
  const source = fs.readFileSync(new URL('../../ops/weekly-digest/agent/publisher.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /REPO_URL|GIT_|git-credential|\/usr\/bin\/git|\bgit\s*\(|['"](?:pr|push|merge|clone|apply|commit)['"]/);
});

test('D1 oversized patch is truncated to 30 KiB of UTF-8 with a human review note', async (t) => {
  const { publish } = await publisher();
  const patch = workflowPatch + '+éééééééééé\n'.repeat(5000);
  let operations = 0;
  publish(outbox(issue({ patch })), { token: 'fake-pat', stateDir: temp(t), execute: (bin, args) => {
    operations++;
    const body = fs.readFileSync(args[args.indexOf('--body-file') + 1], 'utf8');
    const rendered = body.split('```diff\n')[1]?.split('\n```')[0];
    assert.ok(rendered?.startsWith(workflowPatch));
    assert.ok(Buffer.byteLength(rendered) <= 30 * 1024);
    assert.ok(Buffer.byteLength(rendered) >= 30 * 1024 - 3);
    assert.doesNotMatch(rendered, /\uFFFD/);
    assert.match(body, /truncated/i);
    return { status: 0, stdout: 'local://issue/1' };
  } });
  assert.equal(operations, 1);
});

test('D1 patch fences preserve embedded Markdown as literal diff text', async () => {
  const { publish } = await publisher();
  const patch = workflowPatch + '+```\n+text\n+```\n';
  const [preview] = publish(outbox(issue({ patch })), { dryRun: true });
  assert.ok(preview.body.includes('````diff\n' + patch + '````'));
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

test('publisher rejects symlink outboxes', async (t) => {
  const { readOutbox } = await publisher();
  const dir = temp(t); fs.writeFileSync(path.join(dir, 'real'), JSON.stringify(outbox()));
  fs.symlinkSync(path.join(dir, 'real'), path.join(dir, 'link'));
  assert.throws(() => readOutbox(path.join(dir, 'link')));
});

test('D1 issues-only publisher refuses secret-shaped binary and credential-bearing patches before any operation', async (t) => {
  const { publish } = await publisher();
  for (const suffix of ['+GH_TOKEN=private\n', '+github_pat_fixturevalue\n', 'GIT binary patch\n', 'Binary files a/x and b/x differ\n', '+actual-publisher-token\n', '+safe line\n'.repeat(4000) + '+GH_TOKEN=private\n']) {
    let operations = 0;
    assert.throws(() => publish(outbox({ type: 'issue', title: 'Earlier valid issue', body: 'P1' }, issue({ patch: workflowPatch + suffix })), {
      token: 'actual-publisher-token', stateDir: temp(t), execute: () => { operations++; return { status: 0 }; },
    }));
    assert.equal(operations, 0);
  }
});

test('publisher CLI previews redacted issues with optional patches locally', (t) => {
  const dir = temp(t), file = path.join(dir, 'proposals.json');
  const script = new URL('../../ops/weekly-digest/agent/publisher.mjs', import.meta.url);
  fs.writeFileSync(file, JSON.stringify(outbox(issue({ body: 'Bearer private-cli-value', patch: workflowPatch }))));
  const result = spawnSync(process.execPath, [script.pathname, '--outbox', file], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /private-cli-value/);
  const [preview] = JSON.parse(result.stdout);
  assert.equal(preview.type, 'issue');
  assert.ok(preview.body.includes(workflowPatch));
});

test('D1 publisher CLI refuses PR push merge proposals and action flags before any operation', (t) => {
  const dir = temp(t), file = path.join(dir, 'proposals.json');
  const script = new URL('../../ops/weekly-digest/agent/publisher.mjs', import.meta.url);
  const run = (...args) => spawnSync(process.execPath, [script.pathname, '--outbox', file, ...args], { encoding: 'utf8' });
  fs.writeFileSync(file, JSON.stringify(outbox()));
  for (const flag of ['--pr', '--push', '--merge']) {
    const result = run(flag);
    assert.equal(result.status, 1, flag);
    assert.match(result.stderr, /publisher refused/);
  }
  for (const type of ['pr', 'push', 'merge']) {
    fs.writeFileSync(file, JSON.stringify(outbox({ type, title: 'Legacy action', body: 'P1', base: 'staging', draft: true, head: 'lv-agent/fixture', patch: workflowPatch })));
    const result = run();
    assert.equal(result.status, 1, type);
    assert.match(result.stderr, /publisher refused/);
  }
});
