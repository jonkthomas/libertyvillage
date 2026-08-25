import test from 'node:test';
import assert from 'node:assert/strict';
import { lostDispatchRetry, mayRepin, statusForExactSha, terminalFromObservation } from '../../scripts/supervisor/sha-monitor.mjs';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);

test('combined status rejects a stale payload SHA even when contexts say success', () => {
  assert.throws(() => statusForExactSha({ sha: B, statuses: [
    { context: 'automation/ci', state: 'success' }, { context: 'automation/opus-gate', state: 'success' },
  ] }, A), /payload SHA drifted/);
});

test('latest status context is selected by timestamp with newest-first tie breaking', () => {
  const result = statusForExactSha({ sha: A, statuses: [
    { context: 'automation/ci', state: 'success', updated_at: '2026-08-24T10:00:00Z' },
    { context: 'automation/ci', state: 'failure', updated_at: '2026-08-24T09:00:00Z' },
    { context: 'automation/opus-gate', state: 'pending' },
    { context: 'automation/opus-gate', state: 'failure' },
  ] }, A);
  assert.deepEqual(result, { ci: 'success', gate: 'pending' });
});

test('repin requires exact distinct heads and the old head among the new commit parents', () => {
  assert.equal(mayRepin({ oldSha: A, newSha: B, parents: [A] }), true);
  assert.equal(mayRepin({ oldSha: A, newSha: B, parents: [C, A] }), true);
  assert.equal(mayRepin({ oldSha: A, newSha: B, parents: [C] }), false);
  assert.equal(mayRepin({ oldSha: A, newSha: A, parents: [A] }), false);
  assert.equal(mayRepin({ oldSha: 'short', newSha: B, parents: [A] }), false);
});

test('lost status redispatch exhausts after the canonical two retries', () => {
  const old = Date.now() - 16 * 60 * 1000;
  assert.equal(lostDispatchRetry({ attempts: 0, missingSince: old }).action, 'retry');
  assert.equal(lostDispatchRetry({ attempts: 2, missingSince: old }).action, 'block');
});

test('an open owned PR can never produce success while a merged PR survives late staging advance', () => {
  const open = { state: 'open', head: { sha: A, ref: 'blog/auto-one', repo: { fork: false } }, base: { ref: 'staging' }, user: { login: 'github-actions[bot]' } };
  assert.equal(terminalFromObservation({ pr: open, sha: A }).terminal, null);
  const merged = { ...open, state: 'closed', merged: true, merge_commit_sha: B };
  assert.equal(terminalFromObservation({ pr: merged, sha: A, stagingSha: C }).terminal, 'MERGED_STAGING');
});
