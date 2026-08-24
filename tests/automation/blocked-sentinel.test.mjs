import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BLOCKED_LABEL, ORPHAN_HOURS, STALE_HOURS, STALE_NOTIFICATION_UTC_HOUR,
  formatOrphanText, formatSlackText, selectOrphanAutomationPrs, selectStaleBlockedPrs,
  shouldNotifyStaleBlocked,
} from '../../scripts/automation/blocked-sentinel.mjs';
import { ABANDONED_LABEL, TERMINAL_LABELS } from '../../scripts/automation/constants.mjs';

const NOW = Date.parse('2026-08-17T12:00:00Z');
const HOUR = 60 * 60 * 1000;

function item(number, hoursAgo, overrides = {}) {
  return {
    number,
    title: `Blocked PR ${number}`,
    state: 'open',
    pull_request: { url: `https://api.github.com/repos/owner/repo/pulls/${number}` },
    labels: [{ name: BLOCKED_LABEL }],
    created_at: new Date(NOW - hoursAgo * HOUR).toISOString(),
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

test('owned orphan PRs surface after two hours without changing the blocked window', () => {
  assert.equal(ORPHAN_HOURS, 2);
  assert.equal(STALE_HOURS, 24);
  const owned = (number, hoursAgo, overrides = {}) => item(number, hoursAgo, {
    labels: [],
    user: { login: 'github-actions[bot]' },
    statusContexts: [],
    headCommittedAt: new Date(NOW - hoursAgo * HOUR).toISOString(),
    ...overrides,
  });
  const orphans = selectOrphanAutomationPrs([
    owned(111, 2),
    owned(112, 1),
    owned(113, 20, { statusContexts: ['automation/ci'] }),
    owned(114, 20, { labels: [{ name: 'automation-blocked' }] }),
    owned(115, 20, { user: { login: 'human' } }),
    owned(116, 20, { labels: [{ name: ABANDONED_LABEL }] }),
    owned(117, 20, { labels: [{ name: 'automation-repair-1' }] }),
    owned(118, 20, { labels: [{ name: 'automation-heal-1' }] }),
    owned(119, 20, { labels: [{ name: 'automation-retry-1' }] }),
  ], { now: NOW });
  assert.deepEqual(orphans.map((pr) => pr.number), [111, 117, 118, 119]);
  assert.match(formatOrphanText(orphans), /no terminal state in 2h/);
  assert.deepEqual(TERMINAL_LABELS, [BLOCKED_LABEL, ABANDONED_LABEL]);
});

test('old PRs with old heads stay orphaned through repair, heal, and retry labels', () => {
  const controlledLabels = ['automation-repair-2', 'automation-heal-1', 'automation-retry-1'];
  const candidates = controlledLabels.map((name, index) => item(120 + index, 30, {
    labels: [{ name }],
    user: { login: 'github-actions[bot]' },
    statusContexts: [],
    created_at: new Date(NOW - 30 * HOUR).toISOString(),
    updated_at: new Date(NOW - 10 * 60 * 1000).toISOString(),
    headCommittedAt: new Date(NOW - 3 * HOUR).toISOString(),
  }));
  const orphans = selectOrphanAutomationPrs(candidates, { now: NOW });
  assert.deepEqual(orphans.map((pr) => pr.number), [120, 121, 122]);
  assert.equal(orphans[0].ageHours, 30, 'comments and labels cannot reset total PR age');
  assert.equal(orphans[0].headAgeHours, 3);
  assert.equal(orphans[0].updatedAt, new Date(NOW - 10 * 60 * 1000).toISOString());
  assert.match(formatOrphanText(orphans), /PR age 30h, head age 3h/);
});

test('old PRs with young repair, heal, or retry heads get one bounded grace period', () => {
  const candidates = ['automation-repair-2', 'automation-heal-1', 'automation-retry-1']
    .map((name, index) => item(130 + index, 30, {
      labels: [{ name }],
      user: { login: 'github-actions[bot]' },
      statusContexts: [],
      headCommittedAt: new Date(NOW - HOUR).toISOString(),
    }));
  assert.deepEqual(selectOrphanAutomationPrs(candidates, { now: NOW }), []);
});

test('#111-like old PR with an old current head and no status is an orphan', () => {
  const [orphan] = selectOrphanAutomationPrs([item(111, 30, {
    labels: [],
    user: { login: 'github-actions[bot]' },
    statusContexts: [],
    headCommittedAt: new Date(NOW - 30 * HOUR).toISOString(),
  })], { now: NOW });
  assert.equal(orphan.number, 111);
  assert.equal(orphan.headCommittedAt, new Date(NOW - 30 * HOUR).toISOString());
});

test('unknown PR or head timestamps surface and fail closed', () => {
  const unknownPr = item(140, 30, {
    labels: [], user: { login: 'github-actions[bot]' }, statusContexts: [],
    created_at: 'not a date', headCommittedAt: new Date(NOW - 30 * HOUR).toISOString(),
  });
  const unknownHead = item(141, 30, {
    labels: [], user: { login: 'github-actions[bot]' }, statusContexts: [],
    headCommittedAt: 'not a date',
  });
  const orphans = selectOrphanAutomationPrs([unknownPr, unknownHead], { now: NOW });
  assert.deepEqual(orphans.map((pr) => [pr.number, pr.ageHours, pr.headAgeHours]), [
    [140, null, 30], [141, 30, null],
  ]);
  assert.match(formatOrphanText(orphans), /PR age unknown, head age 30h/);
  assert.match(formatOrphanText(orphans), /PR age 30h, head age unknown/);
});

test('stale blocked summaries are due once daily at a deterministic UTC hour', () => {
  assert.equal(STALE_NOTIFICATION_UTC_HOUR, 12);
  assert.equal(shouldNotifyStaleBlocked(Date.parse('2026-08-17T12:00:00Z')), true);
  assert.equal(shouldNotifyStaleBlocked(Date.parse('2026-08-17T11:00:00Z')), false);
  assert.equal(shouldNotifyStaleBlocked(Date.parse('2026-08-17T13:00:00Z')), false);
  assert.throws(() => shouldNotifyStaleBlocked(NOW, 24));
});
