import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyCandidateEvent, emptyCandidateState, parseCandidateState, renderCandidateState,
} from '../../scripts/automation/candidate-state.mjs';

test('durable candidate state keeps reason exact and stores outcome separately', () => {
  const reason = `lint refused the draft${' x'.repeat(40)} …[truncated]`;
  const applied = applyCandidateEvent(emptyCandidateState('blog'), {
    key: 'blog:cn13-run',
    action: 'close-and-regenerate',
    at: '2026-08-26T18:00:00.000Z',
    topicKey: 'acceptance-control-topic',
    reason,
    outcome: 'MONITOR_TIMEOUT',
  });
  assert.equal(applied.changed, true);
  assert.equal(applied.state.lastReason, reason);
  assert.equal(applied.state.lastOutcome, 'MONITOR_TIMEOUT');
  assert.equal(applied.state.topics['acceptance-control-topic'].reason, reason);
  assert.equal(applied.state.topics['acceptance-control-topic'].outcome, 'MONITOR_TIMEOUT');
  assert.equal(String(applied.state.lastReason).startsWith('MONITOR_TIMEOUT'), false);

  const body = renderCandidateState(applied.state);
  assert.match(body, /MONITOR_TIMEOUT/);
  assert.match(body, /Last outcome/);
  const parsed = parseCandidateState(body, 'blog');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.state.lastReason, reason);
  assert.equal(parsed.state.lastOutcome, 'MONITOR_TIMEOUT');
  assert.equal(parsed.state.topics['acceptance-control-topic'].reason, reason);

  const legacy = parseCandidateState(renderCandidateState({
    ...emptyCandidateState('blog'), lastOutcome: undefined,
  }).replace(/,"lastOutcome":null/, ''), 'blog');
  assert.equal(legacy.ok, true);
  assert.equal(Object.hasOwn(legacy.state, 'lastOutcome'), false);
  assert.equal(legacy.state.lastReason, null);
});
