import test from 'node:test';
import assert from 'node:assert/strict';
import { isoWeekOf, roundupSlug, planRoundup, buildRoundupPost } from '../../scripts/news-pilot/roundup.mjs';
import { validateRoundupItem, validateRoundupPack, revalidateRoundupItems, roundupPackDigest } from '../../scripts/news-pilot/roundup-evidence.mjs';

const nowMs = Date.parse('2026-09-30T12:00:00.000Z');
const weekStartUtc = '2026-09-28T00:00:00.000Z';
const source = (id) => ({
  canonicalUrl: 'https://example.org/news/' + id, publisher: 'Example', publisherDomain: 'example.org',
  sourceTier: 'primary', excerpt: 'Liberty Village community group announced a new local event at Hanna Avenue.',
  extractionSubstantive: true, extractedAt: '2026-09-29T11:00:00.000Z', fetchOk: true, urlUsable: true,
});
const item = (id) => ({
  id, title: 'Liberty Village update ' + id, location: 'Liberty Village', actor: 'Liberty Village community group',
  category: 'community', summary: 'A local event at Hanna Avenue was announced.',
  announcedAt: '2026-09-29T10:00:00.000Z', announcedAtVerified: true,
  riskFlags: [], fingerprint: id, sources: [source(id)],
  claims: [{ text: 'The group announced a local event.', sourceUrl: source(id).canonicalUrl, span: 'announced a new local event' }],
});
const opts = { weekStartUtc, nowMs };
const pack = (items) => ({ isoWeek: '2026-W40', now: new Date(nowMs).toISOString(), items });

test('ISO week uses UTC Monday boundary and lowercase deterministic slug', () => {
  assert.equal(isoWeekOf('2026-09-27T23:59:59Z').isoWeek, '2026-W39');
  assert.deepEqual(isoWeekOf('2026-09-28T00:00:00Z'), {
    isoWeek: '2026-W40', weekStartUtc, weekEndUtc: '2026-10-05T00:00:00.000Z',
  });
  assert.equal(isoWeekOf('2027-01-01').isoWeek, '2026-W53');
  assert.equal(roundupSlug('2026-W40'), 'liberty-village-news-week-2026-w40');
  assert.match(roundupSlug('2026-W53'), /^[a-z0-9][a-z0-9-]{0,127}$/);
  assert.equal(roundupSlug(isoWeekOf('2026-09-30').isoWeek), roundupSlug(isoWeekOf('2026-09-28').isoWeek));
  assert.throws(() => roundupSlug('2027-W53'));
});

test('two, one and zero accepted items produce roundup, honest update and precise miss', () => {
  const two = planRoundup(pack([item('a'), item('b')]), opts);
  assert.equal(two.decision, 'roundup');
  const post = buildRoundupPost(two, { image: '/images/og/og-home.jpg', imageExists: () => true });
  assert.match(post.title, /news roundup/);
  assert.equal(post.category, 'news');
  assert.ok(post.content.includes(source('a').canonicalUrl));
  assert.ok(post.content.includes(source('b').canonicalUrl));
  const one = planRoundup(pack([item('a')]), opts);
  assert.equal(one.decision, 'single-update');
  assert.match(buildRoundupPost(one, { image: '/images/og/og-home.jpg', imageExists: () => true }).title, /weekly update/);
  const zero = planRoundup(pack([]), opts);
  assert.equal(zero.decision, 'missed');
  assert.deepEqual(zero.alert, { kind: 'WEEKLY_NEWS_MISSED', isoWeek: '2026-W40', census: zero.census });
  assert.throws(() => buildRoundupPost(zero, { image: '/images/og/og-home.jpg', imageExists: () => true }));
});

