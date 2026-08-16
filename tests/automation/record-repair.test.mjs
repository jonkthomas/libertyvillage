import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyRecordRepairPlan, buildRecordRepairPlan, describeRepairContract, diffRecordsBySlug,
  isRecordFile, isRecordRepairPlan, partitionRepairFiles, planRecordEntries,
  RECORD_FILES, RECORD_REPAIR_MAX_BYTES, readRecordFile, serializeRecords, POSTS_FILE,
} from '../../scripts/automation/record-repair.mjs';

const BUSINESSES_FILE = 'data/businesses.json';
const TOPICS_FILE = 'data/topics.json';

function makePost(slug, overrides = {}) {
  return {
    slug, title: `Title ${slug}`, description: `Description ${slug}`, content: `Content ${slug}`,
    publishedAt: '2026-08-10', updatedAt: '2026-08-10', category: 'news', tags: ['liberty village'],
    answerBlock: `Answer ${slug}`, faqs: [], keyTakeaways: [], relatedServices: [], relatedTopics: [],
    relatedPosts: [], author: 'Liberty Village Newsroom', image: '/og.png',
    ...overrides,
  };
}

function makeBusiness(slug, overrides = {}) {
  return {
    slug, name: `Name ${slug}`, category: 'restaurants', subcategory: 'cafe',
    address: '123 Liberty St', description: `Description ${slug}`, rating: 4.5, reviewCount: 40,
    priceRange: '$$', hours: 'Mon-Fri 9-5', phone: '416-555-0100', website: 'https://example.com',
    tags: ['coffee'], featured: false, proTip: `Tip ${slug}`, image: '/images/businesses/x.jpg',
    answerBlock: `Answer ${slug}`, bestFor: 'remote work',
    ...overrides,
  };
}

function makeTopic(slug, overrides = {}) {
  return {
    slug, title: `Topic ${slug}`, description: `Description ${slug}`, category: 'guides',
    content: `Content ${slug}`, quickTips: [], faqs: [], relatedTopics: [], relatedServices: [],
    image: '/og.png', answerSummary: `Summary ${slug}`, keyTakeaways: [], definitions: [],
    ...overrides,
  };
}

const OLD_POST = makePost('older-post');
const OLD_POST_TWO = makePost('another-old-post');
const NEW_POST = makePost('appended-post');
const OLD_BUSINESS = makeBusiness('old-cafe');
const NEW_BUSINESS = makeBusiness('new-cafe');
const OLD_TOPIC = makeTopic('old-topic');
const NEW_TOPIC = makeTopic('new-topic');

const POSTS_BASE = serializeRecords([OLD_POST, OLD_POST_TWO]);
const POSTS_HEAD = serializeRecords([OLD_POST, OLD_POST_TWO, NEW_POST]);
const BUSINESSES_BASE = serializeRecords([OLD_BUSINESS]);
const BUSINESSES_HEAD = serializeRecords([OLD_BUSINESS, NEW_BUSINESS]);
const TOPICS_BASE = serializeRecords([OLD_TOPIC]);
const TOPICS_HEAD = serializeRecords([OLD_TOPIC, NEW_TOPIC]);

const SOURCES = {
  [POSTS_FILE]: { baseText: POSTS_BASE, headText: POSTS_HEAD },
  [BUSINESSES_FILE]: { baseText: BUSINESSES_BASE, headText: BUSINESSES_HEAD },
  [TOPICS_FILE]: { baseText: TOPICS_BASE, headText: TOPICS_HEAD },
};
const ALL_FILES = [POSTS_FILE, BUSINESSES_FILE, TOPICS_FILE];

function plan(files, reason = 'resolve gate findings') {
  return buildRecordRepairPlan({ files, reason });
}

function entry(slug, record) {
  return { slug, record };
}

function apply(kind, candidate, overrides = {}) {
  return applyRecordRepairPlan(kind, candidate, { changedFiles: ALL_FILES, sources: SOURCES, ...overrides });
}

