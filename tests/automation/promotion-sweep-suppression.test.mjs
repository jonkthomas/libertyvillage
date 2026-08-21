// F10. The promotion sweep is the only thing that notices `main` stranded behind
// `staging`. It stood down whenever *any* coordinator dispatch had happened
// recently — and ordinary blog/SEO/news generator dispatches happen several times a
// week, so normal generator activity could suppress the sweep indefinitely.
//
// A promotion dispatch and a generator dispatch are told apart by the run's job
// graph: a promotion run executes `validate-promotion`, a generator run skips it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  isPromotionCoordinatorRun, planPromotionSweep, selectRecentDispatchRuns,
  SWEEP_MIN_DISPATCH_INTERVAL_HOURS,
} from '../../scripts/automation/recovery.mjs';

const SWEEP_SRC = fs.readFileSync(new URL('../../scripts/automation/promotion-sweep.mjs', import.meta.url), 'utf8');
const SHA = 'a'.repeat(40);
const NOW = Date.parse('2026-09-20T11:00:00.000Z');
const hoursAgo = (hours) => new Date(NOW - hours * 3600_000).toISOString();

const generatorJobs = [
  { name: 'validate-generator', status: 'completed', conclusion: 'success' },
  { name: 'generator-ci', status: 'completed', conclusion: 'success' },
  { name: 'validate-promotion', status: 'completed', conclusion: 'skipped' },
  { name: 'prepare-promotion', status: 'completed', conclusion: 'skipped' },
  { name: 'validate-promotion-pr', status: 'completed', conclusion: 'skipped' },
];
const promotionJobs = [
  { name: 'validate-generator', status: 'completed', conclusion: 'skipped' },
  { name: 'validate-promotion', status: 'completed', conclusion: 'success' },
  { name: 'prepare-promotion', status: 'completed', conclusion: 'success' },
];

test('a generator dispatch is not a promotion dispatch', () => {
  assert.equal(isPromotionCoordinatorRun(generatorJobs), false,
    'a blog/SEO/news dispatch must never count as a promotion already in flight');
  assert.equal(isPromotionCoordinatorRun(promotionJobs), true);
  assert.equal(isPromotionCoordinatorRun([{ name: 'validate-promotion', status: 'in_progress', conclusion: null }]), true,
    'a promotion still running is very much in flight');
  assert.equal(isPromotionCoordinatorRun([]), false);
  assert.equal(isPromotionCoordinatorRun(null), false);
});

test('only runs inside the suppression window are inspected, newest first and capped', () => {
  const runs = [
    { id: 1, created_at: hoursAgo(0.5) },
    { id: 2, created_at: hoursAgo(2) },
    { id: 3, created_at: hoursAgo(SWEEP_MIN_DISPATCH_INTERVAL_HOURS + 1) },
    { id: 4, created_at: 'not-a-date' },
  ];
  const selected = selectRecentDispatchRuns(runs, { now: NOW });
  assert.deepEqual(selected.map((run) => run.id), [1, 2], 'stale and unparseable runs are out of scope');
  assert.equal(selectRecentDispatchRuns(runs, { now: NOW, limit: 1 }).length, 1, 'one tick may not fan out over history');
  assert.throws(() => selectRecentDispatchRuns(runs, {}), /explicit clock/);
});

test('weeks of generator activity cannot suppress a genuinely stranded promotion', () => {
  // Two blog dispatches an hour ago; main has been 3 commits behind for 30h.
  const lastPromotionDispatchAt = null; // no promotion dispatch found in the window
  const plan = planPromotionSweep({
    aheadBy: 3, stagingHeadAt: hoursAgo(30), openPromotionPrs: [],
    lastDispatchAt: lastPromotionDispatchAt, stagingSha: SHA, now: NOW,
  });
  assert.equal(plan.action, 'dispatch', 'the sweep must still fire; generator runs are not promotion runs');
  assert.equal(plan.sha, SHA);
});

test('a real recent promotion dispatch still stands the sweep down', () => {
  const plan = planPromotionSweep({
    aheadBy: 3, stagingHeadAt: hoursAgo(30), openPromotionPrs: [],
    lastDispatchAt: hoursAgo(0.5), stagingSha: SHA, now: NOW,
  });
  assert.equal(plan.action, 'skip');
  assert.match(plan.reason, /already dispatched/);
});

test('the sweep script asks the promotion-specific question and fails closed on unreadable history', () => {
  assert.match(SWEEP_SRC, /lastPromotionDispatchAt/, 'the sweep must look for a PROMOTION dispatch specifically');
  assert.match(SWEEP_SRC, /isPromotionCoordinatorRun\(/, 'the distinction must be the executed one, not a comment');
  assert.doesNotMatch(SWEEP_SRC, /lastCoordinatorDispatchAt/, 'the any-dispatch suppression must be gone');
  assert.match(SWEEP_SRC, /actions\/runs\/\$\{run\.id\}\/jobs/, 'the job graph is the evidence');
  assert.match(SWEEP_SRC, /treating this tick as already dispatched/, 'unknown history must still fail closed');
  assert.match(SWEEP_SRC, /GITHUB_STEP_SUMMARY/, 'every tick must leave durable evidence of what it saw');
});
