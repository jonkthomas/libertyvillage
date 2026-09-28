// B2: real-function adapter tests. preflightDecision, validateRecordRepair,
// evaluateRepairProgress, lintPost, validateDraft and evaluatePublishReadyDraft run
// for real; only the agent SDK query() under review-agent's real runStructured is faked.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { fakeAgent, queueAgent } from './fixtures/agent-sdk-mock.mjs';
import { identityValidateRecord } from './fixtures/storage-validate.mjs';
import { NEWS_NOW, newsEvidence, newsExportRoot, newsPost } from './fixtures/news.mjs';
import { loadSiteLinkIndex } from '../../scripts/news-pilot/draft-evidence.mjs';
import { createLocalImageExists } from '../../scripts/news-pilot/draft-validate.mjs';
import { RECORD_REPAIR_RULES } from '../../scripts/automation/record-rules.mjs';
import {
  CONTENT_REPAIR_RULES, describeRowContract, validateRowRepair,
} from '../../scripts/content/repair-rules.mjs';
import { makeRowRepairValidator } from '../../scripts/content/repair-adapter.mjs';

const { planRecordRepair, rowRepairSchema, MAX_FIXER_ATTEMPTS } = await import('../../scripts/automation/review-agent.mjs');

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const readJson = (rel) => JSON.parse(read(rel));
const guideHub = readJson('../../data/guide-hub.json');
const businesses = readJson('../../data/businesses.json');
const posts = readJson('../../data/posts.json');
const services = readJson('../../data/services.json');
const neighborhoods = readJson('../../data/neighborhoods.json');
const buildings = readJson('../../data/buildings.json');

const plan = (files, reason = 'repair findings') => ({ plan_type: 'record-repair', files, reason });
const deps = { validateRecord: identityValidateRecord, lintMode: 'fail' };

test('legacy fixer prompt and schema are byte-identical for a posts payload (goldens from 9b23de5)', async () => {
  const input = readJson('./fixtures/legacy-repair-input.json');
  const { previousErrors, ...args } = input;
  const post = args.payload[0].records[0];
  const repaired = { ...post, description: `${post.description} (clarified)` };
  queueAgent(
    { files: [{ file: 'data/posts.json', records: [{ slug: post.slug, record: post }] }], reason: 'first' },
    { files: [{ file: 'data/posts.json', records: [{ slug: post.slug, record: repaired }] }], reason: 'second' },
  );
  let calls = 0;
  const result = await planRecordRepair({
    ...args,
    validate: () => (++calls === 1 ? { ok: false, errors: previousErrors } : { ok: true, errors: [] }),
  });
  assert.equal(result.attempts, 2);
  assert.equal(fakeAgent.calls[0].prompt, read('./fixtures/legacy-repair-prompt-attempt1.txt'));
  assert.equal(fakeAgent.calls[1].prompt, read('./fixtures/legacy-repair-prompt-attempt2.txt'));
  const schema = fakeAgent.calls[0].options.outputFormat.schema;
  assert.deepEqual(schema.properties.files.items.properties.file.enum, ['data/posts.json', 'data/businesses.json', 'data/topics.json']);
  assert.deepEqual(schema.properties.files.items.properties.records.items.required, ['slug', 'record']);

  queueAgent({ files: [{ file: 'data/posts.json', records: [{ slug: post.slug, record: repaired }] }], reason: 'r' });
  await planRecordRepair({ kind: 'news', gateVerdict: args.gateVerdict, payload: args.payload, validate: () => ({ ok: true, errors: [] }) });
  assert.equal(fakeAgent.calls[0].prompt, read('./fixtures/legacy-repair-prompt-minimal.txt'));
});

test('row mode forwards rowRepairSchema(files) and the per-dataset contract to the fixer', async () => {
  const files = ['data/guide-hub.json', 'data/services.json'];
  const schema = rowRepairSchema(files);
  assert.deepEqual(schema.properties.files.items.properties.file.enum, files);
  assert.equal(schema.properties.files.maxItems, 2);
  assert.deepEqual(schema.properties.files.items.properties.records.items.required, ['key', 'record']);
  assert.deepEqual(schema.required, ['files', 'reason']);
  queueAgent({ files: [{ file: 'data/guide-hub.json', records: [{ key: 'guide-hub', record: guideHub }] }], reason: 'r' });
  await planRecordRepair({
    kind: 'seo', gateVerdict: {}, payload: [{ file: 'data/guide-hub.json', records: [guideHub] }],
    validate: () => ({ ok: true, errors: [] }), schema, describeContract: describeRowContract,
  });
  assert.equal(fakeAgent.calls[0].options.outputFormat.schema, schema);
  assert.ok(fakeAgent.calls[0].prompt.includes(describeRowContract('data/guide-hub.json')));
  assert.match(describeRowContract('data/guide-hub.json'), /population, medianRent, walkScore, transitScore[\s\S]*boundaries, history, prosCons, quickFacts, answerSummary/);
});

