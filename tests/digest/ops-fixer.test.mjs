// Slice C: autonomous ops fixer (ops/ops-fixer) and the digest's
// "What the agent fixed" section.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALLOWLIST, classify, planPass, unitFor } from '../../ops/ops-fixer/policy.mjs';
import { runPass, readHistory, readRuns } from '../../ops/ops-fixer/fixer.mjs';
import { buildModel, slackMessage } from '../../ops/weekly-digest/lib/digest.mjs';
import { renderHtml } from '../../ops/weekly-digest/lib/render.mjs';
import { fixerView } from '../../ops/weekly-digest/lib/fixer-section.mjs';
import { parseFixerActions, fetchFixItIssues } from '../../ops/weekly-digest/lib/fetchers.mjs';
import { JOBS } from '../../ops/exedev-runner/runner.mjs';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(dirname, '..', '..');
const NOW = '2026-10-26T14:50:00.000Z';
const ALL_JOBS = ['topic-discovery', 'discover-businesses', 'news', 'weekly-growth-report', 'weekly-blog', 'october-blog-backfill'];

const failed = (job, error, { at = '2026-10-26T11:00:00.000Z', target = 'production', slot = '202610261100-scheduled' } = {}) => ({
  file: `${job}-${target}-${slot}.jsonl`, job, target, slot, startedAt: at, outcome: 'failure', error,
});
const pass = (overrides = {}) => planPass({ runs: [], history: [], now: NOW, enabledJobs: ALL_JOBS, ...overrides });

test('every whitelisted code maps to its allowlisted action and the unit its timer starts', () => {
  const units = { 'rerun-job': 'weekly-blog', 'next-topic': 'weekly-blog', 'retry-deploy': 'deploy-retry' };
  for (const [code, entry] of Object.entries(ALLOWLIST)) {
    const run = code === 'no terminal event'
      ? { ...failed('weekly-blog', null), outcome: 'incomplete', at: undefined, startedAt: '2026-10-26T06:00:00.000Z' }
      : failed('weekly-blog', code);
    const { act } = pass({ runs: [run] });
    assert.ok(act, `${code} should act`);
    assert.equal(act.action, entry.action, code);
    assert.equal(act.code, code);
    assert.equal(unitFor(act), `lv-runner@${units[entry.action]}:production:scheduled.service`, code);
  }
  // Raw runner forms normalize onto the same entries.
  assert.equal(pass({ runs: [failed('weekly-blog', 'blog-lint:unrecorded-business')] }).act.action, 'next-topic');
  assert.equal(pass({ runs: [failed('news', 'cli-network')] }).act.action, 'rerun-job');
  assert.equal(pass({ runs: [failed('news', 'cli-network')] }).act.unitJob, 'news');
});

test('a bad topic is only swapped on the weekly blog; other jobs are left alone', () => {
  assert.equal(classify('unsupported-grounding', 'weekly-blog').action, 'next-topic');
  const plan = pass({ runs: [failed('october-blog-backfill', 'unsupported-grounding')] });
  assert.equal(plan.act, null);
  assert.deepEqual(plan.records, []);
});

test('unknown failures and code bugs go to the fix-it agent path: logged, never acted on', () => {
  for (const code of ['something-new-and-strange', 'operational-error', 'cli-target', 'cli-state', 'invalid-json']) {
    const plan = pass({ runs: [failed('weekly-blog', code)] });
    assert.equal(plan.act, null, code);
    assert.equal(plan.records.length, 1, code);
    assert.equal(plan.records[0].decision, 'escalated', code);
  }
  // Known codes that need John (or nothing) are neither acted on nor escalated.
  for (const code of ['cli-schema', 'runner hold active', 'cli-claim', 'cadence content deficit']) {
    assert.deepEqual(pass({ runs: [failed('weekly-blog', code)] }), { records: [], act: null }, code);
  }
});

test('retry budget stops repeats: daily budget waits, a spent weekly budget hands over once', () => {
  const run = failed('weekly-blog', 'cli-network');
  const prior = (at, file) => ({ at, run: file, decision: 'acted', code: 'cli-network', job: 'weekly-blog', unitJob: 'weekly-blog' });
  // One retry already today: no action, no record (tomorrow may retry).
  const today = pass({ runs: [run], history: [prior('2026-10-26T02:00:00.000Z', 'a.jsonl')] });
  assert.equal(today.act, null);
  assert.deepEqual(today.records, []);
  // Three this week (weekly budget 3): stop and hand over to the fix-it agent.
  const week = ['2026-10-21T02:00:00.000Z', '2026-10-23T02:00:00.000Z', '2026-10-24T02:00:00.000Z'].map((at, i) => prior(at, `w${i}.jsonl`));
  const spent = pass({ runs: [run], history: week });
  assert.equal(spent.act, null);
  assert.equal(spent.records[0].decision, 'budget-exhausted');
  assert.equal(spent.records[0].tries, 3);
  // The same failed run is never handled twice (idempotent).
  assert.deepEqual(pass({ runs: [run], history: [...week, spent.records[0]] }).records, []);
  assert.deepEqual(pass({ runs: [run], history: [{ ...prior('2026-10-26T12:00:00.000Z', run.file) }] }).act, null);
});

