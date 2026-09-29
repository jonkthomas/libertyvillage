import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { buildSourcePack, canonicalJson, checkDraftAgainstPack, verifySourcePack, SOURCE_PACK_SCHEMA } from '../../scripts/automation/blog-source-pack.mjs';

const require = createRequire(import.meta.url);
const { runPipeline } = require('../../scripts/weekly-blog-agent.js');
const repo = path.resolve(import.meta.dirname, '../..');
const read = (file) => JSON.parse(fs.readFileSync(path.join(repo, 'data', file), 'utf8'));
const businesses = read('businesses.json');
const posts = read('posts.json');
const services = read('services.json');
const topics = read('topics.json');
const now = new Date('2026-09-28T12:00:00.000Z');

function tempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cq-blog-pack-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const name of ['businesses.json', 'posts.json', 'services.json', 'topics.json']) {
    fs.mkdirSync(path.join(root, 'data'), { recursive: true });
    fs.copyFileSync(path.join(repo, 'data', name), path.join(root, 'data', name));
  }
  fs.mkdirSync(path.join(root, 'scripts', 'prompts'), { recursive: true });
  fs.copyFileSync(path.join(repo, 'scripts', 'prompts', 'weekly-blog-system.md'), path.join(root, 'scripts', 'prompts', 'weekly-blog-system.md'));
  fs.writeFileSync(path.join(root, 'gcp.json'), '{}');
  return root;
}

function draft(root, address = '') {
  const slug = 'liberty-village-happy-hour-two-places';
  const image = `/images/blog/${slug}.jpg`;
  const filename = path.join(root, 'public', image.slice(1));
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, Buffer.alloc(11_000));
  return {
    slug, title: 'Liberty Village Happy Hour: Two Recorded Places',
    content: `**LOCAL Public Eatery** and [Cibo](/directory/cibo-liberty-village) have happy-hour references in their directory records. ${address}`,
    description: 'A narrow directory-backed look at two local happy-hour references.',
    answerBlock: 'The directory records mention happy hour for LOCAL Public Eatery and Cibo.',
    category: 'food-drink', image, relatedBusinesses: ['local-public-eatery', 'cibo-liberty-village'],
    relatedPosts: [], relatedServices: [], relatedTopics: [], faqs: [], keyTakeaways: [],
    publishedAt: '2026-09-28', updatedAt: '2026-09-28', author: 'LibertyVillage.co', tags: ['happy-hour'],
  };
}

function stubWriting(root, address = '') {
  return () => ({
    async next() {
      if (!this.done) {
        this.done = true;
        const file = path.join(root, 'data', 'posts.json');
        const current = JSON.parse(fs.readFileSync(file, 'utf8'));
        current.push(draft(root, address));
        fs.writeFileSync(file, JSON.stringify(current));
        return { done: false, value: { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1 } };
      }
      return { done: true };
    },
  });
}

test('live operational facts: pet refuses and happy hour has exactly two supported sources', () => {
  const pet = buildSourcePack({ topic: 'Pet-Friendly Restaurants in Liberty Village', businesses, posts, services, topics, now });
  assert.equal(pet.ok, false);
  assert.equal(pet.reason, 'unsupported-operational-premise');
  assert.equal(pet.supportingRecords, 0);
  const happy = buildSourcePack({ topic: 'Liberty Village Happy Hour', businesses, posts, services, topics, now });
  assert.equal(happy.ok, true);
  assert.deepEqual(happy.pack.sources.map((source) => source.id), ['cibo-liberty-village', 'local-public-eatery']);
  assert.equal(verifySourcePack(happy.pack, { businesses, posts, services, topics }).ok, true);
  assert.ok(canonicalJson(happy.pack).length <= SOURCE_PACK_SCHEMA.maxSerializedCharacters);
  assert.ok(happy.pack.sources.every((source) => source.claims.every((claim) => claim.verbatim.length <= SOURCE_PACK_SCHEMA.maxVerbatimCharacters)));
  const tampered = structuredClone(happy.pack);
  tampered.sources[0].claims[0].verbatim = 'fabricated';
  assert.equal(verifySourcePack(tampered, { businesses, posts, services, topics }).ok, false);
  assert.equal(buildSourcePack({ topic: 'Liberty Village Happy Hour', businesses, posts, services, topics, now, reserve: true }).ok, false);
  const reserve = buildSourcePack({ topic: 'Liberty Village Coffee Shops', businesses, posts, services, topics, now, reserve: true });
  assert.equal(reserve.ok, true);
  assert.ok(new Set(reserve.pack.sources.map((source) => source.id)).size >= 3);
  assert.ok(reserve.pack.sources.reduce((count, source) => count + source.claims.length, 0) >= 6);
  assert.equal(verifySourcePack(reserve.pack, { businesses, posts, services, topics }).ok, true);
});

