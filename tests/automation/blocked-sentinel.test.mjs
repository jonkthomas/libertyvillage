import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BLOCKED_LABEL, STALE_HOURS, formatSlackText, selectStaleBlockedPrs,
} from '../../scripts/automation/blocked-sentinel.mjs';

const NOW = Date.parse('2026-08-17T12:00:00Z');
const HOUR = 60 * 60 * 1000;

function item(number, hoursAgo, overrides = {}) {
  return {
    number,
    title: `Blocked PR ${number}`,
    state: 'open',
    pull_request: { url: `https://api.github.com/repos/owner/repo/pulls/${number}` },
    labels: [{ name: BLOCKED_LABEL }],
    updated_at: new Date(NOW - hoursAgo * HOUR).toISOString(),
    ...overrides,
  };
}

test('keeps only open blocked pull requests idle for longer than the window', () => {
  const stale = selectStaleBlockedPrs([
    item(75, 48),
    item(80, 23.9),
    item(81, 24.5),
    item(82, 100, { labels: [{ name: 'automation-repair-1' }] }),
    item(83, 100, { pull_request: undefined }),
    item(84, 100, { state: 'closed' }),
  ], { now: NOW });
  assert.deepEqual(stale.map((pr) => pr.number), [75, 81]);
  assert.deepEqual(stale.map((pr) => pr.idleHours), [48, 24]);
});

test('the staleness boundary and window are exact and clock-injectable', () => {
  assert.equal(STALE_HOURS, 24);
  assert.equal(selectStaleBlockedPrs([item(75, 24)], { now: NOW }).length, 1);
  assert.equal(selectStaleBlockedPrs([item(75, 23)], { now: NOW }).length, 0);
  assert.equal(selectStaleBlockedPrs([item(75, 23)], { now: NOW + HOUR }).length, 1);
  assert.equal(selectStaleBlockedPrs([item(75, 3)], { now: new Date(NOW), staleHours: 2 }).length, 1);
  assert.equal(selectStaleBlockedPrs([item(75, 3)], { now: NOW, staleHours: 4 }).length, 0);
  assert.equal(selectStaleBlockedPrs(null, { now: NOW }).length, 0);
  assert.throws(() => selectStaleBlockedPrs([item(75, 48)], {}));
  assert.throws(() => selectStaleBlockedPrs([item(75, 48)], { now: NOW, staleHours: 0 }));
});

test('an unreadable timestamp is surfaced instead of silently dropped', () => {
  const stale = selectStaleBlockedPrs([item(75, 1, { updated_at: 'not a date' })], { now: NOW });
  assert.deepEqual(stale.map((pr) => pr.idleHours), [null]);
  assert.match(formatSlackText(stale), /idle unknown/);
});

test('one single-line Slack summary lists every stale PR', () => {
  const text = formatSlackText(selectStaleBlockedPrs([item(75, 48), item(81, 30)], { now: NOW }));
  assert.doesNotMatch(text, /\n/);
  assert.match(text, /2 blocked PR\(s\) untouched for more than 24h/);
  assert.match(text, /#75 Blocked PR 75 \(idle 48h\)/);
  assert.match(text, /#81 Blocked PR 81 \(idle 30h\)/);
});