test('repair rules: legacy three are exactly the legacy objects; new datasets follow the spec table', () => {
  for (const file of ['data/posts.json', 'data/businesses.json', 'data/topics.json']) {
    assert.equal(CONTENT_REPAIR_RULES[file], RECORD_REPAIR_RULES[file], `${file} must not be weakened or copied`);
  }
  assert.equal(CONTENT_REPAIR_RULES['data/topic-queue.json'], undefined);
  assert.deepEqual(validateRowRepair('topic-queue', { key: 'a' }, { key: 'a' }).errors, ['topic-queue has no fixer']);

  const service = services[0];
  assert.ok(validateRowRepair('services', service, { ...service, description: 'Reworded.' }).ok);
  assert.deepEqual(validateRowRepair('services', service, { ...service, pluralName: 'X' }).errors, ['immutable field changed: pluralName', 'repair must change at least one repairable field', 'non-repairable field changed: pluralName']);
  const hood = neighborhoods[0];
  assert.match(validateRowRepair('neighborhoods', hood, { ...hood, walkScore: hood.walkScore + 1, vibe: 'Quiet.' }).errors.join(), /immutable field changed: walkScore/);
  assert.ok(validateRowRepair('neighborhoods', hood, { ...hood, vibe: 'Quiet.' }).ok);
  const building = buildings[0];
  assert.match(validateRowRepair('buildings', building, { ...building, yearBuilt: 1900 }).errors.join(), /immutable field changed: yearBuilt/);
  assert.ok(validateRowRepair('buildings', building, { ...building, description: 'Updated.' }).ok);
  const noKey = { ...service };
  delete noKey.slug;
  assert.match(validateRowRepair('services', service, noKey).errors.join(), /exact top-level key set/);
  // The legacy premise check survives delegation for posts.
  const post = posts.find((candidate) => /pet-friendly/.test(candidate.slug)) || posts[0];
  assert.deepEqual(validateRowRepair('posts', post, { ...post, title: `${post.title}!` }).ok, true);
});

test('a guide-hub repair validates; immutable stats and non-repairable fields are refused', () => {
  const candidates = [{ dataset: 'guide-hub', key: 'guide-hub', op: 'update', payload: guideHub }];
  const validate = makeRowRepairValidator({ kind: 'manual', candidates, ctx: { now: NEWS_NOW }, deps });
  const good = validate(plan([{ file: 'data/guide-hub.json', records: [{ key: 'guide-hub', record: { ...guideHub, answerSummary: 'Liberty Village is a walkable neighbourhood.' } }] }]));
  assert.equal(good.ok, true, good.errors.join('; '));
  assert.deepEqual(good.repaired.map(({ dataset, key }) => `${dataset}/${key}`), ['guide-hub/guide-hub']);
  const bad = validate(plan([{ file: 'data/guide-hub.json', records: [{ key: 'guide-hub', record: { ...guideHub, walkScore: 1 } }] }]));
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.repaired, []);
  assert.ok(bad.errors.every((error) => error.startsWith('data/guide-hub.json: guide-hub: ')), bad.errors.join('; '));
  assert.match(bad.errors.join(), /immutable field changed: walkScore/);
});

test('a non-candidate key, a non-candidate file, a duplicate key and a non-plan are rejected', () => {
  const [one, two] = businesses;
  const candidates = [{ dataset: 'businesses', key: one.slug, op: 'insert', payload: one }];
  const validate = makeRowRepairValidator({ kind: 'business', candidates, deps });
  const edited = { ...one, description: 'Neutral description.' };
  const other = validate(plan([{ file: 'data/businesses.json', records: [{ key: two.slug, record: { ...two, description: 'x' } }] }]));
  assert.equal(other.ok, false);
  assert.deepEqual(other.errors, [`data/businesses.json: ${two.slug}: not a candidate key of this submission`]);
  const wrongFile = validate(plan([{ file: 'data/posts.json', records: [{ key: posts[0].slug, record: posts[0] }] }]));
  assert.match(wrongFile.errors[0], /not a candidate file/);
  const dup = validate(plan([{ file: 'data/businesses.json', records: [{ key: one.slug, record: edited }, { key: one.slug, record: edited }] }]));
  assert.match(dup.errors.join(), /duplicate repaired key/);
  assert.equal(validate({ files: [] }).ok, false, 'isRecordRepairPlan requires plan_type');
  assert.equal(validate(plan([{ file: 'data/businesses.json', records: [{ key: one.slug, record: edited }] }], '')).ok, false, 'reason required');
  const good = validate(plan([{ file: 'data/businesses.json', records: [{ key: one.slug, record: edited }] }]));
  assert.equal(good.ok, true, good.errors.join('; '));
  assert.strictEqual(good.ok, good.errors.length === 0);
});

