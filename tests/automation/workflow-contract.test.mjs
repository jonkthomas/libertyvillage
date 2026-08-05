import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow = fs.readFileSync(new URL('../../.github/workflows/autonomous-coordinator.yml', import.meta.url), 'utf8');

test('coordinator is dispatch-only and synthetic merge checkouts fetch parent history', () => {
  assert.doesNotMatch(workflow, /workflow_call|inputs\./);
  const mergeCheckouts = [...workflow.matchAll(/ref: refs\/pull\/[^\n]+\/merge\n\s+fetch-depth: 0/g)];
  assert.equal(mergeCheckouts.length, 2);
});

test('repair attempt is consumed before fixer push and redispatch', () => {
  const persist = workflow.indexOf('coordinator.mjs set-attempt');
  const push = workflow.indexOf('git push origin "HEAD:$HEAD_REF"');
  const redispatch = workflow.indexOf('coordinator.mjs dispatch', push);
  assert.ok(persist >= 0, 'missing attempt persistence');
  assert.ok(persist < push, 'attempt must be persisted before push');
  assert.ok(push < redispatch, 'redispatch must use the pushed repair SHA');
  assert.match(workflow.slice(persist, push), /NEXT_ATTEMPT/);
  assert.match(workflow.slice(persist, push), /ls-remote/);
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
