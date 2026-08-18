import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow = fs.readFileSync(new URL('../../.github/workflows/autonomous-coordinator.yml', import.meta.url), 'utf8');
const sentinel = fs.readFileSync(new URL('../../.github/workflows/blocked-sentinel.yml', import.meta.url), 'utf8');
const reviewAgent = fs.readFileSync(new URL('../../scripts/automation/review-agent.mjs', import.meta.url), 'utf8');
const preflight = fs.readFileSync(new URL('../../scripts/automation/news-preflight.mjs', import.meta.url), 'utf8');

test('coordinator is dispatch-only and synthetic merge checkouts fetch parent history', () => {
  assert.doesNotMatch(workflow, /workflow_call|inputs\./);
  const mergeCheckouts = [...workflow.matchAll(/ref: refs\/pull\/[^\n]+\/merge\n\s+fetch-depth: 0/g)];
  assert.equal(mergeCheckouts.length, 2);
});

test('news-pilot safety regressions gate generator and promotion CI', () => {
  const commands = workflow.match(/- run: npm run test:news-pilot/g) || [];
  assert.equal(commands.length, 2, 'generator and promotion CI must both run news safety tests');
  const generator = workflow.slice(
    workflow.indexOf('  generator-ci:'),
    workflow.indexOf('  generator-ci-status:'),
  );
  const promotion = workflow.slice(
    workflow.indexOf('  promotion-ci:'),
    workflow.indexOf('  promotion-ci-status:'),
  );
  assert.match(generator, /npm run test:news-pilot/);
  assert.match(promotion, /npm run test:news-pilot/);
});

test('every autonomous generator kind has an independent review lens', () => {
  for (const kind of ['seo', 'blog', 'news', 'business', 'promotion']) {
    assert.match(reviewAgent, new RegExp(`\\n  ${kind}: \\[`), `missing ${kind} review lens`);
  }
});

test('preflight reuses canonical models and content commands avoid GitHub APIs', () => {
  assert.match(preflight, /from '\.\/constants\.mjs'/);
  assert.match(preflight, /GATE_MODEL/); assert.match(preflight, /FIXER_MODEL/);
  assert.match(preflight, /MAX_REPAIRS/); assert.match(preflight, /SCORE_THRESHOLD/);
  assert.equal((reviewAgent.match(/\n  news: \[/g) || []).length, 1);
  const contentCommands = reviewAgent.slice(reviewAgent.indexOf('async function reviewContent'), reviewAgent.indexOf('async function fileAtSha'));
  assert.doesNotMatch(contentCommands, /github\(/);
});

test('repair attempt is consumed before fixer push and redispatch', () => {
  // Scoped to the repair job: the heal job carries its own push and budget label.
  const repairJob = workflow.slice(workflow.indexOf('  apply-generator-repair:'), workflow.indexOf('  pass-generator:'));
  const persist = repairJob.indexOf('coordinator.mjs set-attempt');
  const push = repairJob.indexOf('git push origin "HEAD:$HEAD_REF"');
  const redispatch = repairJob.indexOf('coordinator.mjs dispatch', push);
  assert.ok(persist >= 0, 'missing attempt persistence');
  assert.ok(persist < push, 'attempt must be persisted before push');
  assert.ok(push < redispatch, 'redispatch must use the pushed repair SHA');
  assert.match(repairJob.slice(persist, push), /NEXT_ATTEMPT/);
  assert.match(repairJob.slice(persist, push), /ls-remote/);
});

test('base heal consumes its budget before pushing an unforced merge and redispatches the healed SHA', () => {
  const healJob = workflow.slice(workflow.indexOf('  heal-generator-base:'), workflow.indexOf('  generator-review:'));
  assert.match(healJob, /if: \$\{\{ always\(\) && needs\.validate-generator\.outputs\.trusted == 'true' && needs\.generator-ci\.result == 'failure' && needs\.validate-generator\.outputs\.can_heal == 'true' \}\}/);
  const persist = healJob.indexOf('coordinator.mjs set-heal');
  const push = healJob.indexOf('git push origin "HEAD:$HEAD_REF"');
  const redispatch = healJob.indexOf('coordinator.mjs dispatch', push);
  assert.ok(persist >= 0 && persist < push, 'heal budget must be consumed before push');
  assert.ok(push < redispatch, 'redispatch must use the pushed heal SHA');
  assert.equal((healJob.match(/ls-remote/g) || []).length, 2, 'both the label bump and the push recheck the remote head');
  assert.doesNotMatch(healJob, /--force|\+HEAD/);
  assert.doesNotMatch(healJob, /npm (ci|run)/, 'the heal job never executes PR code');
  assert.match(healJob, /ref: \$\{\{ needs\.validate-generator\.outputs\.head_sha \}\}/);
});

test('block-generator stands down only when a pass, repair, or heal succeeded', () => {
  const blockJob = workflow.slice(workflow.indexOf('  block-generator:'), workflow.indexOf('  validate-promotion:'));
  assert.match(blockJob, /needs\.pass-generator\.result != 'success'/);
  assert.match(blockJob, /needs\.apply-generator-repair\.result != 'success'/);
  assert.match(blockJob, /needs\.heal-generator-base\.result != 'success'/);
  assert.match(blockJob, /\n\s+heal-generator-base,\n/);
});

test('the blocked sentinel is a read-only daily sweep that only notifies', () => {
  assert.match(sentinel, /schedule:\n\s+- cron: "0 12 \* \* \*"/);
  assert.match(sentinel, /workflow_dispatch:/);
  const permissions = sentinel.slice(sentinel.indexOf('permissions:'), sentinel.indexOf('steps:'));
  assert.match(permissions, /contents: read/);
  assert.match(permissions, /issues: read/);
  assert.match(permissions, /pull-requests: read/);
  assert.doesNotMatch(permissions, /write/);
  assert.doesNotMatch(sentinel, /gh pr|gh issue|coordinator\.mjs/);
  assert.match(sentinel, /node scripts\/automation\/blocked-sentinel\.mjs/);
  assert.match(sentinel, /SLACK_WEBHOOK_URL/);
});

test('generator pass refreshes after audit and skips auto-merge and observation when redispatched', () => {
  const passJob = workflow.slice(workflow.indexOf('  pass-generator:'), workflow.indexOf('  block-generator:'));
  const audit = passJob.indexOf('coordinator.mjs audit');
  const refresh = passJob.indexOf('coordinator.mjs refresh-generator-base');
  const autoMerge = passJob.indexOf('gh pr merge');
  const observe = passJob.indexOf('coordinator.mjs observe-and-promote');
  assert.ok(audit >= 0 && audit < refresh, 'base refresh must follow exact-SHA audit');
  assert.ok(refresh < autoMerge && autoMerge < observe, 'refresh must precede merge and observation');
  assert.equal((passJob.match(/if: \$\{\{ steps\.refresh\.outputs\.refreshed != 'true' \}\}/g) || []).length, 2);
  assert.doesNotMatch(passJob.slice(0, refresh), /gh pr merge|observe-and-promote/);
});