test('routes every monolithic slug-keyed data file to the per-record path', () => {
  assert.deepEqual([...RECORD_FILES], [POSTS_FILE, BUSINESSES_FILE, TOPICS_FILE]);
  assert.equal(isRecordFile(POSTS_FILE), true);
  assert.equal(isRecordFile('lib/site.ts'), false);
  assert.deepEqual(partitionRepairFiles([POSTS_FILE, 'lib/site.ts', TOPICS_FILE]), {
    recordFiles: [POSTS_FILE, TOPICS_FILE], otherFiles: ['lib/site.ts'],
  });
  assert.deepEqual(partitionRepairFiles(['app/page.tsx']), { recordFiles: [], otherFiles: ['app/page.tsx'] });
  assert.deepEqual(partitionRepairFiles(undefined), { recordFiles: [], otherFiles: [] });
  assert.equal(isRecordRepairPlan(plan([{ file: POSTS_FILE, records: [entry(NEW_POST.slug, NEW_POST)] }])), true);
  assert.equal(isRecordRepairPlan({ edits: [{ path: POSTS_FILE, content: '[]', reason: 'x' }] }), false);
  assert.deepEqual(
    planRecordEntries(plan([{ file: TOPICS_FILE, records: [entry(NEW_TOPIC.slug, NEW_TOPIC)] }]), TOPICS_FILE),
    [entry(NEW_TOPIC.slug, NEW_TOPIC)],
  );
  assert.deepEqual(planRecordEntries({ posts: [] }, POSTS_FILE), []);
});

test('the fixer contract is rendered from the validation rules for every record file', () => {
  assert.match(describeRepairContract(POSTS_FILE), /immutable, never change: slug, publishedAt, updatedAt, category, image, author/);
  assert.match(describeRepairContract(POSTS_FILE), /Only these fields may be edited: title, description, content/);
  assert.match(describeRepairContract(BUSINESSES_FILE), /business records/);
  assert.match(describeRepairContract(BUSINESSES_FILE), /immutable, never change: slug, name, address/);
  assert.match(describeRepairContract(TOPICS_FILE), /topic records/);
  assert.match(describeRepairContract('data/unknown.json'), /immutable, never change: slug\./);
  assert.match(describeRepairContract('data/unknown.json'), /any field that is not immutable/);
});

test('diffs appended and modified records by slug in each file and rejects malformed files', () => {
  const posts = diffRecordsBySlug(POSTS_FILE, POSTS_BASE, POSTS_HEAD);
  assert.equal(posts.ok, true);
  assert.deepEqual(posts.slugs, [NEW_POST.slug]);
  assert.deepEqual(diffRecordsBySlug(BUSINESSES_FILE, BUSINESSES_BASE, BUSINESSES_HEAD).slugs, [NEW_BUSINESS.slug]);
  assert.deepEqual(diffRecordsBySlug(TOPICS_FILE, TOPICS_BASE, TOPICS_HEAD).slugs, [NEW_TOPIC.slug]);

  const modified = diffRecordsBySlug(POSTS_FILE, POSTS_BASE, serializeRecords([OLD_POST, { ...OLD_POST_TWO, title: 'Edited' }, NEW_POST]));
  assert.deepEqual(modified.slugs, [OLD_POST_TWO.slug, NEW_POST.slug]);

  assert.equal(diffRecordsBySlug(POSTS_FILE, POSTS_BASE, POSTS_BASE).ok, false, 'no changed records must fail closed');
  assert.equal(diffRecordsBySlug(POSTS_FILE, POSTS_BASE, serializeRecords([OLD_POST, NEW_POST])).ok, false, 'dropped base record must fail closed');
  assert.equal(diffRecordsBySlug(TOPICS_FILE, TOPICS_BASE, '{"not":"an array"}').ok, false);
  assert.equal(diffRecordsBySlug(BUSINESSES_FILE, BUSINESSES_BASE, `${JSON.stringify([OLD_BUSINESS, NEW_BUSINESS])}\n`).ok, false, 'non-canonical head must fail closed');
  assert.equal(readRecordFile(serializeRecords([NEW_TOPIC, NEW_TOPIC]), TOPICS_FILE, 'head').ok, false, 'duplicate slugs must fail closed');
  const budget = diffRecordsBySlug(POSTS_FILE, POSTS_BASE, serializeRecords([
    OLD_POST, OLD_POST_TWO, ...Array.from({ length: 30 }, (_, index) => makePost(`extra-${index}`)),
  ]));
  assert.equal(budget.ok, false);
  assert.match(budget.errors.join('; '), /changed record budget exceeded/);
});

