import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
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

test('weekly blog prompt does not offer the news category refused by submit', () => {
  const prompt = fs.readFileSync(path.join(repo, 'scripts', 'prompts', 'weekly-blog-system.md'), 'utf8');
  const selected = prompt.match(/- Category: \[one of: ([^\]]+)\]/)?.[1]?.split(', ');
  const required = prompt.match(/\| `category`\s*\| enum\s*\| One of: ([^|]+)\|/)?.[1]?.trim().split(', ');
  assert.ok(selected?.length, 'topic selection lists allowed categories');
  assert.deepEqual(required, selected, 'the category field agrees with topic selection');
  assert.equal(selected.includes('news'), false, 'blog submit refuses category news');
  assert.doesNotMatch(prompt.match(/  category:\s*([\s\S]*?);/)?.[1] ?? '', /"news"/);
});

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
    category: 'food-drink', image,
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

async function captureOutcome(run) {
  const lines = [], details = [], output = [];
  const original = console.log;
  console.log = (...parts) => {
    const line = parts.join(' ');
    output.push(line);
    if (line.startsWith('[outcome] ')) lines.push(JSON.parse(line.slice('[outcome] '.length)));
    if (line.startsWith('[outcome-detail] ')) details.push(JSON.parse(line.slice('[outcome-detail] '.length)));
    original(...parts);
  };
  try {
    return { result: await run(), outcomes: lines, details, stdout: output.join('\n') + '\n' };
  } finally {
    console.log = original;
  }
}