test('pet premise spends zero SDK queries in a temporary live-data copy', async (t) => {
  const root = tempRoot(t);
  const original = fs.readFileSync(path.join(root, 'data', 'posts.json'), 'utf8');
  let calls = 0;
  const result = await runPipeline({ query: () => { calls++; throw new Error('should not run'); }, root, now, env: { TOPIC_OVERRIDE: 'Pet-Friendly Restaurants in Liberty Village', GOOGLE_APPLICATION_CREDENTIALS: path.join(root, 'gcp.json') } });
  assert.equal(calls, 0);
  assert.equal(result.stopReason, 'unsupported-operational-premise');
  assert.equal(result.postWritten, false);
  assert.equal(fs.readFileSync(path.join(root, 'data', 'posts.json'), 'utf8'), original);
});

test('happy hour spends one SDK query, persists canonical pack, and accepts a grounded draft', async (t) => {
  const root = tempRoot(t);
  let calls = 0;
  let suppliedPrompt = '';
  const stub = stubWriting(root);
  const result = await runPipeline({ query: (args) => { calls++; suppliedPrompt = args.prompt; return stub(); }, root, now, env: { TOPIC_OVERRIDE: 'Liberty Village Happy Hour', GOOGLE_APPLICATION_CREDENTIALS: path.join(root, 'gcp.json') } });
  assert.equal(calls, 1);
  assert.equal(result.postWritten, true);
  assert.equal(result.stopReason, 'post-written');
  assert.match(suppliedPrompt, /SOURCE PACK/);
  assert.match(suppliedPrompt, /A two-business article is allowed/);
  const sidecar = path.join(root, 'tasks', 'auto-blog-runs', '2026-09-28-liberty-village-happy-hour-source-pack.json');
  const pack = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
  assert.equal(fs.readFileSync(sidecar, 'utf8'), `${canonicalJson(pack)}\n`);
  assert.equal(checkDraftAgainstPack(draft(root), pack, { businesses, posts, services, topics, imagePaths: [draft(root).image], now }).ok, true);
  const ambiguous = { ...draft(root), content: '**LOCAL Public Eatery** and **Cibo Wine Bar** have happy-hour references.' };
  assert.ok(checkDraftAgainstPack(ambiguous, pack, { businesses, posts, services, topics, imagePaths: [ambiguous.image], now }).errors.some((error) => error.includes('business-outside-pack:cibo-wine-bar')));
  assert.ok(checkDraftAgainstPack(draft(root), pack, { businesses, posts, services, topics, imagePaths: [], now }).errors.includes('missing-or-invalid-hero-image'));
});

test('unsupported address is refused before handoff and temp posts are restored', async (t) => {
  const root = tempRoot(t);
  const file = path.join(root, 'data', 'posts.json');
  const original = fs.readFileSync(file, 'utf8');
  let calls = 0;
  const stub = stubWriting(root, 'LOCAL Public Eatery is at 999 Imaginary St.');
  const result = await runPipeline({ query: () => { calls++; return stub(); }, root, now, env: { TOPIC_OVERRIDE: 'Liberty Village Happy Hour', GOOGLE_APPLICATION_CREDENTIALS: path.join(root, 'gcp.json') } });
  assert.equal(calls, 1);
  assert.equal(result.postWritten, false);
  assert.equal(result.stopReason, 'pre-submit-refused');
  assert.ok(result.errors.some((error) => error.includes('blog-lint:unsupported-address')));
  assert.equal(fs.readFileSync(file, 'utf8'), original);
});
