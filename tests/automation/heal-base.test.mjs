import assert from 'node:assert/strict';
import test from 'node:test';

import { MAX_HEALS } from '../../scripts/automation/constants.mjs';
import { canHeal, healLabel, readHealAttempt } from '../../scripts/automation/policy.mjs';
import { planBaseHeal, resolveAppendUnion } from '../../scripts/automation/heal-base.mjs';
import { POSTS_FILE, serializeRecords } from '../../scripts/automation/record-repair.mjs';

const BUSINESSES_FILE = 'data/businesses.json';

function makePost(slug, overrides = {}) {
  return {
    slug, title: `Title ${slug}`, description: `Description ${slug}`, content: `Content ${slug}`,
    publishedAt: '2026-08-10', updatedAt: '2026-08-10', category: 'news', tags: ['liberty village'],
    answerBlock: `Answer ${slug}`, faqs: [], keyTakeaways: [], relatedServices: [], relatedTopics: [],
    relatedPosts: [], author: 'Liberty Village Newsroom', image: '/og.png',
    ...overrides,
  };
}

const OLD_ONE = makePost('older-post');
const OLD_TWO = makePost('another-old-post');
const OURS_NEW = makePost('generator-appended-post');
const STAGING_NEW = makePost('staging-appended-post');

const BASE = serializeRecords([OLD_ONE, OLD_TWO]);
const OURS = serializeRecords([OLD_ONE, OLD_TWO, OURS_NEW]);
const THEIRS = serializeRecords([OLD_ONE, OLD_TWO, STAGING_NEW]);

function union(overrides = {}) {
  return resolveAppendUnion(POSTS_FILE, { baseText: BASE, oursText: OURS, theirsText: THEIRS, ...overrides });
}

test('one controlled heal label carries the budget and the third conflict is rejected', () => {
  assert.equal(MAX_HEALS, 2);
  assert.equal(readHealAttempt([]), 0);
  assert.equal(readHealAttempt([{ name: healLabel(1) }]), 1);
  assert.equal(readHealAttempt([{ name: healLabel(2) }]), 2);
  assert.equal(readHealAttempt([{ name: 'automation-blocked' }, { name: 'automation-repair-2' }]), 0);
  assert.equal(canHeal(0), true);
  assert.equal(canHeal(1), true);
  assert.equal(canHeal(MAX_HEALS), false);
  assert.equal(canHeal(-1), false);
  assert.throws(() => readHealAttempt([{ name: healLabel(3) }]));
  assert.throws(() => readHealAttempt([{ name: healLabel(1) }, { name: healLabel(2) }]));
  assert.throws(() => readHealAttempt('automation-heal-1'));
});

test('both-appended union keeps both sides and leaves every other record byte-identical', () => {
  const resolved = union();
  assert.equal(resolved.ok, true);
  assert.deepEqual(resolved.appendedSlugs, ['generator-appended-post']);
  assert.deepEqual(resolved.stagingSlugs, ['staging-appended-post']);
  const records = JSON.parse(resolved.text);
  assert.deepEqual(records.map((record) => record.slug), [
    'older-post', 'another-old-post', 'staging-appended-post', 'generator-appended-post',
  ]);
  for (const original of [OLD_ONE, OLD_TWO, STAGING_NEW, OURS_NEW]) {
    const merged = records.find((record) => record.slug === original.slug);
    assert.equal(JSON.stringify(merged), JSON.stringify(original), original.slug);
  }
  assert.equal(resolved.text, serializeRecords([OLD_ONE, OLD_TWO, STAGING_NEW, OURS_NEW]));
  assert.equal(resolved.text.endsWith('\n'), true);
});

test('refuses anything that is not a clean two-sided append', () => {
  // Our side rewrote a record that already existed at the merge base.
  assert.equal(union({ oursText: serializeRecords([{ ...OLD_ONE, title: 'Rewritten' }, OLD_TWO, OURS_NEW]) }).ok, false);
  // Our side dropped a base record.
  assert.equal(union({ oursText: serializeRecords([OLD_ONE, OURS_NEW]) }).ok, false);
  // Both sides added the same slug.
  assert.equal(union({ theirsText: serializeRecords([OLD_ONE, OLD_TWO, OURS_NEW]) }).ok, false);
  // Our side appended nothing.
  assert.equal(union({ oursText: BASE }).ok, false);
  // Unparseable or non-canonical content on any side.
  assert.equal(union({ theirsText: '[' }).ok, false);
  assert.equal(union({ oursText: JSON.stringify([OLD_ONE, OLD_TWO, OURS_NEW]) }).ok, false);
  assert.equal(union({ baseText: '' }).ok, false);
  // Records without slugs cannot be keyed.
  assert.equal(union({ oursText: serializeRecords([OLD_ONE, OLD_TWO, { title: 'no slug' }]) }).ok, false);
  // A conflict in a file that is not a monolithic record file is never resolved.
  assert.equal(resolveAppendUnion('app/page.tsx', { baseText: BASE, oursText: OURS, theirsText: THEIRS }).ok, false);
  assert.equal(resolveAppendUnion('data/discovery-seen.json', { baseText: BASE, oursText: OURS, theirsText: THEIRS }).ok, false);
});

test('heal plans only cover record-file conflicts inside the kind allowed paths', () => {
  assert.equal(planBaseHeal('news', [POSTS_FILE]).ok, true);
  assert.equal(planBaseHeal('business', [BUSINESSES_FILE]).ok, true);
  assert.equal(planBaseHeal('news', []).ok, false);
  assert.equal(planBaseHeal('news', [POSTS_FILE, 'app/page.tsx']).ok, false);
  assert.equal(planBaseHeal('news', ['.github/workflows/autonomous-coordinator.yml']).ok, false);
  assert.equal(planBaseHeal('news', ['scripts/automation/coordinator.mjs']).ok, false);
  // posts.json is not an allowed path for the business generator, and the discovery
  // registry is allowed but is not a slug-keyed record file.
  assert.equal(planBaseHeal('business', [POSTS_FILE]).ok, false);
  assert.equal(planBaseHeal('business', ['data/discovery-seen.json']).ok, false);
  assert.equal(planBaseHeal('blog', [POSTS_FILE, 'public/images/blog/post.jpg']).ok, false);
});