test('repairs posts, businesses, and topics in one plan and keeps every other record byte-identical', () => {
  const fixedPost = makePost(NEW_POST.slug, { content: 'Grounded repair with sourced local detail.', title: 'Repaired title' });
  const fixedBusiness = makeBusiness(NEW_BUSINESS.slug, { description: 'Neutral repaired description.', proTip: 'Repaired tip' });
  const fixedTopic = makeTopic(NEW_TOPIC.slug, { content: 'Repaired topic content.', answerSummary: 'Repaired summary' });
  const result = apply('seo', plan([
    { file: POSTS_FILE, records: [entry(NEW_POST.slug, fixedPost)] },
    { file: BUSINESSES_FILE, records: [entry(NEW_BUSINESS.slug, fixedBusiness)] },
    { file: TOPICS_FILE, records: [entry(NEW_TOPIC.slug, fixedTopic)] },
  ]));
  assert.equal(result.errors.join('; '), '');
  assert.equal(result.ok, true);
  assert.deepEqual(result.files, ALL_FILES);

  const expected = {
    [POSTS_FILE]: { records: [OLD_POST, OLD_POST_TWO, fixedPost], head: POSTS_HEAD, repaired: NEW_POST.slug },
    [BUSINESSES_FILE]: { records: [OLD_BUSINESS, fixedBusiness], head: BUSINESSES_HEAD, repaired: NEW_BUSINESS.slug },
    [TOPICS_FILE]: { records: [OLD_TOPIC, fixedTopic], head: TOPICS_HEAD, repaired: NEW_TOPIC.slug },
  };
  for (const applied of result.results) {
    const { records, head, repaired } = expected[applied.file];
    assert.deepEqual(applied.slugs, [repaired]);
    assert.equal(applied.text, serializeRecords(records), `${applied.file} must be canonically spliced`);
    assert.equal(readRecordFile(applied.text, applied.file, 'repaired').ok, true);
    const headRecords = JSON.parse(head);
    const spliced = JSON.parse(applied.text);
    assert.equal(spliced.length, headRecords.length);
    for (const [index, record] of spliced.entries()) {
      if (record.slug === repaired) continue;
      assert.equal(JSON.stringify(record), JSON.stringify(headRecords[index]), `${applied.file}: ${record.slug} must stay byte-identical`);
    }
    assert.equal(applied.text.startsWith(head.slice(0, head.indexOf(`"${repaired}"`))), true, `${applied.file} prefix must be untouched`);
  }
});

