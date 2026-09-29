import test from 'node:test';
import assert from 'node:assert/strict';
import { planRoundupV2, roundupCoverageFromPack } from '../../scripts/news-pilot/roundup.mjs';
import { roundupTemporalReason } from '../../scripts/news-pilot/roundup-verify.mjs';

const now = '2026-09-29T15:00:00Z';
const unit = (id, patch = {}) => ({ identityKey: `occ:addr:${id}:2026-10-03:18:00`, canonicalVenueId: `addr:${id}`,
  subject: id, locality: 'adjacent', item_type: 'event', when: { kind: 'event', date: '2026-10-03', startTime: '18:00' }, ...patch });
const core = unit('core', { locality: 'core' });

test('3/1 publish rule counts anchors, class and concert caps', () => {
  assert.deepEqual(planRoundupV2([unit('a'), unit('b'), unit('c')], { now }).reasons, ['no-core']);
  assert.deepEqual(planRoundupV2([core, unit('a')], { now }).reasons, ['below-minimum']);
  const concerts = Array.from({ length: 6 }, (_, i) => unit(`rbc-${i}`, { item_type: 'concert', venueId: 'venue:rbc',
    identityKey: `occ:addr:rbc:2026-10-${String(i + 3).padStart(2, '0')}:19:00` }));
  assert.equal(planRoundupV2([...concerts, core], { now }).units, 2);
  assert.equal(planRoundupV2([...concerts, core, unit('road', { item_type: 'road' })], { now }).decision, 'publish');
  const classes = [unit('c1', { canonicalVenueId: 'addr:studio', item_type: 'class', locality: 'core' }),
    unit('c2', { canonicalVenueId: 'addr:studio', item_type: 'class', locality: 'core' })];
  assert.equal(planRoundupV2([...classes, unit('other')], { now }).units, 2);
  assert.deepEqual(planRoundupV2([unit('x', { item_type: 'class', locality: 'core' }),
    unit('y', { item_type: 'class', locality: 'core' }), unit('z', { item_type: 'class', locality: 'core' })], { now }).reasons, ['no-core']);
});

test('occurrence identity, covered keys and still-in-effect', () => {
  const same = { ...core, identityKey: core.identityKey, subject: core.subject, evidence: [{ url: 'https://other.example/a' }] };
  const merged = planRoundupV2([core, same, unit('a'), unit('b')], { now });
  assert.equal(merged.units, 3);
  assert.equal(merged.countedItems[0].constituents.length, 2);
  const coverage = roundupCoverageFromPack(merged);
  assert.deepEqual(coverage.keys, [core.identityKey, unit('a').identityKey, unit('b').identityKey].sort());
  assert.deepEqual(merged.countedItems.find((item) => item.identityKey === core.identityKey).keys, [core.identityKey]);
  const road = unit('road', { item_type: 'road', identityKey: 'road:123' });
  const previous = [{ kind: 'roundup', roundupCoverage: { version: 1, isoWeek: '2026-W39', planningCutoff: '2026-09-25T16:00:00Z', keys: ['road:123'] } }];
  const plan = planRoundupV2([road, core, unit('a'), unit('b')], { now, posts: previous });
  assert.equal(plan.units, 3);
  assert.equal(plan.stillInEffect.length, 1);
  assert.ok(roundupCoverageFromPack(plan).keys.includes('road:123'));
  assert.equal(planRoundupV2([core, unit('a'), unit('b')], { now, posts: [{ kind: 'roundup', roundupCoverage: {
    version: 1, keys: [core.identityKey] } }] }).decision, 'hold');
});

test('ambiguous all-day matches hold one, distinct times and dates remain distinct', () => {
  const timed = core;
  const allDay = unit('all', { canonicalVenueId: core.canonicalVenueId, identityKey: 'occ:addr:core:2026-10-03:all-day',
    when: { kind: 'event', date: '2026-10-03' } });
  const otherTime = unit('later', { canonicalVenueId: core.canonicalVenueId, identityKey: 'occ:addr:core:2026-10-03:20:00' });
  const nextDate = unit('next', { canonicalVenueId: core.canonicalVenueId, identityKey: 'occ:addr:core:2026-10-10:18:00' });
  const result = planRoundupV2([timed, allDay, otherTime, nextDate], { now });
  assert.equal(result.countedItems.length, 3);
  assert.equal(result.excluded.find((x) => x.reason === 'duplicate-ambiguous')?.item.identityKey, allDay.identityKey);
});

test('Toronto event end, unknown end, fourteen day edge and UTC edition boundary', () => {
  assert.equal(roundupTemporalReason({ kind: 'event', date: '2026-10-03' }, '2026-10-04T03:59:00Z', { editionNow: now }), null);
  assert.equal(roundupTemporalReason({ kind: 'event', date: '2026-10-03' }, '2026-10-04T04:00:00Z', { editionNow: now }), 'concluded');
  assert.equal(roundupTemporalReason({ kind: 'event', date: '2026-10-03', startTime: '11:30' }, '2026-10-03T15:29:00Z', { editionNow: now }), null);
  assert.equal(roundupTemporalReason({ kind: 'event', date: '2026-10-03', startTime: '11:30' }, '2026-10-03T15:30:00Z', { editionNow: now }), 'concluded');
  assert.equal(roundupTemporalReason({ kind: 'event', date: '2026-10-13', startTime: '11:00' }, now, { editionNow: now }), 'outside-window');
  assert.equal(roundupTemporalReason({ kind: 'event', date: '2026-10-13', startTime: '10:59' }, now, { editionNow: now }), null);
  assert.equal(roundupTemporalReason({ kind: 'news-update', date: '2026-10-04' }, '2026-10-05T01:00:00Z'), null);
});

test('held previous week rolls news; published previous week uses cutoff', () => {
  const w40 = '2026-09-29T15:00:00Z';
  const news = { kind: 'news-update', date: '2026-09-25' };
  assert.equal(roundupTemporalReason(news, w40), null);
  const previous = [{ roundupCoverage: { isoWeek: '2026-W39', planningCutoff: '2026-09-26T16:00:00Z' } }];
  assert.equal(roundupTemporalReason(news, w40, { posts: previous }), 'stale');
  const legacy = [{ slug: 'liberty-village-news-week-2026-w39', publishedAt: '2026-09-26' }];
  assert.equal(roundupTemporalReason(news, w40, { posts: legacy }), 'stale');
});

test('coverage keeps every constituent and refuses 65 keys', () => {
  const units = [{ identityKey: 'aggregate', keys: Array.from({ length: 64 }, (_, i) => `occ:venue:2026-10-${String(i + 1).padStart(2, '0')}:all-day`) }];
  const coverage = roundupCoverageFromPack({ isoWeek: '2026-W40', now, units, stillInEffect: [] });
  assert.equal(coverage.keys.length, 64);
  assert.throws(() => roundupCoverageFromPack({ isoWeek: '2026-W40', now, units,
    stillInEffect: [{ identityKey: 'road:extra' }] }), /key limit/);
});