test('per-item date, event, source, risk and duplicate decisions', () => {
  assert.equal(validateRoundupItem({ ...item('a'), announcedAtVerified: false }, opts).decision, 'held');
  assert.equal(validateRoundupItem({ ...item('a'), announcedAt: '2026-09-27T23:59:59.000Z' }, opts).decision, 'excluded');
  assert.equal(validateRoundupItem({ ...item('a'), eventEnd: '2026-09-29T00:00:00.000Z' }, opts).decision, 'excluded');
  assert.equal(validateRoundupItem({ ...item('a'), eventStart: '2026-09-29T00:00:00.000Z' }, opts).decision, 'excluded');
  assert.equal(validateRoundupItem({ ...item('a'), eventStart: '2026-10-08T12:00:00.000Z' }, opts).decision, 'accepted');
  assert.equal(validateRoundupItem({ ...item('a'), claims: [{ text: 'Other claim', sourceUrl: source('b').canonicalUrl, span: 'announced' }] }, opts).decision, 'refused');
  assert.equal(validateRoundupItem({ ...item('a'), riskFlags: ['crime'] }, opts).decision, 'refused');
  assert.equal(validateRoundupItem({ ...item('a'), category: 'development-application' }, opts).decision, 'refused');
  assert.equal(validateRoundupItem({ ...item('a'), sources: [{ ...source('a'), publisherDomain: 'not-example.org' }] }, opts).decision, 'refused');
  assert.equal(validateRoundupItem(item('a'), { ...opts, livePosts: [{ content: '[source](' + source('a').canonicalUrl + ')' }] }).decision, 'excluded');
  assert.equal(validateRoundupItem(item('a'), { ...opts, dailyNews: [{ content: '[source](' + source('a').canonicalUrl + ')' }] }).decision, 'excluded');
  assert.equal(validateRoundupItem(item('a'), { ...opts, livePosts: [{ title: item('a').title, slug: 'earlier-lv-update' }] }).decision, 'excluded');
  const daily = [{ title: item('a').title, slug: 'daily-a' }];
  assert.equal(validateRoundupItem(item('a'), { ...opts, dailyNews: daily }).decision, 'excluded');
  assert.equal(validateRoundupItem({ ...item('a'), distinctDevelopment: { corroborated: true,
    description: 'A separately announced event', sourceUrls: [source('a').canonicalUrl] } },
  { ...opts, dailyNews: daily }).decision, 'accepted');
  const checked = validateRoundupPack(pack([item('a'), item('a')]), opts);
  assert.equal(checked.accepted.length, 1);
  assert.equal(checked.excluded.length, 1);
  assert.equal(checked.census.byReason.duplicate, 1);
});

test('refetch changes or failures withhold item for rebuild', async () => {
  const original = item('a');
  const same = await revalidateRoundupItems([original], { refetch: async (_, s) => ({ ...s }) });
  assert.equal(same.accepted.length, 1);
  const changed = await revalidateRoundupItems([original], { refetch: async (_, s) => ({ ...s, excerpt: s.excerpt + ' Updated.' }) });
  assert.equal(changed.excluded.length, 1);
  const unavailable = await revalidateRoundupItems([original], { refetch: async (_, s) => ({ ...s, fetchOk: false }) });
  assert.equal(unavailable.excluded.length, 1);
  const failed = await revalidateRoundupItems([original], { refetch: async () => { throw new Error('offline'); } });
  assert.equal(failed.excluded[0].reason, 'refetch-failed');
  const riskChanged = await revalidateRoundupItems([original], { refetch: async (_, s) => ({ ...s, riskFlags: ['crime'] }) });
  assert.equal(riskChanged.excluded.length, 1);
  const dateChanged = await revalidateRoundupItems([original], { refetch: async (_, s) => ({ ...s, announcedAt: null }) });
  assert.equal(dateChanged.excluded.length, 1);
  const relationChanged = await revalidateRoundupItems([original], { refetch: async (_, s) => ({ ...s, duplicateRelation: 'duplicate' }) });
  assert.equal(relationChanged.excluded.length, 1);
  assert.equal(roundupPackDigest({ a: 1, b: 2 }), roundupPackDigest({ b: 2, a: 1 }));
});
