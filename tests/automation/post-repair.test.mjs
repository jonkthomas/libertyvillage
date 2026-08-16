import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyPostRepairPlan, buildPostRepairPlan, diffPostsBySlug, isPostRepairPlan, isPostsOnlyRepair,
  POST_REPAIR_MAX_BYTES, POSTS_FILE, readPostsFile, serializePosts,
} from '../../scripts/automation/post-repair.mjs';

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
const APPENDED = makePost('appended-post');
const BASE_TEXT = serializePosts([OLD_ONE, OLD_TWO]);
const HEAD_TEXT = serializePosts([OLD_ONE, OLD_TWO, APPENDED]);
const FILES = [POSTS_FILE];

function plan(posts, reason = 'resolve gate findings') {
  return buildPostRepairPlan({ posts, reason });
}

function repaired(overrides) {
  return { ...APPENDED, ...overrides };
}

test('routes only a posts.json-exclusive repairable set to the per-post path', () => {
  assert.equal(isPostsOnlyRepair([POSTS_FILE]), true);
  assert.equal(isPostsOnlyRepair([POSTS_FILE, 'lib/site.ts']), false);
  assert.equal(isPostsOnlyRepair([]), false);
  assert.equal(isPostRepairPlan(plan([{ slug: APPENDED.slug, post: APPENDED }])), true);
  assert.equal(isPostRepairPlan({ edits: [{ path: POSTS_FILE, content: '[]', reason: 'x' }] }), false);
});

test('diffs appended and modified posts by slug and rejects malformed files', () => {
  const appendOnly = diffPostsBySlug(BASE_TEXT, HEAD_TEXT);
  assert.equal(appendOnly.ok, true);
  assert.deepEqual(appendOnly.slugs, [APPENDED.slug]);

  const modified = diffPostsBySlug(BASE_TEXT, serializePosts([OLD_ONE, { ...OLD_TWO, title: 'Edited' }, APPENDED]));
  assert.deepEqual(modified.slugs, [OLD_TWO.slug, APPENDED.slug]);

  assert.equal(diffPostsBySlug(BASE_TEXT, BASE_TEXT).ok, false, 'no changed posts must fail closed');
  assert.equal(diffPostsBySlug(BASE_TEXT, serializePosts([OLD_ONE, APPENDED])).ok, false, 'dropped base post must fail closed');
  assert.equal(diffPostsBySlug(BASE_TEXT, '{"not":"an array"}').ok, false);
  assert.equal(diffPostsBySlug(BASE_TEXT, `${JSON.stringify([OLD_ONE, OLD_TWO, APPENDED])}\n`).ok, false, 'non-canonical head must fail closed');
  assert.equal(readPostsFile(serializePosts([APPENDED, APPENDED]), 'head').ok, false, 'duplicate slugs must fail closed');
});

test('rejects a plan whose slug is not in the PR diff', () => {
  const unknown = applyPostRepairPlan('news', plan([{ slug: 'ghost-post', post: makePost('ghost-post') }]), {
    changedFiles: FILES, baseText: BASE_TEXT, headText: HEAD_TEXT,
  });
  assert.equal(unknown.ok, false);
  assert.match(unknown.errors.join('; '), /not in head data\/posts\.json/);

  const untouched = applyPostRepairPlan('news', plan([{ slug: OLD_ONE.slug, post: { ...OLD_ONE, content: 'Rewritten' } }]), {
    changedFiles: FILES, baseText: BASE_TEXT, headText: HEAD_TEXT,
  });
  assert.equal(untouched.ok, false);
  assert.match(untouched.errors.join('; '), /was not appended or modified by this PR/);

  const mismatched = applyPostRepairPlan('news', plan([{ slug: APPENDED.slug, post: repaired({ slug: 'other-slug' }) }]), {
    changedFiles: FILES, baseText: BASE_TEXT, headText: HEAD_TEXT,
  });
  assert.equal(mismatched.ok, false);
  assert.match(mismatched.errors.join('; '), /must be an object carrying the same slug/);
});