test('blog repairs re-run the claim linter; seo/manual post edits get storage validation only', () => {
  const post = { ...posts[0], slug: 'lint-probe-post' };
  const linkToNowhere = { ...post, content: `${post.content}\n\nTry [Nowhere Diner](/directory/nowhere-diner-that-does-not-exist) for $12 lunch.` };
  const candidates = [{ dataset: 'posts', key: post.slug, op: 'insert', payload: post }];
  const repairPlan = plan([{ file: 'data/posts.json', records: [{ key: post.slug, record: linkToNowhere }] }]);
  const blog = makeRowRepairValidator({ kind: 'blog', candidates, ctx: { now: NEWS_NOW }, live: { businesses }, deps })(repairPlan);
  assert.equal(blog.ok, false);
  assert.match(blog.errors.join('\n'), /data\/posts\.json: lint-probe-post: \[unrecorded-business\]/);
  const manual = makeRowRepairValidator({ kind: 'manual', candidates: [{ ...candidates[0], op: 'update' }], ctx: { now: NEWS_NOW }, live: { businesses }, deps })(repairPlan);
  assert.equal(manual.ok, true, manual.errors.join('; '));
});

test('a news repair that fails publish-ready blocks: validator refuses it and the fixer exhausts', async () => {
  const root = newsExportRoot(REPO);
  const post = newsPost();
  const ctx = { now: NEWS_NOW, clusterId: 'c9001', evidence: newsEvidence() };
  const news = { root, loadSiteIndex: loadSiteLinkIndex, imageExists: createLocalImageExists(root) };
  const validate = makeRowRepairValidator({
    kind: 'news', candidates: [{ dataset: 'posts', key: post.slug, op: 'insert', payload: post }],
    ctx, live: { businesses, posts }, deps: { ...deps, news },
  });
  const ok = validate(plan([{ file: 'data/posts.json', records: [{ key: post.slug, record: { ...post, description: 'Toronto shortlisted five design teams for a new park at 34 Hanna Avenue.' } }] }]));
  assert.equal(ok.ok, true, ok.errors.join('; '));

  const fabricated = { ...post, content: `${post.content}\n"This park will transform the neighbourhood forever," said Mayor Jane Example on 2026-07-01, citing a $48 million budget.\n` };
  const badPlan = { files: [{ file: 'data/posts.json', records: [{ key: post.slug, record: fabricated }] }], reason: 'bad' };
  const refused = validate(plan(badPlan.files));
  assert.equal(refused.ok, false);
  assert.match(refused.errors.join('\n'), /^data\/posts\.json: city-advances-liberty-village-park-shortlist-2026: news draft is not publish-ready/m);

  queueAgent(...Array.from({ length: MAX_FIXER_ATTEMPTS }, () => badPlan));
  await assert.rejects(
    planRecordRepair({ kind: 'news', gateVerdict: {}, payload: [{ file: 'data/posts.json', records: [post] }], validate, schema: rowRepairSchema(['data/posts.json']), describeContract: describeRowContract }),
    /invalid repair plan: .*news draft is not publish-ready/,
  );
  assert.equal(fakeAgent.calls.length, MAX_FIXER_ATTEMPTS);
  assert.match(fakeAgent.calls[1].prompt, /Your previous plan was rejected by that validation/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('blog-live repairs keep validateSubmittedPost with the stored topic key and run date', () => {
  const post = {
    ...newsPost({ category: 'community', slug: 'liberty-village-park-guide', tags: ['a', 'b', 'c', 'd'] }),
    faqs: Array.from({ length: 4 }, (_, index) => ({ question: `Q${index}?`, answer: `A${index}.` })),
    keyTakeaways: ['one', 'two', 'three', 'four'],
  };
  const ctx = { now: NEWS_NOW, topicKey: 'f'.repeat(64) };
  const validate = makeRowRepairValidator({ kind: 'blog-live', candidates: [{ dataset: 'posts', key: post.slug, op: 'insert', payload: post }], ctx, live: { businesses }, deps });
  const ok = validate(plan([{ file: 'data/posts.json', records: [{ key: post.slug, record: { ...post, title: 'A park guide' } }] }]));
  assert.equal(ok.ok, true, ok.errors.join('; '));
  const tooFewTags = validate(plan([{ file: 'data/posts.json', records: [{ key: post.slug, record: { ...post, tags: ['a'] } }] }]));
  assert.match(tooFewTags.errors.join(), /tags must contain 4-6 entries/);
});
