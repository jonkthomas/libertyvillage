#!/usr/bin/env node
// Provisional S11a DB-mode acceptance contract. Local Git, fake gh and fake
// content CLI only. This does not exercise the S11c GitHub event trigger/YAML.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as contract from '../../scripts/supervisor/ingest-contract.mjs';
import { TERMINALS, terminalizeRun } from '../../scripts/supervisor/ledger.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const rel = 'tests/supervisor/neon-content-acceptance.eval.mjs';
const manifest = 'evals/neon-content-store.sha256';
const sha = 'a'.repeat(40);
const basePayload = Object.freeze({
  kind: 'blog', data_sha: sha, data_branch: 'supervisor/blog-data-1000',
  topic_key: 'acceptance:topic', regenerations: 0, store: 'db', target: 'staging',
});
const checks = [];
function check(id, name, fn) {
  try { const evidence = fn(); checks.push({ id, name, result: 'PASS', evidence: evidence ?? null }); }
  catch (error) { checks.push({ id, name, result: 'RED', reason: error.message }); }
}
async function checkAsync(id, name, fn) {
  try { const evidence = await fn(); checks.push({ id, name, result: 'PASS', evidence: evidence ?? null }); }
  catch (error) { checks.push({ id, name, result: 'RED', reason: error.message }); }
}
function read(file) { return fs.readFileSync(path.join(root, file), 'utf8'); }
function digest(file) { return crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex'); }
function run(bin, args, options = {}) {
  const result = spawnSync(bin, args, { encoding: 'utf8', timeout: 15_000, maxBuffer: 1024 * 1024,
    env: { PATH: process.env.PATH, HOME: os.tmpdir(), GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_ALLOW_PROTOCOL: 'file', ...options.env },
    cwd: options.cwd ?? root });
  if (result.error) throw result.error;
  return result;
}
function git(cwd, args) {
  const result = run('git', args, { cwd });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}
function expectValid(payload) {
  assert.equal(contract.validateIngestPayload(payload).ok, true,
    `DB payload rejected: ${contract.validateIngestPayload(payload).errors?.join('; ')}`);
}
function expectInvalid(payload) {
  assert.equal(contract.validateIngestPayload(payload).ok, false,
    `unsafe DB payload accepted: ${JSON.stringify(payload)}`);
}
function cloneFixture(tmp, { extra = false } = {}) {
  const origin = path.join(tmp, 'origin.git');
  const seed = path.join(tmp, 'seed');
  const work = path.join(tmp, 'work');
  fs.mkdirSync(seed);
  git(tmp, ['init', '--bare', origin]);
  git(seed, ['init']);
  git(seed, ['config', 'user.name', 'Neon Eval']);
  git(seed, ['config', 'user.email', 'neon-eval@example.invalid']);
  fs.cpSync(path.join(root, 'scripts'), path.join(seed, 'scripts'), { recursive: true });
  // The real ingest code executes this CLI. The fixture records its argv and
  // returns controlled gate results; it never opens a database or a socket.
  const cli = path.join(seed, 'scripts/content/cli.mjs');
  fs.mkdirSync(path.dirname(cli), { recursive: true });
  fs.writeFileSync(cli, [
    "import fs from 'node:fs';",
    "fs.appendFileSync(process.env.NEON_EVAL_CLI_LOG, JSON.stringify(process.argv.slice(2)) + '\\n');",
    "const verb = process.argv[2];",
    "if (verb === 'export') { fs.mkdirSync('.content-export', {recursive:true}); fs.writeFileSync('.content-export/manifest.json', '{}'); console.log('{}'); }",
    "else if (verb === 'submit') { const argv=process.argv.slice(2); const flag=(name)=>argv[argv.indexOf(name)+1]; const record=JSON.parse(fs.readFileSync(flag('--record-file'),'utf8')); if (flag('--kind')!=='blog-live'||flag('--dataset')!=='posts'||flag('--idempotency-key')!==`vm:${process.env.NEON_EVAL_DATA_SHA}`||record.slug!=='acceptance-post'||record.title!=='Acceptance Post') { console.error('wrong candidate submit contract'); process.exitCode=1; } else console.log(JSON.stringify({submissionId:17})); }",
    "else if (verb === 'gate') { console.log(JSON.stringify({submissionId:17,state:process.env.NEON_EVAL_GATE==='block'?'blocked':'published',decision:process.env.NEON_EVAL_GATE==='block'?'unrepairable':'go',liveSeq:process.env.NEON_EVAL_GATE==='block'?null:42,published:process.env.NEON_EVAL_GATE==='block'?[]:[{dataset:'posts',key:'acceptance-post',url:'http://127.0.0.1/blog/acceptance-post'}]})); process.exitCode = process.env.NEON_EVAL_GATE==='block'?2:0; }",
    "else { console.error('unexpected content verb: '+verb); process.exitCode=1; }",
  ].join('\n') + '\n');
  fs.writeFileSync(path.join(seed, 'package.json'), '{"type":"module"}\n');
  git(seed, ['add', '.']);
  git(seed, ['commit', '-m', 'staging fixture']);
  git(seed, ['branch', '-M', 'staging']);
  git(seed, ['remote', 'add', 'origin', origin]);
  git(seed, ['push', 'origin', 'staging']);
  git(tmp, ['--git-dir', origin, 'symbolic-ref', 'HEAD', 'refs/heads/staging']);
  git(tmp, ['clone', origin, work]);
  git(work, ['config', 'user.name', 'Neon Eval']);
  git(work, ['config', 'user.email', 'neon-eval@example.invalid']);
  const candidate = { slug: 'acceptance-post', title: 'Acceptance Post', content: 'Local fixture.' };
  fs.mkdirSync(path.join(work, 'candidate'));
  fs.writeFileSync(path.join(work, 'candidate/post.json'), JSON.stringify(candidate) + '\n');
  if (extra) fs.writeFileSync(path.join(work, 'extra.txt'), 'forbidden\n');
  git(work, ['checkout', '-b', 'supervisor/blog-data-1000']);
  git(work, ['add', '.']);
  git(work, ['commit', '-m', 'candidate fixture']);
  const dataSha = git(work, ['rev-parse', 'HEAD']);
  git(work, ['push', 'origin', 'HEAD']);
  git(work, ['checkout', 'staging']);
  return { work, dataSha, candidate, files: git(work, ['diff', '--name-only', `origin/staging...${dataSha}`]).split('\n').filter(Boolean) };
}
function ingestCase({ extra = false, gate = 'pass', tamperSha = false } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'neon-eval-'));
  try {
    const fixture = cloneFixture(tmp, { extra });
    const bin = path.join(tmp, 'bin');
    fs.mkdirSync(bin);
    const ghLog = path.join(tmp, 'gh.jsonl');
    const cliLog = path.join(tmp, 'cli.jsonl');
    const fakeGh = path.join(bin, 'gh');
    fs.writeFileSync(fakeGh, [
      '#!/usr/bin/env node',
      "const fs = require('node:fs');",
      "fs.appendFileSync(process.env.NEON_EVAL_GH_LOG, JSON.stringify(process.argv.slice(2)) + '\\n');",
      "console.log('{}');",
    ].join('\n') + '\n', { mode: 0o755 });
    const payload = { ...basePayload, data_sha: tamperSha ? 'b'.repeat(40) : fixture.dataSha };
    const result = run(process.execPath, ['scripts/supervisor/ingest-db.mjs', '--payload', JSON.stringify(payload)], {
      cwd: fixture.work,
      env: { PATH: `${bin}:${process.env.PATH}`, GH_TOKEN: 'fixture-only',
        GITHUB_REPOSITORY: 'acceptance/local', LV_GITHUB_REPOSITORY: 'acceptance/local',
        CONTENT_TARGET: 'staging', CONTENT_SOURCE: 'db', NEON_EVAL_GH_LOG: ghLog,
        NEON_EVAL_CLI_LOG: cliLog, NEON_EVAL_GATE: gate, NEON_EVAL_DATA_SHA: fixture.dataSha },
    });
    const parse = (file) => fs.existsSync(file) ? readLines(file) : [];
    return { result, fixture, gh: parse(ghLog), cli: parse(cliLog) };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
function readLines(file) { return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)); }
function statusWrites(c) {
  return c.gh.filter((argv) => argv.some((part) => String(part).includes(`/statuses/${c.fixture.dataSha}`)))
    .map((argv) => argv.join(' '));
}
function hostRefusal(variables, expected) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'neon-host-refusal-'));
  try {
    const bin = path.join(tmp, 'bin');
    fs.mkdirSync(bin);
    const gitLog = path.join(tmp, 'git.log');
    fs.writeFileSync(path.join(bin, 'git'), `#!/bin/sh\nprintf '%s\\n' "$*" >> "$NEON_EVAL_GIT_LOG"\nexit 42\n`, { mode: 0o755 });
    const result = run(process.execPath, ['scripts/supervisor/cli.mjs', 'run'], {
      env: { PATH: `${bin}:${process.env.PATH}`, LV_WEEKLY_OWNER: 'exedev',
        LV_CONTENT_SHIP_ENABLED: 'true', LV_CONTENT_STORE: 'db', LV_CONTENT_TARGET: 'staging',
        LV_SITE_URL: 'http://127.0.0.1:9', LV_GITHUB_REPOSITORY: 'acceptance/local',
        LV_STATE_DIR: tmp, LV_LEDGER: path.join(tmp, 'ledger.json'),
        GITHUB_API_URL: 'http://127.0.0.1:9', GH_TOKEN: 'fixture-only',
        NEON_EVAL_GIT_LOG: gitLog, ...variables },
    });
    assert.notEqual(result.status, 0, 'unsafe mode was accepted');
    assert.match(`${result.stdout}\n${result.stderr}`, expected, 'refusal reason');
    assert(!fs.existsSync(gitLog), 'host contacted Git before refusing unsafe DB mode');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
async function monitorCase({ statuses, manifests = [], pages = [], statusDeadlineMs = 80,
  renderDeadlineMs = 80 } = {}) {
  const file = path.join(root, 'scripts/supervisor/content-monitor.mjs');
  assert(fs.existsSync(file), 'missing content-monitor.mjs');
  const module = await import(pathToFileURL(file).href);
  assert.equal(typeof module.monitorContentPublish, 'function', 'missing monitorContentPublish approved interface');
  let tick = 0;
  let statusReads = 0;
  let manifestReads = 0;
  let pageReads = 0;
  const pick = (source, index) => source[Math.min(index, source.length - 1)];
  const outcome = await module.monitorContentPublish({
    dataSha: sha, title: 'Acceptance Post', siteUrl: 'http://127.0.0.1:9',
    allowedCreator: 'operator', statusDeadlineMs, renderDeadlineMs,
    getStatuses: async (dataSha) => {
      assert.equal(dataSha, sha, 'status polled for the wrong SHA');
      assert(++statusReads <= 100, 'status polling exceeded virtual call budget');
      return pick(statuses, statusReads - 1);
    },
    getManifest: async (siteUrl) => {
      assert.equal(siteUrl, 'http://127.0.0.1:9', 'manifest polled from the wrong site');
      assert(++manifestReads <= 100, 'manifest polling exceeded virtual call budget');
      return pick(manifests, manifestReads - 1);
    },
    getPage: async (targetUrl) => {
      assert.equal(targetUrl, 'http://127.0.0.1/blog/acceptance-post', 'page target drifted');
      assert(++pageReads <= 100, 'page polling exceeded virtual call budget');
      return pick(pages, pageReads - 1);
    },
    now: () => { assert(tick <= 10_000, 'virtual clock exhausted'); return tick; },
    wait: async (ms) => { assert(ms > 0 && ms <= 60_000, `invalid wait ${ms}`); tick += ms; },
  });
  return { outcome, statusReads, manifestReads, pageReads, tick };
}
const publishStatus = (overrides = {}) => ({
  context: 'content/publish', state: 'success', creator: { login: 'operator' },
  description: 'published:17:seq:42', target_url: 'http://127.0.0.1/blog/acceptance-post',
  created_at: '2026-09-27T00:00:02Z', sha, ...overrides,
});
const snapshot = (liveSeq, deploymentUrl = 'https://preview.invalid/deployment-1') =>
  ({ live_seq: liveSeq, deployment_url: deploymentUrl });

check('M1', 'new evaluator hash matches the only owned source', () => {
  const lines = read(manifest).split('\n').filter((line) => /^[0-9a-f]{64}  /.test(line));
  assert.deepEqual(lines, [`${digest(rel)}  ${rel}`]);
});
check('L1', 'legacy payload and git diff remain accepted', () => {
  const legacy = Object.fromEntries(Object.entries(basePayload).filter(([key]) => !['store', 'target'].includes(key)));
  expectValid(legacy);
  assert.equal(contract.validateIngestDiff(['data/posts.json']).ok, true);
});
check('C1', 'DB payload requires target and refuses extra, malformed or cross-target fields', () => {
  expectValid(basePayload);
  expectValid({ ...basePayload, target: 'production' });
  for (const payload of [
    { ...basePayload, target: undefined }, { ...basePayload, target: 'other' },
    { ...basePayload, store: 'other' }, { ...basePayload, data_sha: 'short' },
    { ...basePayload, data_branch: 'other/branch' }, { ...basePayload, files: ['candidate/post.json'] },
  ]) expectInvalid(payload);
});
check('C2', 'DB candidate diff is exactly candidate/post.json', () => {
  assert.equal(typeof contract.validateDbIngestDiff, 'function', 'missing validateDbIngestDiff');
  assert.equal(contract.validateDbIngestDiff(['candidate/post.json']).ok, true);
  for (const files of [[], ['data/posts.json'], ['candidate/post.json', 'extra.txt'], ['candidate/post.json', 'candidate/post.json']])
    assert.equal(contract.validateDbIngestDiff(files).ok, false, `unsafe diff accepted: ${files}`);
});
check('C3', 'production repository dispatch and staging workflow dispatch are isolated', () => {
  const prod = { ...basePayload, target: 'production' };
  assert.deepEqual(contract.repositoryDispatchBody(prod).client_payload, prod);
  assert.throws(() => contract.repositoryDispatchBody(basePayload));
  assert.equal(typeof contract.workflowDispatchBody, 'function', 'missing workflowDispatchBody');
  assert.deepEqual(contract.workflowDispatchBody(basePayload), { ref: 'staging', inputs: { payload: JSON.stringify(basePayload) } });
});
check('L2', 'ledger accepts live and propagation terminals, retaining existing terminal behavior', () => {
  for (const terminal of ['PUBLISHED_LIVE', 'BLOCKED_PROPAGATION', 'INGEST_FAILED', 'PUBLISHED_MAIN']) {
    assert(TERMINALS.includes(terminal), `missing ${terminal}`);
    assert.equal(terminalizeRun({ run_id: 'fixture' }, terminal).terminal, terminal);
  }
});
check('F1', 'isolated local Git fixture has an exact candidate SHA and detects a second file', () => {
  for (const extra of [false, true]) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'neon-fixture-check-'));
    try {
      const fixture = cloneFixture(tmp, { extra });
      assert.match(fixture.dataSha, /^[0-9a-f]{40}$/);
      assert.deepEqual(fixture.files, extra ? ['candidate/post.json', 'extra.txt'] : ['candidate/post.json']);
      assert.equal(git(fixture.work, ['show', `${fixture.dataSha}:candidate/post.json`]).trim(),
        JSON.stringify(fixture.candidate));
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
});
check('H1', 'host DB lane and monitor implementation are wired into the documented CLI path', () => {
  assert(fs.existsSync(path.join(root, 'scripts/supervisor/content-monitor.mjs')), 'missing content-monitor.mjs');
  assert(fs.existsSync(path.join(root, 'scripts/supervisor/ingest-db.mjs')), 'missing ingest-db.mjs');
  const host = read('scripts/supervisor/host-run.mjs');
  const cli = read('scripts/supervisor/cli.mjs');
  assert.match(host, /LV_CONTENT_STORE/);
  assert.match(host, /LV_INGEST_TRANSPORT/);
  assert.match(host, /content-monitor/);
  assert.match(cli, /PUBLISHED_LIVE/);
  assert.match(cli, /BLOCKED_PROPAGATION/);
});
check('H2', 'host rejects local transport, bypass and custom creator on production before Git', () => {
  hostRefusal({ LV_CONTENT_TARGET: 'production', LV_INGEST_TRANSPORT: 'local' }, /local.*staging|staging.*local/i);
  hostRefusal({ LV_CONTENT_TARGET: 'production', LV_SITE_BYPASS: 'fixture' }, /bypass.*production|production.*bypass/i);
  hostRefusal({ LV_CONTENT_TARGET: 'production', LV_STATUS_CREATOR: 'operator' }, /creator.*staging|staging.*creator/i);
});
check('H3', 'host refuses staging without bypass before Git', () => {
  hostRefusal({ LV_CONTENT_TARGET: 'staging', LV_INGEST_TRANSPORT: 'local' }, /bypass/i);
});
check('H4', 'host-local path starts detached ingest with a durable log and DB candidate artifact', () => {
  const host = read('scripts/supervisor/host-run.mjs');
  for (const [needle, label] of [
    [/candidate\/post\.json/, 'candidate artifact'], [/ingest-db\.mjs/, 'real ingest script'],
    [/detached\s*:\s*true/, 'detached process'], [/\.unref\s*\(/, 'detached child release'],
    [/ingest-.*\.log/, 'ingest log'],
  ]) assert.match(host, needle, `missing ${label}`);
});
await checkAsync('P1', 'trusted success waits for fresh snapshot and GET 200 containing title', async () => {
  const c = await monitorCase({
    statuses: [[publishStatus({ state: 'pending', description: 'pending', target_url: null })], [publishStatus()]],
    manifests: [snapshot(41), snapshot(42), snapshot(42)],
    pages: [{ status: 503, text: 'Deploying' }, { status: 200, text: '<title>Acceptance Post</title>' }],
    statusDeadlineMs: 120_000, renderDeadlineMs: 120_000,
  });
  assert.equal(c.outcome.state, 'PUBLISHED_LIVE');
  assert.equal(c.outcome.targetUrl, 'http://127.0.0.1/blog/acceptance-post');
  assert.equal(c.outcome.liveSeq, 42);
  assert(c.manifestReads >= 2, 'fresh snapshot was not observed');
  assert(c.pageReads >= 2, 'page 200/title was not observed');
});
await checkAsync('P2', 'spoofed creator, wrong SHA, wrong context and older success cannot publish', async () => {
  const c = await monitorCase({ statuses: [[
    publishStatus({ creator: { login: 'attacker' } }),
    publishStatus({ sha: 'b'.repeat(40) }),
    publishStatus({ context: 'automation/ci' }),
    publishStatus({ created_at: '2026-09-26T00:00:00Z' }),
    publishStatus({ state: 'pending', description: 'pending', target_url: null,
      created_at: '2026-09-27T00:00:03Z' }),
  ]], statusDeadlineMs: 40 });
  assert.equal(c.outcome.state, 'MONITOR_TIMEOUT');
  assert.equal(c.pageReads, 0, 'untrusted status reached page probe');
});
await checkAsync('P3', 'ingest error status maps to INGEST_FAILED without page probe', async () => {
  const c = await monitorCase({ statuses: [[publishStatus({ state: 'failure',
    description: 'ingest-error:diff', target_url: null })]] });
  assert.equal(c.outcome.state, 'INGEST_FAILED');
  assert.equal(c.pageReads, 0);
});
await checkAsync('P4', 'gate decision failure stays blocked and unpublished', async () => {
  const c = await monitorCase({ statuses: [[publishStatus({ state: 'failure',
    description: 'decision=unrepairable submission=17', target_url: null })]] });
  assert.equal(c.outcome.state, 'BLOCKED_UNREPAIRABLE');
  assert.equal(c.manifestReads, 0);
  assert.equal(c.pageReads, 0);
});
await checkAsync('P5', 'status timeout and propagation timeout have distinct terminals', async () => {
  const status = await monitorCase({ statuses: [[]], statusDeadlineMs: 40 });
  assert.equal(status.outcome.state, 'MONITOR_TIMEOUT');
  const pending = await monitorCase({ statuses: [[publishStatus({ state: 'pending',
    description: 'pending', target_url: null })]], statusDeadlineMs: 40 });
  assert.equal(pending.outcome.state, 'MONITOR_TIMEOUT');
  const stale = await monitorCase({ statuses: [[publishStatus()]], manifests: [snapshot(41)],
    pages: [{ status: 200, text: '<title>Acceptance Post</title>' }], renderDeadlineMs: 40 });
  assert.equal(stale.outcome.state, 'BLOCKED_PROPAGATION');
  assert.equal(stale.pageReads, 0, 'stale snapshot allowed a page success');
  const missingTitle = await monitorCase({ statuses: [[publishStatus()]], manifests: [snapshot(42)],
    pages: [{ status: 200, text: '<title>Other Post</title>' }], renderDeadlineMs: 40 });
  assert.equal(missingTitle.outcome.state, 'BLOCKED_PROPAGATION');
});
await checkAsync('P6', 'unstable deployment identity cannot establish PUBLISHED_LIVE', async () => {
  const c = await monitorCase({ statuses: [[publishStatus()]],
    manifests: Array.from({ length: 100 }, (_, i) => snapshot(42, `https://preview.invalid/deployment-${i}`)),
    pages: [{ status: 200, text: '<title>Acceptance Post</title>' }], renderDeadlineMs: 40 });
  assert.equal(c.outcome.state, 'BLOCKED_PROPAGATION');
});
check('I1', 'local ingest validates exact SHA/diff, submits candidate and posts pending then success', () => {
  assert(fs.existsSync(path.join(root, 'scripts/supervisor/ingest-db.mjs')), 'missing ingest-db.mjs');
  const c = ingestCase();
  assert.equal(c.result.status, 0, c.result.stderr);
  assert.deepEqual(c.fixture.files, ['candidate/post.json']);
  const calls = c.cli.map((args) => args[0]);
  assert.deepEqual(calls, ['export', 'submit', 'gate']);
  assert(c.cli[1].includes('--record-file') && c.cli[1].includes('--baseline'));
  const statuses = statusWrites(c);
  assert(statuses.length >= 2 && /pending/.test(statuses[0]) && /success/.test(statuses.at(-1)), `status order: ${statuses}`);
  assert(statuses.at(-1).includes('target_url'), 'success lacks live URL');
  assert(statuses.at(-1).includes('published:17:seq:42'), 'success lacks submission and live sequence binding');
  assert(c.gh.filter((argv) => argv.join(' ').includes('/statuses/')).every((argv) =>
    argv.join(' ').includes(`/statuses/${c.fixture.dataSha}`)), 'status posted on another SHA');
});
check('I2', 'second candidate file fails diff before submit and posts ingest-error:diff', () => {
  assert(fs.existsSync(path.join(root, 'scripts/supervisor/ingest-db.mjs')), 'missing ingest-db.mjs');
  const c = ingestCase({ extra: true });
  assert.deepEqual(c.fixture.files, ['candidate/post.json', 'extra.txt']);
  assert(!c.cli.some((args) => args[0] === 'submit'), 'invalid candidate reached submit');
  assert(statusWrites(c).some((status) => /failure/.test(status) && /ingest-error:diff/.test(status)), c.result.stderr);
});
check('I3', 'branch SHA mismatch fails before submit and never reports success', () => {
  assert(fs.existsSync(path.join(root, 'scripts/supervisor/ingest-db.mjs')), 'missing ingest-db.mjs');
  const c = ingestCase({ tamperSha: true });
  assert(!c.cli.some((args) => args[0] === 'submit'), 'wrong SHA reached submit');
  assert(c.gh.some((argv) => /failure/.test(argv.join(' ')) && /ingest-error:/.test(argv.join(' '))),
    'wrong SHA did not post ingest failure');
  assert(!c.gh.some((argv) => /success/.test(argv.join(' '))), 'wrong SHA reported success');
});
check('I4', 'terminal gate rejection remains unpublished and posts failure decision', () => {
  assert(fs.existsSync(path.join(root, 'scripts/supervisor/ingest-db.mjs')), 'missing ingest-db.mjs');
  const c = ingestCase({ gate: 'block' });
  assert(c.cli.some((args) => args[0] === 'gate'), 'gate never ran');
  assert(statusWrites(c).some((status) => /failure/.test(status) && /decision=unrepairable/.test(status)), c.result.stderr);
  assert(!statusWrites(c).some((status) => /success/.test(status)), 'blocked gate reported success');
});

for (const item of checks) console.log(`${item.result} ${item.id} ${item.name}${item.reason ? `: ${item.reason}` : ''}`);
console.log(JSON.stringify({ gate: 'provisional-neon-s11a-local', passed: checks.filter((c) => c.result === 'PASS').length,
  red: checks.filter((c) => c.result === 'RED').map((c) => c.id), githubTriggerCovered: false }));
if (checks.some((c) => c.result === 'RED')) process.exitCode = 1;