test('rejects immutable, structural, no-op, and out-of-diff repairs', () => {
  const cases = [
    [plan([{ slug: APPENDED.slug, post: repaired({ publishedAt: '2026-01-01' }) }]), /immutable field changed/],
    [plan([{ slug: APPENDED.slug, post: repaired({ extra: 'field' }) }]), /exact top-level key set/],
    [plan([{ slug: APPENDED.slug, post: repaired({}) }]), /at least one repairable field/],
    [plan([{ slug: APPENDED.slug, post: repaired({ content: 'x'.repeat(POST_REPAIR_MAX_BYTES) }) }]), /byte budget exceeded/],
    [plan([]), /must contain 1-10 posts/],
    [plan([{ slug: APPENDED.slug, post: repaired({ content: 'Fixed' }) }], ''), /reason is required/],
    [{ ...plan([{ slug: APPENDED.slug, post: repaired({ content: 'Fixed' }) }]), file: 'data/businesses.json' }, /must target data\/posts\.json/],
    [{ ...plan([{ slug: APPENDED.slug, post: repaired({ content: 'Fixed' }) }]), edits: [] }, /must not carry whole-file edits/],
    [{ edits: [{ path: POSTS_FILE, content: '[]', reason: 'whole file' }] }, /must be a post-repair plan/],
  ];
  for (const [candidate, expected] of cases) {
    const result = applyPostRepairPlan('news', candidate, { changedFiles: FILES, baseText: BASE_TEXT, headText: HEAD_TEXT });
    assert.equal(result.ok, false);
    assert.match(result.errors.join('; '), expected);
  }

  const notInDiff = applyPostRepairPlan('news', plan([{ slug: APPENDED.slug, post: repaired({ content: 'Fixed' }) }]), {
    changedFiles: ['public/images/blog/x.jpg'], baseText: BASE_TEXT, headText: HEAD_TEXT,
  });
  assert.equal(notInDiff.ok, false);
  assert.match(notInDiff.errors.join('; '), /existing PR diff path/);

  const wrongKind = applyPostRepairPlan('business', plan([{ slug: APPENDED.slug, post: repaired({ content: 'Fixed' }) }]), {
    changedFiles: FILES, baseText: BASE_TEXT, headText: HEAD_TEXT,
  });
  assert.equal(wrongKind.ok, false);
  assert.match(wrongKind.errors.join('; '), /non-repairable path for business/);
});

test('happy path splices the repaired post and keeps every other post byte-identical', () => {
  const fixed = repaired({ content: 'Grounded repair with sourced local detail.', title: 'Repaired title' });
  const result = applyPostRepairPlan('news', plan([{ slug: APPENDED.slug, post: fixed }]), {
    changedFiles: FILES, baseText: BASE_TEXT, headText: HEAD_TEXT,
  });
  assert.equal(result.errors.join('; '), '');
  assert.equal(result.ok, true);
  assert.deepEqual(result.slugs, [APPENDED.slug]);

  const posts = JSON.parse(result.text);
  const headPosts = JSON.parse(HEAD_TEXT);
  assert.equal(posts.length, headPosts.length);
  assert.deepEqual(posts.at(-1), fixed);
  for (const [index, post] of posts.entries()) {
    if (post.slug === APPENDED.slug) continue;
    assert.equal(JSON.stringify(post), JSON.stringify(headPosts[index]), `post ${post.slug} must stay byte-identical`);
  }
  assert.equal(result.text, serializePosts([OLD_ONE, OLD_TWO, fixed]));
  assert.equal(result.text.startsWith(HEAD_TEXT.slice(0, HEAD_TEXT.indexOf(`"${APPENDED.slug}"`))), true);
  assert.equal(readPostsFile(result.text, 'repaired').ok, true);

  const noop = applyPostRepairPlan('news', plan([{ slug: APPENDED.slug, post: { ...APPENDED } }]), {
    changedFiles: FILES, baseText: BASE_TEXT, headText: HEAD_TEXT,
  });
  assert.equal(noop.ok, false);
});

test('repairs several changed posts at once and preserves files without a trailing newline', () => {
  const headText = serializePosts([OLD_ONE, { ...OLD_TWO, title: 'Edited' }, APPENDED], false);
  const fixedOld = { ...OLD_TWO, title: 'Edited', content: 'Repaired old content' };
  const fixedNew = repaired({ content: 'Repaired new content' });
  const result = applyPostRepairPlan('blog', plan([
    { slug: OLD_TWO.slug, post: fixedOld },
    { slug: APPENDED.slug, post: fixedNew },
  ]), { changedFiles: [POSTS_FILE, 'public/images/blog/x.jpg'], baseText: BASE_TEXT, headText });
  assert.equal(result.errors.join('; '), '');
  assert.equal(result.ok, true);
  assert.deepEqual(result.slugs, [OLD_TWO.slug, APPENDED.slug]);
  assert.equal(result.text.endsWith('}\n]'), true, 'must not add a trailing newline');
  assert.deepEqual(JSON.parse(result.text), [OLD_ONE, fixedOld, fixedNew]);

  const duplicated = applyPostRepairPlan('blog', plan([
    { slug: APPENDED.slug, post: fixedNew },
    { slug: APPENDED.slug, post: repaired({ content: 'Second' }) },
  ]), { changedFiles: FILES, baseText: BASE_TEXT, headText });
  assert.equal(duplicated.ok, false);
  assert.match(duplicated.errors.join('; '), /duplicate repaired slug/);
});