test('guards: hold switch, busy runner, timer off, settled or old failures, one action per pass', () => {
  const run = failed('weekly-blog', 'cli-server');
  assert.equal(pass({ runs: [run], held: true }).act, null);
  assert.equal(pass({ runs: [run], busy: true }).act, null);
  assert.equal(pass({ runs: [run], enabledJobs: ['news'] }).act, null);
  assert.equal(pass({ runs: [failed('weekly-blog', 'cli-server', { target: 'staging' })] }).act, null);
  assert.equal(pass({ runs: [failed('weekly-blog', 'cli-server', { at: '2026-10-22T11:00:00.000Z' })] }).act, null);
  const later = { ...run, file: 'later.jsonl', startedAt: '2026-10-26T12:00:00.000Z', outcome: 'success', error: null };
  assert.equal(pass({ runs: [run, later] }).act, null);
  const two = pass({ runs: [run, failed('news', 'cli-network', { at: '2026-10-26T12:17:00.000Z' })] });
  assert.equal(two.records.filter((r) => r.decision === 'acted').length, 1);
});

function deps(overrides = {}) {
  const started = [];
  return {
    started,
    deps: {
      now: () => NOW, history: () => [], enabledJobs: () => ALL_JOBS, held: () => false, busy: () => false,
      runs: () => [failed('weekly-blog', 'smoke-timeout'), failed('news', 'mystery-code', { at: '2026-10-26T12:17:00.000Z' })],
      start: (unit) => { started.push(unit); return { status: 0 }; },
      ...overrides,
    },
  };
}

test('dry run performs nothing: no unit started, no log written', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-fixer-'));
  const logFile = path.join(dir, 'actions.jsonl');
  const { started, deps: d } = deps();
  const result = runPass({ apply: false, logFile, deps: d });
  assert.equal(result.dryRun, true);
  assert.equal(result.act.action, 'retry-deploy'); // the plan is still shown
  assert.deepEqual(started, []);
  assert.equal(fs.existsSync(logFile), false);
});

test('every decision is logged durably with who/what/why/result, and the log feeds the next pass', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-fixer-'));
  const logFile = path.join(dir, 'actions.jsonl');
  const { started, deps: d } = deps();
  runPass({ apply: true, logFile, deps: d });
  assert.deepEqual(started, ['lv-runner@deploy-retry:production:scheduled.service']);
  const log = readHistory(logFile);
  assert.equal(log.length, 2);
  const acted = log.find((r) => r.decision === 'acted');
  assert.equal(acted.actor, 'lv-ops-fixer');
  assert.equal(acted.action, 'retry-deploy');
  assert.equal(acted.why, 'Post saved but not showing on the site yet');
  assert.equal(acted.result, 'started');
  assert.equal(acted.unit, 'lv-runner@deploy-retry:production:scheduled.service');
  assert.equal(log.find((r) => r.decision === 'escalated').code, 'mystery-code');
  // Second pass over the same failures: nothing new (idempotent), nothing started.
  const again = deps({ history: () => readHistory(logFile) });
  runPass({ apply: true, logFile, deps: again.deps });
  assert.deepEqual(again.started, []);
  assert.equal(readHistory(logFile).length, 2);
  // A unit that fails to start is logged as such.
  const broken = deps({ start: () => ({ status: 1 }), runs: () => [failed('news', 'cli-server')] });
  runPass({ apply: true, logFile, deps: broken.deps });
  assert.equal(readHistory(logFile).at(-1).result, 'failed-to-start');
});

test('readRuns parses runner JSONL from the log directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-fixer-logs-'));
  fs.writeFileSync(path.join(dir, 'news-production-202610261217-scheduled.jsonl'),
    '{"at":"2026-10-26T12:17:01Z","event":"start","job":"news","target":"production","slot":"202610261217-scheduled"}\n{"at":"2026-10-26T12:18:00Z","event":"failure","error":"cli-network","action":"retry-original-slot"}\n');
  const runs = readRuns(dir, new Date().toISOString());
  assert.equal(runs.length, 1);
  assert.equal(pass({ runs }).act.action, 'rerun-job');
});