test('rejects a slug the PR did not append or modify, per file', () => {
  const unknownPost = apply('news', plan([{ file: POSTS_FILE, records: [entry('ghost-post', makePost('ghost-post'))] }]));
  assert.equal(unknownPost.ok, false);
  assert.match(unknownPost.errors.join('; '), /repaired slug is not in head data\/posts\.json/);

  const unknownBusiness = apply('seo', plan([{ file: BUSINESSES_FILE, records: [entry('ghost-cafe', makeBusiness('ghost-cafe'))] }]));
  assert.equal(unknownBusiness.ok, false);
  assert.match(unknownBusiness.errors.join('; '), /repaired slug is not in head data\/businesses\.json/);

  const untouchedTopic = apply('seo', plan([{ file: TOPICS_FILE, records: [entry(OLD_TOPIC.slug, { ...OLD_TOPIC, content: 'Rewritten' })] }]));
  assert.equal(untouchedTopic.ok, false);
  assert.match(untouchedTopic.errors.join('; '), /data\/topics\.json: repaired slug was not appended or modified by this PR/);

  const mismatched = apply('news', plan([{ file: POSTS_FILE, records: [entry(NEW_POST.slug, makePost('other-slug'))] }]));
  assert.equal(mismatched.ok, false);
  assert.match(mismatched.errors.join('; '), /must be an object carrying the same slug/);
});

test('rejects immutable-field repairs with the field named for every record kind', () => {
  const cases = [
    [POSTS_FILE, NEW_POST.slug, makePost(NEW_POST.slug, { category: 'guides', content: 'Reframed' }), /immutable field changed: category/],
    [POSTS_FILE, NEW_POST.slug, makePost(NEW_POST.slug, { publishedAt: '2026-01-01', content: 'Reframed' }), /immutable field changed: publishedAt/],
    [BUSINESSES_FILE, NEW_BUSINESS.slug, makeBusiness(NEW_BUSINESS.slug, { name: 'Renamed', description: 'Neutral' }), /immutable field changed: name/],
    [BUSINESSES_FILE, NEW_BUSINESS.slug, makeBusiness(NEW_BUSINESS.slug, { rating: 5, description: 'Neutral' }), /immutable field changed: rating/],
    [BUSINESSES_FILE, NEW_BUSINESS.slug, makeBusiness(NEW_BUSINESS.slug, { category: 'bars', description: 'Neutral' }), /immutable field changed: category/],
    [TOPICS_FILE, NEW_TOPIC.slug, makeTopic(NEW_TOPIC.slug, { category: 'news', content: 'Reframed' }), /immutable field changed: category/],
    [TOPICS_FILE, NEW_TOPIC.slug, makeTopic(NEW_TOPIC.slug, { image: '/other.png', content: 'Reframed' }), /immutable field changed: image/],
  ];
  for (const [file, slug, record, expected] of cases) {
    const result = apply('seo', plan([{ file, records: [entry(slug, record)] }]));
    assert.equal(result.ok, false, `${file} ${slug}`);
    assert.match(result.errors.join('; '), expected);
    assert.match(result.errors.join('; '), /non-repairable field changed/);
  }
});

