import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { monitorContentPublish } from '../../scripts/supervisor/content-monitor.mjs';
import { validateDbIngestDiff, validateIngestPayload, repositoryDispatchBody, workflowDispatchBody } from '../../scripts/supervisor/ingest-contract.mjs';
import { startLocalStagingIngest, validateHostContentMode } from '../../scripts/supervisor/host-run.mjs';
import { TERMINALS } from '../../scripts/supervisor/ledger.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sha = 'a'.repeat(40);
const payload = { kind: 'blog', data_sha: sha, data_branch: 'supervisor/blog-data-1000',
  topic_key: 'blog:topic', regenerations: 0, store: 'db', target: 'staging' };

test('DB payload and candidate commit stay bound to staging transport', () => {
  assert.equal(validateIngestPayload(payload).ok, true);
  assert.equal(validateIngestPayload({ ...payload, target: undefined }).ok, false);
  assert.equal(validateDbIngestDiff(['candidate/post.json']).ok, true);
  assert.equal(validateDbIngestDiff(['candidate/post.json', 'data/posts.json']).ok, false);
  assert.deepEqual(workflowDispatchBody(payload), { ref: 'staging', inputs: { payload: JSON.stringify(payload) } });
  assert.throws(() => repositoryDispatchBody(payload), /staging/);
  assert.deepEqual(repositoryDispatchBody({ ...payload, target: 'production' }).client_payload,
    { ...payload, target: 'production' });
});