test('runner has the on-demand deploy-retry job the fixer starts', () => {
  assert.deepEqual(JOBS['deploy-retry'], { calendar: null, kind: null });
  const launcher = fs.readFileSync(path.join(repoRoot, 'ops/exedev-runner/launcher.sh'), 'utf8');
  assert.equal(launcher.match(/\|deploy-retry\|weekly-roundup\)/g)?.length, 2);
  const runner = fs.readFileSync(path.join(repoRoot, 'ops/exedev-runner/runner.mjs'), 'utf8');
  assert.match(runner, /job === 'deploy-retry'[\s\S]{0,200}cli\(\['deploy', '--target', target\], repo, \[3\]\)/);
  // The fixer never enables its own timer.
  const install = fs.readFileSync(path.join(repoRoot, 'ops/ops-fixer/install-vm.sh'), 'utf8');
  assert.doesNotMatch(install, /systemctl (enable|start)/);
});

const fixtureActions = () => parseFixerActions(fs.readFileSync(path.join(dirname, 'fixtures', 'ops-fixer-actions.jsonl'), 'utf8'), '2026-10-19T12:00:00.000Z');

function fixerModel() {
  const runs = [
    { job: 'weekly-blog', target: 'production', slot: 'a', startedAt: '2026-10-22T14:50:05.000Z', outcome: 'success', file: 'a' },
    { job: 'deploy-retry', target: 'production', slot: 'b', startedAt: '2026-10-24T17:50:06.000Z', outcome: 'failure', error: 'publish or propagation pending', file: 'b' },
  ];
  return buildModel({
    generatedAt: NOW, window: { from: '2026-10-19T12:00:00.000Z', to: '2026-10-26T12:00:00.000Z' }, runs, posted: [],
    queue: { held: false, timers: [] }, gsc: { source: 'unavailable', weeks: [] },
    fixer: { actions: fixtureActions(), issues: [{ number: 231, title: '[digest] News run crashed', url: 'https://github.com/jonkthomas/libertyvillage/issues/231', state: 'OPEN', createdAt: '2026-10-20T14:00:00Z' }] },
  });
}

test('parseFixerActions keeps well-formed records in the window and drops torn lines', () => {
  const actions = fixtureActions();
  assert.equal(actions.length, 3);
  assert.deepEqual(actions.map((a) => a.decision), ['acted', 'escalated', 'acted']);
});

test('digest renders "What the agent fixed" from fixture data, in plain English', () => {
  const model = fixerModel();
  const v = fixerView(model);
  assert.deepEqual(v.acted.map((a) => [a.what, a.result]), [
    ['Weekly blog post: draft made claims the sources do not back. Ran it again with the next topic.', 'It worked.'],
    ['Weekly blog post: site rebuild did not start. Retried the site rebuild.', 'It failed again.'],
  ]);
  assert.equal(v.handedOver[0].what, 'Daily news check: unexpected technical error. Not a known safe fix, so the fix-it agent looks at it.');
  const html = renderHtml(model);
  assert.match(html, /<h2>What the agent fixed<\/h2>/);
  assert.match(html, /Ran it again with the next topic\. <b>It worked\.<\/b>/);
  assert.match(html, /href="https:\/\/github\.com\/jonkthomas\/libertyvillage\/issues\/231">#231 \[digest\] News run crashed<\/a> \(open\)/);
  assert.doesNotMatch(html, /unsupported-grounding|operational-error|retry-deploy/); // no raw codes
  assert.match(slackMessage(model), /^What the agent fixed: 2 automatic fixes, 1 worked; 1 sent to the fix-it agent; 1 issue filed\.$/m);
  // A quiet week says so on the page and adds nothing to Slack.
  const quiet = buildModel({ ...fixerModelArgs(), fixer: null });
  assert.match(renderHtml(quiet), /Nothing needed fixing this week\./);
  assert.doesNotMatch(slackMessage(quiet), /What the agent fixed/);
});

function fixerModelArgs() {
  return { generatedAt: NOW, window: { from: '2026-10-19T12:00:00.000Z', to: '2026-10-26T12:00:00.000Z' }, runs: [], posted: [], queue: { held: false, timers: [] }, gsc: { source: 'unavailable', weeks: [] } };
}

test('fetchFixItIssues lists lv-digest-agent issues created in the window', async () => {
  let seen;
  const exec = (bin, args) => { seen = [bin, ...args]; return JSON.stringify([
    { number: 1, title: 'old', url: 'https://github.com/x/y/issues/1', state: 'OPEN', createdAt: '2026-10-18T00:00:00Z' },
    { number: 2, title: 'new', url: 'https://github.com/x/y/issues/2', state: 'OPEN', createdAt: '2026-10-21T00:00:00Z' },
  ]); };
  const issues = await fetchFixItIssues('2026-10-19T12:00:00.000Z', { exec });
  assert.deepEqual(issues.map((i) => i.number), [2]);
  assert.ok(seen.includes('lv-digest-agent') && seen.includes('created:>=2026-10-19'));
});
