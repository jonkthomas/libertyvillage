import assert from 'node:assert/strict';
import test from 'node:test';

import { GATE_MODEL, MAX_REPAIRS } from '../../scripts/automation/constants.mjs';
import {
  assertAppendOnlyPostsChange, preflightDecision, recordRepairRules, validatePostRepair, validateRecordRepair,
} from '../../scripts/automation/preflight.mjs';

const post = {
  slug: 'new-post', title: 'Title', description: 'Description', content: 'Content',
  publishedAt: '2026-08-10', updatedAt: '2026-08-10', category: 'news', tags: [],
  answerBlock: 'Answer', faqs: [], keyTakeaways: [], relatedServices: [],
  relatedTopics: [], relatedPosts: [], author: 'Liberty Village Newsroom', image: '/og.png',
};

test('append-only policy rejects baseline mutation, count errors, bad JSON, and slug mismatch', () => {
  const baseline = JSON.stringify([{ slug: 'old', title: 'Old' }]);
  assert.equal(assertAppendOnlyPostsChange(baseline, JSON.stringify([{ slug: 'old', title: 'Old' }, post]), post.slug).ok, true);
  assert.equal(assertAppendOnlyPostsChange(baseline, JSON.stringify([{ slug: 'old', title: 'Changed' }, post]), post.slug).ok, false);
  assert.equal(assertAppendOnlyPostsChange(baseline, JSON.stringify([{ slug: 'old', title: 'Old' }]), post.slug).ok, false);
  assert.equal(assertAppendOnlyPostsChange(baseline, JSON.stringify([post, { slug: 'old', title: 'Old' }]), post.slug).ok, false);
  assert.equal(assertAppendOnlyPostsChange(baseline, '{}', post.slug).ok, false);
  assert.equal(assertAppendOnlyPostsChange('bad', '[]', post.slug).ok, false);
});

test('post repair accepts editorial fields and rejects immutable/key/budget violations', () => {
  const accepted = validatePostRepair(post, { ...post, content: 'Better', description: 'Better description' });
  assert.equal(accepted.ok, true);
  assert.deepEqual(accepted.changedFields.sort(), ['content', 'description']);
  for (const field of ['slug', 'publishedAt', 'updatedAt', 'category', 'image', 'author']) {
    assert.equal(validatePostRepair(post, { ...post, [field]: 'changed' }).ok, false, field);
  }
  assert.equal(validatePostRepair(post, { ...post, extra: true, content: 'Better' }).ok, false);
  const removed = { ...post }; delete removed.tags;
  assert.equal(validatePostRepair(post, removed).ok, false);
  assert.equal(validatePostRepair(post, { ...post }).ok, false);
  assert.equal(validatePostRepair(post, { ...post, content: 'x'.repeat(100) }, { maxBytes: 10 }).ok, false);
  assert.equal(validatePostRepair(null, post).ok, false);
});

test('record repair rules are enforced per file and unknown files fail closed on slug and key set', () => {
  const business = {
    slug: 'cafe', name: 'Cafe', category: 'restaurants', description: 'Description',
    rating: 4.5, reviewCount: 10, proTip: 'Tip', tags: ['coffee'],
  };
  assert.equal(validateRecordRepair('data/businesses.json', business, { ...business, description: 'Neutral' }).ok, true);
  for (const field of ['slug', 'name', 'category', 'rating', 'reviewCount']) {
    const result = validateRecordRepair('data/businesses.json', business, { ...business, [field]: 'changed' });
    assert.equal(result.ok, false, field);
    assert.match(result.errors.join('; '), new RegExp(`immutable field changed: ${field}`));
  }
  assert.equal(validateRecordRepair('data/businesses.json', business, { ...business }).ok, false, 'no-op must fail');

  const topic = { slug: 'topic', title: 'Title', category: 'guides', content: 'Content', image: '/og.png' };
  assert.equal(validateRecordRepair('data/topics.json', topic, { ...topic, content: 'Better' }).ok, true);
  assert.equal(validateRecordRepair('data/topics.json', topic, { ...topic, category: 'news' }).ok, false);

  // Undeclared record files still enforce slug immutability and the frozen key set.
  const unknown = { slug: 'x', value: 'a' };
  assert.equal(recordRepairRules('data/unknown.json').repairable, null);
  assert.equal(validateRecordRepair('data/unknown.json', unknown, { slug: 'x', value: 'b' }).ok, true);
  assert.equal(validateRecordRepair('data/unknown.json', unknown, { slug: 'y', value: 'b' }).ok, false);
  assert.equal(validateRecordRepair('data/unknown.json', unknown, { slug: 'x', value: 'a', extra: 1 }).ok, false);
});

function verdict(overall, findings = [], sha = 'a'.repeat(40)) {
  const passed = overall >= 8 && !findings.some((f) => ['critical', 'high'].includes(f.severity));
  return { overall, passed, findings, model: GATE_MODEL, commit_sha: sha };
}

test('preflight decision requires exact content binding and shares the repair budget', () => {
  const sha = 'a'.repeat(40);
  assert.equal(preflightDecision({ verdict: verdict(8), contentSha: sha, attempts: 0 }), 'go');
  assert.equal(preflightDecision({ verdict: verdict(7.9), contentSha: sha, attempts: 0 }), 'repair');
  assert.equal(preflightDecision({ verdict: verdict(8, [{ severity: 'high', path: 'data/posts.json', note: 'bad' }]), contentSha: sha, attempts: 0 }), 'repair');
  assert.equal(preflightDecision({ verdict: verdict(7), contentSha: sha, attempts: MAX_REPAIRS }), 'block');
  assert.equal(preflightDecision({ verdict: verdict(9), contentSha: 'b'.repeat(40), attempts: 0 }), 'block');
});