function replayHelper(source, stdout) {
  const result = spawnSync('python3', ['-B', '-c', `
import json, pathlib, sys, tempfile
payload = json.load(sys.stdin)
module = {'__name__': 'compat_helper'}
exec(payload['source'], module)
module['os'].geteuid = lambda: 0
with tempfile.TemporaryDirectory() as directory:
    path = pathlib.Path(directory) / 'slot.jsonl'
    log = module['GeneratorDiagnostic'](str(path))
    log.feed_lines(payload['stdout'].encode())
    log.close()
    print(json.dumps({'relay': json.loads(log.relay(1)), 'events': [json.loads(line) for line in path.read_text().splitlines()]}))
`], { input: JSON.stringify({ source, stdout }), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('new agent refusal relays through the old installed helper and new helper keeps detail', async (t) => {
  const root = tempRoot(t);
  const output = await captureOutcome(() => runPipeline({ query: () => { throw new Error('preflight must not invoke SDK'); }, root, now,
    env: { TOPIC_OVERRIDE: 'Pet-Friendly Restaurants in Liberty Village', GOOGLE_APPLICATION_CREDENTIALS: path.join(root, 'gcp.json') } }));
  const old = fs.readFileSync(path.join(repo, 'tests/fixtures/generator_diag_b4cd3ae.py'), 'utf8');
  const expected = { postWritten: false, stopReason: 'unsupported-grounding' };
  assert.deepEqual(replayHelper(old, output.stdout).relay, expected, 'old helper must not return absent');
  assert.deepEqual(output.outcomes, [expected], 'authoritative outcome stays exactly two keys');
  const current = replayHelper(fs.readFileSync(path.join(repo, 'ops/exedev-runner/generator_diag.py'), 'utf8'), output.stdout);
  assert.deepEqual(current.relay, expected);
  const detail = current.events.find((event) => event.event === 'outcome-detail');
  assert.equal(detail.detailReason, 'unsupported-operational-premise');
  assert.deepEqual(detail.validationCodes, []);
});

test('live operational facts: pet refuses and happy hour has exactly two supported sources', () => {
  const pet = buildSourcePack({ topic: 'Pet-Friendly Restaurants in Liberty Village', businesses, posts, services, topics, now });
  assert.equal(pet.ok, false);
  assert.equal(pet.reason, 'unsupported-operational-premise');
  assert.equal(pet.supportingRecords, 0);
  const happy = buildSourcePack({ topic: 'Liberty Village Happy Hour', businesses, posts, services, topics, now });
  assert.equal(happy.ok, true);
  assert.equal(happy.pack.intentKey, 'liberty-village-happy-hour');
  assert.match(happy.pack.fingerprint, /^[a-f0-9]{64}$/);
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

test('fingerprint binds canonical evidence while intentKey stays the topic identity', () => {
  const args = { topic: 'Liberty Village Happy Hour', businesses, posts, services, topics };
  const first = buildSourcePack({ ...args, now });
  const later = buildSourcePack({ ...args, now: new Date('2026-09-29T12:00:00.000Z') });
  assert.equal(first.pack.fingerprint, later.pack.fingerprint);
  assert.equal(first.pack.intentKey, later.pack.intentKey);
  const editedBusinesses = structuredClone(businesses);
  editedBusinesses.find((record) => record.slug === 'local-public-eatery').address += ' Suite 1';
  const changed = buildSourcePack({ ...args, businesses: editedBusinesses, now });
  assert.equal(changed.ok, true);
  assert.equal(changed.pack.intentKey, first.pack.intentKey);
  assert.notEqual(changed.pack.fingerprint, first.pack.fingerprint);
  assert.equal(buildSourcePack({ ...args, topic: posts[0].title, now }).reason, 'duplicate-topic');
});

test('verification rejects forged IDs, altered digests, future and stale packs', () => {
  const pack = buildSourcePack({ topic: 'Liberty Village Happy Hour', businesses, posts, services, topics, now }).pack;
  const inputs = { businesses, posts, services, topics, now };
  const forged = structuredClone(pack);
  forged.sources[0].id = 'imaginary-business';
  assert.ok(verifySourcePack(forged, inputs).errors.some((error) => error.startsWith('invalid-source:')));
  const altered = structuredClone(pack);
  altered.fingerprint = '0'.repeat(64);
  assert.ok(verifySourcePack(altered, inputs).errors.includes('invalid-fingerprint'));
  assert.ok(verifySourcePack(pack, { ...inputs, now: new Date('2026-09-28T11:59:59.999Z') }).errors.includes('future-generated-at'));
  assert.ok(verifySourcePack(pack, { ...inputs, now: new Date('2026-09-29T12:00:00.000Z'), maxAgeMs: 60_000 }).errors.includes('stale-generated-at'));
});

test('storage-invalid or backdated drafts fail before the content submit handoff', (t) => {
  const root = tempRoot(t);
  const pack = buildSourcePack({ topic: 'Liberty Village Happy Hour', businesses, posts, services, topics, now }).pack;
  const inputs = { businesses, posts, services, topics, imagePaths: [draft(root).image], now };
  assert.equal(checkDraftAgainstPack(draft(root), pack, inputs).ok, true);
  const unsupported = { ...draft(root), relatedBusinesses: ['local-public-eatery'] };
  assert.ok(checkDraftAgainstPack(unsupported, pack, inputs).errors.includes('storage:unknown field: relatedBusinesses'));
  const backdated = { ...draft(root), publishedAt: '2026-09-01' };
  assert.ok(checkDraftAgainstPack(backdated, pack, { ...inputs, requireRealDate: true }).errors.includes('draft-must-use-real-publish-date'));
});

test('imaginary directory and blog links are refused', (t) => {
  const root = tempRoot(t);
  const pack = buildSourcePack({ topic: 'Liberty Village Happy Hour', businesses, posts, services, topics, now }).pack;
  const post = draft(root);
  post.content += ' [Ghost](/directory/imaginary-business) [Story](/blog/imaginary-post)';
  const result = checkDraftAgainstPack(post, pack, { businesses, posts, services, topics, imagePaths: [post.image], now });
  assert.ok(result.errors.includes('invalid-internal-link:/directory/imaginary-business'));
  assert.ok(result.errors.includes('invalid-internal-link:/blog/imaginary-post'));
});

test('pet premise spends zero SDK queries in a temporary live-data copy', async (t) => {
  const root = tempRoot(t);
  const original = fs.readFileSync(path.join(root, 'data', 'posts.json'), 'utf8');
  let calls = 0;
  const { result, outcomes, details } = await captureOutcome(() => runPipeline({ query: () => { calls++; throw new Error('should not run'); }, root, now, env: { TOPIC_OVERRIDE: 'Pet-Friendly Restaurants in Liberty Village', GOOGLE_APPLICATION_CREDENTIALS: path.join(root, 'gcp.json') } }));
  assert.equal(calls, 0);
  assert.equal(result.stopReason, 'unsupported-grounding');
  assert.equal(result.detailReason, 'unsupported-operational-premise');
  assert.deepEqual(outcomes, [{ postWritten: false, stopReason: 'unsupported-grounding' }]);
  assert.deepEqual(details, [{ detailReason: 'unsupported-operational-premise', validationCodes: [] }]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'tasks', 'auto-blog-runs', '2026-09-28.json'))).detailReason, 'unsupported-operational-premise');
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
  const { result, outcomes, details } = await captureOutcome(() => runPipeline({ query: () => { calls++; return stub(); }, root, now, env: { TOPIC_OVERRIDE: 'Liberty Village Happy Hour', GOOGLE_APPLICATION_CREDENTIALS: path.join(root, 'gcp.json') } }));
  assert.equal(calls, 1);
  assert.equal(result.postWritten, false);
  assert.equal(result.stopReason, 'unsupported-grounding');
  assert.equal(result.detailReason, 'pre-submit-refused');
  assert.deepEqual(outcomes, [{ postWritten: false, stopReason: 'unsupported-grounding' }]);
  assert.equal(details.length, 1);
  assert.equal(details[0].detailReason, 'pre-submit-refused');
  assert.ok(details[0].validationCodes.includes('blog-lint:unsupported-address'));
  assert.ok(details[0].validationCodes.length <= 10);
  assert.ok(details[0].validationCodes.every((code) => code.length <= 64));
  assert.doesNotMatch(JSON.stringify({ outcomes, details }), /999|Imaginary|LOCAL Public Eatery/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'tasks', 'auto-blog-runs', '2026-09-28.json'))).detailReason, 'pre-submit-refused');
  assert.ok(result.errors.some((error) => error.includes('blog-lint:unsupported-address')));
  assert.equal(fs.readFileSync(file, 'utf8'), original);
});