test('rejects structural, no-op, budget, and out-of-scope repairs', () => {
  const fixedPost = makePost(NEW_POST.slug, { content: 'Fixed' });
  const cases = [
    [plan([{ file: POSTS_FILE, records: [entry(NEW_POST.slug, makePost(NEW_POST.slug, { extra: 'field' })) ] }]), /exact top-level key set/],
    [plan([{ file: POSTS_FILE, records: [entry(NEW_POST.slug, makePost(NEW_POST.slug))] }]), /at least one repairable field/],
    [plan([{ file: BUSINESSES_FILE, records: [entry(NEW_BUSINESS.slug, makeBusiness(NEW_BUSINESS.slug))] }]), /at least one repairable field/],
    [plan([{ file: POSTS_FILE, records: [entry(NEW_POST.slug, makePost(NEW_POST.slug, { content: 'x'.repeat(RECORD_REPAIR_MAX_BYTES) }))] }]), /byte budget exceeded/],
    [plan([]), /must contain 1-3 files/],
    [plan([{ file: POSTS_FILE, records: [] }]), /must contain 1-25 records/],
    [plan([{ file: POSTS_FILE, records: [entry(NEW_POST.slug, fixedPost)] }], ''), /reason is required/],
    [plan([{ file: 'data/services.json', records: [entry('x', { slug: 'x' })] }]), /per-record repair does not cover: data\/services\.json/],
    [plan([
      { file: POSTS_FILE, records: [entry(NEW_POST.slug, fixedPost)] },
      { file: POSTS_FILE, records: [entry(NEW_POST.slug, fixedPost)] },
    ]), /duplicate repair plan file/],
    [{ ...plan([{ file: POSTS_FILE, records: [entry(NEW_POST.slug, fixedPost)] }]), edits: [] }, /must not carry whole-file edits/],
    [{ edits: [{ path: POSTS_FILE, content: '[]', reason: 'whole file' }] }, /must be a record-repair plan/],
  ];
  for (const [candidate, expected] of cases) {
    const result = apply('seo', candidate);
    assert.equal(result.ok, false);
    assert.match(result.errors.join('; '), expected);
  }

  const noop = apply('news', plan([{ file: POSTS_FILE, records: [entry(NEW_POST.slug, { ...NEW_POST })] }]));
  assert.equal(noop.ok, false);

  const notInDiff = apply('news', plan([{ file: POSTS_FILE, records: [entry(NEW_POST.slug, fixedPost)] }]), {
    changedFiles: ['public/images/blog/x.jpg'],
  });
  assert.equal(notInDiff.ok, false);
  assert.match(notInDiff.errors.join('; '), /existing PR diff path/);

  const missingSource = apply('seo', plan([{ file: BUSINESSES_FILE, records: [entry(NEW_BUSINESS.slug, makeBusiness(NEW_BUSINESS.slug, { proTip: 'Fixed' }))] }]), {
    sources: { [POSTS_FILE]: SOURCES[POSTS_FILE] },
  });
  assert.equal(missingSource.ok, false);
  assert.match(missingSource.errors.join('; '), /missing trusted base\/head content for data\/businesses\.json/);

  const wrongKind = apply('news', plan([{ file: BUSINESSES_FILE, records: [entry(NEW_BUSINESS.slug, makeBusiness(NEW_BUSINESS.slug, { proTip: 'Fixed' }))] }]));
  assert.equal(wrongKind.ok, false);
  assert.match(wrongKind.errors.join('; '), /non-repairable path for news: data\/businesses\.json/);
});

test('repairs several changed records at once and preserves files without a trailing newline', () => {
  const headText = serializeRecords([OLD_POST, { ...OLD_POST_TWO, title: 'Edited' }, NEW_POST], false);
  const fixedOld = { ...OLD_POST_TWO, title: 'Edited', content: 'Repaired old content' };
  const fixedNew = makePost(NEW_POST.slug, { content: 'Repaired new content' });
  const result = applyRecordRepairPlan('blog', plan([{ file: POSTS_FILE, records: [
    entry(OLD_POST_TWO.slug, fixedOld), entry(NEW_POST.slug, fixedNew),
  ] }]), {
    changedFiles: [POSTS_FILE, 'public/images/blog/x.jpg'],
    sources: { [POSTS_FILE]: { baseText: POSTS_BASE, headText } },
  });
  assert.equal(result.errors.join('; '), '');
  assert.equal(result.ok, true);
  assert.deepEqual(result.results[0].slugs, [OLD_POST_TWO.slug, NEW_POST.slug]);
  assert.equal(result.results[0].text.endsWith('}\n]'), true, 'must not add a trailing newline');
  assert.deepEqual(JSON.parse(result.results[0].text), [OLD_POST, fixedOld, fixedNew]);

  const duplicated = applyRecordRepairPlan('blog', plan([{ file: POSTS_FILE, records: [
    entry(NEW_POST.slug, fixedNew), entry(NEW_POST.slug, makePost(NEW_POST.slug, { content: 'Second' })),
  ] }]), { changedFiles: [POSTS_FILE], sources: { [POSTS_FILE]: { baseText: POSTS_BASE, headText } } });
  assert.equal(duplicated.ok, false);
  assert.match(duplicated.errors.join('; '), /duplicate repaired slug/);
});