test('unsafe DB host configuration fails before Git and legacy remains selectable', () => {
  assert.deepEqual(validateHostContentMode({}), { store: 'git' });
  for (const env of [
    { LV_CONTENT_TARGET: 'production', LV_INGEST_TRANSPORT: 'local' },
    { LV_CONTENT_TARGET: 'production', LV_SITE_BYPASS: 'secret' },
    { LV_CONTENT_TARGET: 'production', LV_STATUS_CREATOR: 'operator' },
    { LV_CONTENT_TARGET: 'staging', LV_INGEST_TRANSPORT: 'local' },
  ]) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-content-mode-'));
    try {
      const gitLog = path.join(dir, 'git.log');
      fs.writeFileSync(path.join(dir, 'git'), '#!/bin/sh\nprintf "called" >> "$GIT_LOG"\nexit 42\n', { mode: 0o755 });
      const result = spawnSync(process.execPath, ['scripts/supervisor/cli.mjs', 'run'], {
        cwd: root, encoding: 'utf8', env: { PATH: `${dir}:${process.env.PATH}`, HOME: dir,
          GIT_LOG: gitLog, LV_WEEKLY_OWNER: 'exedev', LV_CONTENT_STORE: 'db',
          LV_SITE_URL: 'https://example.invalid', LV_STATE_DIR: dir, ...env },
      });
      assert.notEqual(result.status, 0);
      assert.equal(fs.existsSync(gitLog), false, `unsafe mode reached Git: ${JSON.stringify(env)}`);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
  assert(TERMINALS.includes('PUBLISHED_LIVE') && TERMINALS.includes('BLOCKED_PROPAGATION'));
});

test('local staging ingest refuses incomplete operator bindings before cloning', () => {
  assert.throws(() => startLocalStagingIngest({ repoRoot: root, stateDir: os.tmpdir(),
    repo: 'owner/repo', payload, codeSha: sha, env: { LV_STATUS_CREATOR: 'operator' } }),
  /missing operator bindings/);
});

test('local staging harness clones pinned code absent from the default branch and starts child', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-content-local-'));
  const origin = path.join(dir, 'origin.git');
  const seed = path.join(dir, 'seed');
  const host = path.join(dir, 'host');
  const stateDir = path.join(dir, 'state');
  const git = (cwd, ...args) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
    return result.stdout.trim();
  };
  try {
    fs.mkdirSync(seed);
    git(dir, 'init', '--bare', origin);
    git(seed, 'init', '--initial-branch=main');
    git(seed, 'config', 'user.name', 'Local Fixture');
    git(seed, 'config', 'user.email', 'fixture@example.invalid');
    fs.writeFileSync(path.join(seed, 'package.json'), '{"name":"local-fixture","version":"1.0.0","private":true}\n');
    fs.writeFileSync(path.join(seed, 'package-lock.json'), '{"name":"local-fixture","version":"1.0.0","lockfileVersion":3,"requires":true,"packages":{"":{"name":"local-fixture","version":"1.0.0"}}}\n');
    git(seed, 'add', '.');
    git(seed, 'commit', '-m', 'default branch without ingest');
    git(seed, 'remote', 'add', 'origin', origin);
    git(seed, 'push', '-u', 'origin', 'main');
    git(dir, '--git-dir', origin, 'symbolic-ref', 'HEAD', 'refs/heads/main');
    git(seed, 'checkout', '-b', 'staging');
    fs.mkdirSync(path.join(seed, 'scripts/supervisor'), { recursive: true });
    fs.writeFileSync(path.join(seed, 'scripts/supervisor/ingest-db.mjs'), 'console.log("fixture-child-pinned-code");\n');
    git(seed, 'add', '.');
    git(seed, 'commit', '-m', 'staging ingest code');
    git(seed, 'push', '-u', 'origin', 'staging');
    const codeSha = git(seed, 'rev-parse', 'HEAD');
    git(dir, 'clone', origin, host);
    assert.equal(fs.existsSync(path.join(host, 'scripts/supervisor/ingest-db.mjs')), false);
    const operatorEnv = { PATH: process.env.PATH, HOME: dir, LV_STATUS_CREATOR: 'fixture-operator',
      LV_INGEST_CODE_SHA: codeSha, GH_TOKEN: 'fixture-secret', CONTENT_DB_NAME: 'lv_staging',
        CONTENT_DATABASE_URL: 'postgres://fixture', CONTENT_DATABASE_URL_UNPOOLED: 'postgres://fixture',
        CONTENT_DEPLOY_HOOK_URL: 'https://fixture.invalid/hook', CONTENT_SITE_URL: 'https://fixture.invalid',
        CONTENT_SITE_BYPASS: 'fixture-bypass', ANTHROPIC_API_KEY: 'fixture-model-secret',
        SLACK_WEBHOOK_URL: 'https://fixture.invalid/slack' };
    assert.throws(() => startLocalStagingIngest({ repoRoot: host, stateDir, repo: 'fixture/local', payload,
      codeSha, env: { ...operatorEnv, LV_INGEST_CODE_SHA: 'b'.repeat(40) } }), /pinned staging SHA/);
    const started = startLocalStagingIngest({ repoRoot: host, stateDir, repo: 'fixture/local', payload,
      codeSha, env: operatorEnv });
    assert.equal(started.codeSha, codeSha);
    assert.equal(git(started.cloneDir, 'rev-parse', 'HEAD'), codeSha);
    assert(fs.existsSync(path.join(started.cloneDir, 'scripts/supervisor/ingest-db.mjs')));
    let log = '';
    for (let attempt = 0; attempt < 100; attempt += 1) {
      log = fs.readFileSync(started.logFile, 'utf8');
      if (log.includes('fixture-child-pinned-code')) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.match(log, /fixture-child-pinned-code/);
    assert.match(log, new RegExp(`code_sha=${codeSha}`));
    assert.match(log, /status_creator=fixture-operator/);
    assert(!log.includes('fixture-secret') && !log.includes('fixture-model-secret'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('monitor requires latest trusted status and stable fresh render', async () => {
  let tick = 0;
  let reads = 0;
  let manifests = 0;
  const status = (state, creator, at) => ({ sha, context: 'content/publish', state,
    creator: { login: creator }, created_at: at, description: state === 'success' ? 'published:17:seq:42' : 'pending',
    target_url: state === 'success' ? 'https://example.invalid/blog/post' : null });
  const outcome = await monitorContentPublish({ dataSha: sha, title: 'Post title', siteUrl: 'https://example.invalid',
    allowedCreator: 'operator', statusDeadlineMs: 20_000, renderDeadlineMs: 20_000,
    getStatuses: async () => {
      reads += 1;
      return reads === 1 ? [status('success', 'attacker', '2026-09-27T00:00:03Z'),
        status('pending', 'operator', '2026-09-27T00:00:02Z'), status('success', 'operator', '2026-09-27T00:00:01Z')]
        : [status('success', 'operator', '2026-09-27T00:00:04Z')];
    },
    getManifest: async () => ({ live_seq: ++manifests === 1 ? 41 : 42,
      deployment_url: 'https://deployment.invalid/one' }),
    getPage: async () => ({ status: 200, text: '<title>Post title</title>' }),
    now: () => tick, wait: async (ms) => { tick += ms; },
  });
  assert.equal(outcome.state, 'PUBLISHED_LIVE');
  assert.equal(outcome.liveSeq, 42);
  assert(reads >= 2 && manifests >= 3);
  assert(tick < 20_000);
});
