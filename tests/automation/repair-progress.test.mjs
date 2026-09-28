// Production wiring for repair convergence (F4): the review agent reads the
// durable audit history and asks the convergence question, and every recovery
// export still has a production caller. The coordinator `audit` CLI replays and
// the autonomous-coordinator workflow gates were removed with them in r7.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const REVIEW_AGENT = fs.readFileSync(new URL('../../scripts/automation/review-agent.mjs', import.meta.url), 'utf8');

test('evaluateRepairProgress has a real production caller before the fixer is dispatched', () => {
  assert.match(REVIEW_AGENT, /routeFailedGate\(/, 'review-agent must apply the weekly failed-gate policy');
  assert.match(REVIEW_AGENT, /evaluateRepairRound\(/, 'review-agent must apply the weekly repair-round policy');
  const reviewFn = REVIEW_AGENT.slice(REVIEW_AGENT.indexOf('async function review('), REVIEW_AGENT.indexOf('async function reviewContent'));
  assert.match(reviewFn, /buildRepairHistory\(/, 'the ordered history must come from the durable audit evidence');
  assert.match(reviewFn, /evaluateRepairRound\(/, 'the gate job must ask the convergence question');
  assert.match(reviewFn, /routeFailedGate\(/, 'sub-8 zero-blocker routing must happen in the gate job');
  assert.match(reviewFn, /converging/, 'the answer must reach the workflow as a step output');
  assert.match(reviewFn, /repairable = routing\.action === 'dispatch-fixer'/,
    'only high/critical blocking findings may dispatch the fixer');
  assert.ok(
    reviewFn.indexOf('evaluateRepairRound(') < reviewFn.indexOf("writeOutput({\n    review_ok:"),
    'the decision must be made before the review job reports its outputs',
  );
});

test('the repo has no orphaned recovery exports left unwired', () => {
  const recovery = fs.readFileSync(new URL('../../scripts/automation/recovery.mjs', import.meta.url), 'utf8');
  const sources = [
    recovery,
    REVIEW_AGENT,
    fs.readFileSync(new URL('../../scripts/automation/promotion-sweep.mjs', import.meta.url), 'utf8'),
    fs.readFileSync(new URL('../../scripts/automation/candidate-state.mjs', import.meta.url), 'utf8'),
  ].join('\n');
  for (const [, name] of recovery.matchAll(/^export function ([A-Za-z0-9_]+)/gm)) {
    assert.ok(sources.includes(`${name}(`), `recovery.${name} is exported but never called in production code`);
  }
});
