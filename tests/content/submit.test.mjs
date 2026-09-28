// B1 submit against the real store (lv_test_*), including the C writer shape
// (`export --root .` -> writer edits data/*.json -> `submit --dir .` -> `gate`)
// through the real cli.mjs. Only the agent SDK is faked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fakeAgent, queueAgent } from './fixtures/agent-sdk-mock.mjs';
import { GATE_MODEL } from '../../scripts/automation/constants.mjs';
import { topicKey } from '../../scripts/automation/topic-queue.mjs';
import * as store from '../../scripts/content/store.mjs';
import { submitContent } from '../../scripts/content/submit.mjs';
import { baselineFile, FAST_SMOKE, liveRecord, localSite, seededDb, seedRecords, tempJson } from './fixtures/content-db.mjs';
import { NEWS_NOW, newsEvidence, newsPost } from './fixtures/news.mjs';

// gate.mjs/cli.mjs reach the agent SDK: import only after the fake is registered.
const { runCli } = await import('../../scripts/content/cli.mjs');
const { gateContent } = await import('../../scripts/content/gate.mjs');

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const SEED = seedRecords();
const JPEG = (tag) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(tag)]);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
const passingReview = ({ prompt }) => ({ overall: 8.7, findings: [], model: GATE_MODEL, commit_sha: /set commit_sha exactly ([0-9a-f]{40})/.exec(prompt)[1] });
const PASS = tempJson({ reviews: [{ overall: 8.5, findings: [] }] }, 'pass.json');

async function withEnv(env, fn) {
  const saved = Object.fromEntries([...Object.keys(env), 'GITHUB_ACTIONS', 'GITHUB_WORKFLOW', 'GITHUB_RUN_ID'].map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  try { return await fn(); } finally {
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
}

async function withSite(fn) {
  const handle = await seededDb();
  const site = await localSite(handle.db);
  await site.build();
  try { return await fn(handle, site); } finally { await site.close(); await handle.close(); }
}

// The writer's root is a git checkout (C runs `export --root .` in it), so unchanged
// /images paths resolve at HEAD. A shared, no-checkout clone of this worktree's HEAD.
function writerCheckout() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-checkout-'));
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();
  execFileSync('git', ['clone', '--quiet', '--shared', '--no-checkout', REPO, dir]);
  execFileSync('git', ['update-ref', '--no-deref', 'HEAD', head], { cwd: dir });
  return dir;
}

const submit = (db, opts) => submitContent(db, { actor: 'uat:test', ...opts }, { checkout: REPO });
const refused = (promise, pattern) => assert.rejects(promise, (error) => error.code === 'ValidationError' && pattern.test(error.message));

test('C writer shape: export --root . -> edit data/*.json -> submit --dir . -> gate, through cli.mjs (GHA env)', async () => {
  await withSite(async ({ db, name }, site) => {
    await withEnv({ ...site.env, CONTENT_DB_NAME: name, CONTENT_TARGET: 'test', GITHUB_ACTIONS: 'true', GITHUB_WORKFLOW: 'discover-businesses', GITHUB_RUN_ID: '4242' }, async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-writer-'));
      assert.equal((await runCli(['export', '--root', root])).exitCode, 0);
      assert.ok(fs.existsSync(path.join(root, '.content-export/manifest.json')));
      // Zero results: nothing changed -> submissionId null, exit 0.
      const none = await runCli(['submit', '--dir', root, '--kind', 'business', '--idempotency-key', 'gha:discover-businesses:4242:0']);
      assert.deepEqual([none.exitCode, none.result], [0, { submissionId: null, reason: 'no-changes' }]);

      // The generator appends a business with a new image and records it as seen.
      fs.mkdirSync(path.join(root, 'public/images/businesses'), { recursive: true });
      const image = JPEG('writer-new-business');
      fs.writeFileSync(path.join(root, 'public/images/businesses/Writer Cafe.jpg'), image);
      const businesses = readJson(path.join(root, 'data/businesses.json'));
      businesses.push({ ...SEED.businesses[0], slug: 'writer-cafe', name: 'Writer Cafe', image: '/images/businesses/Writer Cafe.jpg' });
      writeJson(path.join(root, 'data/businesses.json'), businesses);
      writeJson(path.join(root, 'data/discovery-seen.json'), { 'writer cafe': '2026-09-27' });

      const submitted = await runCli(['submit', '--dir', root, '--kind', 'business', '--idempotency-key', 'gha:discover-businesses:4242:1']);
      assert.equal(submitted.exitCode, 0, JSON.stringify(submitted.result));
      const id = submitted.result.submissionId;
      assert.equal(typeof id, 'number', 'top-level submissionId');
      assert.deepEqual(submitted.result.items, [{ dataset: 'businesses', key: 'writer-cafe', op: 'insert', rev: 1, expectedLiveRev: null }]);
      const mediaPath = `/media/${sha256(image).slice(0, 16)}/writer-cafe.jpg`;
      assert.deepEqual(submitted.result.assets, [{ sha256: sha256(image), path: mediaPath, deduped: false }]);
      assert.equal(submitted.result.discoverySeenAdded, 1);
      const { submission } = await store.getSubmission(db, id);
      assert.equal(submission.actor, 'gha:discover-businesses#4242', 'GHA default actor');

      queueAgent(passingReview);
      const gated = await runCli(['gate', '--submission', String(id)]);
      assert.equal(gated.exitCode, 0, JSON.stringify(gated.result));
      assert.deepEqual(gated.result.published.map(({ dataset, key, url }) => [dataset, key, url]), [['businesses', 'writer-cafe', `${site.origin}/directory/writer-cafe`]]);
      assert.equal(fakeAgent.calls.length, 1);
      assert.equal((await liveRecord(db, 'businesses', 'writer-cafe')).image, mediaPath);
      assert.equal((await fetch(`${site.origin}${mediaPath}`)).headers.get('content-type'), 'image/jpeg');
      const seen = (await db.query("select outcome from content.discovery_seen where name_key='writer cafe'")).rows[0];
      assert.equal(seen.outcome, 'added');

      // A workspace that dropped a baseline record is a deletion: refused (CLI exit 2).
      writeJson(path.join(root, 'data/businesses.json'), businesses.slice(1));
      await refused(runCli(['submit', '--dir', root, '--kind', 'business', '--idempotency-key', 'gha:discover-businesses:4242:2']), /deletion refused/);
    });
  });
});

test('C writer shapes for seo and topic-discovery: multi-record diff, update expectedLiveRev from the baseline', async () => {
  await withSite(async ({ db }, site) => {
    const root = writerCheckout();
    await (await import('../../scripts/content/export.mjs')).exportContent(db, { root });
    const services = readJson(path.join(root, 'data/services.json'));
    services[0] = { ...services[0], description: `${services[0].description} Updated for 2026.` };
    writeJson(path.join(root, 'data/services.json'), services);
    const hub = readJson(path.join(root, 'data/guide-hub.json'));
    writeJson(path.join(root, 'data/guide-hub.json'), { ...hub, answerSummary: `${hub.answerSummary} (updated)` });
    const seo = await submit(db, { dir: root, kind: 'seo', idempotencyKey: 'gha:weekly-seo-improvements:1:1' });
    assert.deepEqual(seo.result.items.map(({ dataset, op, expectedLiveRev }) => [dataset, op, expectedLiveRev]), [['guide-hub', 'update', 1], ['services', 'update', 1]]);
    const gated = await gateContent(db, { submission: seo.result.submissionId, script: PASS, actor: 'uat:test' }, { env: site.env, deps: { smoke: FAST_SMOKE }, checkout: REPO });
    assert.equal(gated.exitCode, 0, JSON.stringify(gated.result));

    const queueRoot = writerCheckout();
    await (await import('../../scripts/content/export.mjs')).exportContent(db, { root: queueRoot });
    const queue = readJson(path.join(queueRoot, 'data/topic-queue.json'));
    const title = 'Best dog parks near Liberty Village';
    queue.topics.push({ key: topicKey('blog', title, 'blog/auto-'), kind: 'blog', title, source: 'serpapi-paa', rationale: 'local intent', addedAt: '2026-09-27', attempts: 0, branchPrefix: 'blog/auto-' });
    writeJson(path.join(queueRoot, 'data/topic-queue.json'), queue);
    const topics = await submit(db, { dir: queueRoot, kind: 'topic-discovery', idempotencyKey: 'gha:weekly-topic-discovery:1:1' });
    assert.deepEqual(topics.result.items.map(({ dataset, op }) => [dataset, op]), [['topic-queue', 'insert']]);
    const queued = await gateContent(db, { submission: topics.result.submissionId, script: PASS, actor: 'uat:test' }, { env: site.env, deps: { smoke: FAST_SMOKE }, checkout: REPO });
    assert.equal(queued.exitCode, 0, JSON.stringify(queued.result));
    assert.equal((await store.getSubmission(db, topics.result.submissionId)).items[0].smoke, 'passed', 'snapshot adapter');
    // A queue mutation (existing entry edited) is refused for topic-discovery, and seo may not touch the queue.
    queue.topics[0] = { ...queue.topics[0], attempts: 5 };
    writeJson(path.join(queueRoot, 'data/topic-queue.json'), queue);
    await refused(submit(db, { dir: queueRoot, kind: 'topic-discovery', idempotencyKey: 'q2' }), /may not update topic-queue/);
    await refused(submit(db, { dir: queueRoot, kind: 'seo', idempotencyKey: 'q3' }), /seo may not write topic-queue/);
  });
});

test('kind policy refusals before any write: 2 post inserts, unknown field, bad image, record-file unknown dataset', async () => {
  const { db, close } = await seededDb();
  try {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-policy-'));
    await (await import('../../scripts/content/export.mjs')).exportContent(db, { root });
    const posts = readJson(path.join(root, 'data/posts.json'));
    writeJson(path.join(root, 'data/posts.json'), [...posts, { ...posts[0], slug: 'extra-one' }, { ...posts[0], slug: 'extra-two' }]);
    await refused(submit(db, { dir: root, kind: 'blog', idempotencyKey: 'p2' }), /blog requires exactly 1 record\(s\), got 2/);
    const baseline = await baselineFile(db);
    await refused(submit(db, { kind: 'manual', idempotencyKey: 'u1', recordFile: tempJson({ ...SEED.businesses[0], slug: 'unknown-field', surprise: true }), dataset: 'businesses', baseline }), /unknown field: surprise/);
    await refused(submit(db, { kind: 'manual', idempotencyKey: 'i1', recordFile: tempJson({ ...SEED.businesses[0], slug: 'bad-image', image: '/images/businesses/not-there.jpg' }), dataset: 'businesses', baseline }), /^image-missing: /);
    await refused(submit(db, { kind: 'manual', idempotencyKey: 'd1', recordFile: tempJson({ nameKey: 'x' }), dataset: 'discovery-seen', baseline }), /unknown dataset/);
    await refused(submit(db, { kind: 'manual', idempotencyKey: 'n1' }), /--dir or --record-file/);
    await refused(submit(db, { kind: 'bogus', idempotencyKey: 'k1', dir: root }), /unsupported submit kind/);
    assert.equal((await db.query("select count(*)::int as n from content.submissions where kind <> 'seed'")).rows[0].n, 0, 'nothing written');
  } finally { await close(); }
});

test('a changed AND a new neighbourhood image -> /media rewrite -> export -> page smoke passes', async () => {
  await withSite(async ({ db }, site) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-hood-'));
    await (await import('../../scripts/content/export.mjs')).exportContent(db, { root });
    const hoods = readJson(path.join(root, 'data/neighborhoods.json'));
    const changed = JPEG('changed-hood-image');
    const added = JPEG('new-hood-image');
    fs.mkdirSync(path.join(root, 'public/images/neighborhoods'), { recursive: true });
    fs.writeFileSync(path.join(root, `public${hoods[0].image}`), changed); // same path, new bytes (untracked here)
    fs.writeFileSync(path.join(root, 'public/images/neighborhoods/new-hood.jpg'), added);
    hoods.push({ ...hoods[1], slug: 'new-hood', name: 'New Hood', image: '/images/neighborhoods/new-hood.jpg' });
    hoods[0] = { ...hoods[0], vibe: `${hoods[0].vibe} Refreshed.` };
    writeJson(path.join(root, 'data/neighborhoods.json'), hoods);
    const out = await submit(db, { dir: root, kind: 'seo', idempotencyKey: 'hood-images' });
    const byKey = Object.fromEntries(out.result.items.map((item) => [item.key, item]));
    assert.equal(byKey['new-hood'].op, 'insert');
    assert.equal(byKey[hoods[0].slug].op, 'update');
    assert.deepEqual(out.result.assets.map((asset) => asset.sha256).sort(), [sha256(changed), sha256(added)].sort());
    const gated = await gateContent(db, { submission: out.result.submissionId, script: PASS, actor: 'uat:test' }, { env: site.env, deps: { smoke: FAST_SMOKE }, checkout: REPO });
    assert.equal(gated.exitCode, 0, JSON.stringify(gated.result));
    assert.equal(gated.result.smoke, 'passed');
    const exportRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-hood-export-'));
    await (await import('../../scripts/content/export.mjs')).exportContent(db, { root: exportRoot, withAssets: true });
    const exported = readJson(path.join(exportRoot, 'data/neighborhoods.json'));
    for (const [slug, bytes] of [[hoods[0].slug, changed], ['new-hood', added]]) {
      const record = exported.find((hood) => hood.slug === slug);
      assert.match(record.image, /^\/media\/[0-9a-f]{16}\//);
      assert.equal(sha256(fs.readFileSync(path.join(exportRoot, 'public', record.image))), sha256(bytes));
      const served = Buffer.from(await (await fetch(`${site.origin}${record.image}`)).arrayBuffer());
      assert.equal(sha256(served), sha256(bytes), 'deployed bytes');
      assert.equal((await fetch(`${site.origin}/vs/${slug}`)).status, 200);
    }
  });
});

test('blog-live policy: date/author/topic checks and a stale --generated-at', async () => {
  const { db, close } = await seededDb();
  try {
    const baseline = await baselineFile(db);
    const generatedAt = new Date(Date.now() - 2 * 3_600_000).toISOString();
    const day = generatedAt.slice(0, 10);
    const post = {
      ...newsPost({ slug: 'blog-live-policy', category: 'lifestyle', publishedAt: day, updatedAt: day, image: '/images/blog/best-bars-liberty-village-toronto-guide-2026.jpg', tags: ['a', 'b', 'c', 'd'] }),
      content: '## Parks\n\nShort loops connect the neighbourhood parks.\n',
      faqs: [1, 2, 3, 4].map((n) => ({ question: `Q${n}?`, answer: `A${n}.` })), keyTakeaways: ['1', '2', '3', '4'],
    };
    const args = (record, extra = {}) => ({ kind: 'blog-live', idempotencyKey: `bl:${Math.random()}`, recordFile: tempJson(record), dataset: 'posts', baseline, topicKey: 'c'.repeat(64), generatedAt, ...extra });
    const ok = await submit(db, args(post));
    assert.equal(ok.exitCode, 0);
    const { submission } = await store.getSubmission(db, ok.result.submissionId);
    assert.deepEqual(submission.context, { now: new Date(generatedAt).toISOString(), topicKey: 'c'.repeat(64) });
    await refused(submit(db, args({ ...post, slug: 'bl-author', author: 'Someone Else' })), /author must be LibertyVillage\.co/);
    await refused(submit(db, args({ ...post, slug: 'bl-date', publishedAt: '2026-01-01', updatedAt: '2026-01-01' })), /run date/);
    await refused(submit(db, args({ ...post, slug: 'bl-stale' }, { generatedAt: '2026-01-01T00:00:00Z' })), /more than 36 h before submit/);
    await refused(submit(db, args({ ...post, slug: 'bl-topic' }, { topicKey: undefined })), /requires --topic-key/);
  } finally { await close(); }
});

test('news uses result.now, evidence and structuredData; a missing --news-out fails', async () => {
  const { db, close } = await seededDb();
  try {
    const baseline = await baselineFile(db);
    const post = newsPost({ image: '/images/og/og-guide.jpg' });
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-news-out-'));
    writeJson(path.join(out, 'result.json'), { now: NEWS_NOW, clusterId: 'c9001', slug: post.slug, published: 1 });
    writeJson(path.join(out, 'evidence-c9001.json'), newsEvidence());
    const ok = await submit(db, { kind: 'news', idempotencyKey: 'news-1', recordFile: tempJson(post), dataset: 'posts', baseline, newsOut: out });
    assert.equal(ok.exitCode, 0, JSON.stringify(ok.result));
    const { submission } = await store.getSubmission(db, ok.result.submissionId);
    assert.equal(submission.context.now, NEWS_NOW);
    assert.equal(submission.context.clusterId, 'c9001');
    assert.deepEqual(submission.context.evidence, newsEvidence());
    await refused(submit(db, { kind: 'news', idempotencyKey: 'news-2', recordFile: tempJson({ ...post, slug: 'news-two' }), dataset: 'posts', baseline }), /news requires --news-out/);
    const fabricated = { ...post, slug: 'news-three', content: `${post.content}\n"This park will transform the neighbourhood forever," said Mayor Jane Example on 2026-07-01, citing a $48 million budget.\n` };
    writeJson(path.join(out, 'result.json'), { now: NEWS_NOW, clusterId: 'c9001', slug: 'news-three', published: 1 });
    await refused(submit(db, { kind: 'news', idempotencyKey: 'news-3', recordFile: tempJson(fabricated), dataset: 'posts', baseline, newsOut: out }), /news draft is not publish-ready/);
    writeJson(path.join(out, 'result.json'), { now: NEWS_NOW, clusterId: 'c9001', slug: 'other-slug', published: 1 });
    await refused(submit(db, { kind: 'news', idempotencyKey: 'news-4', recordFile: tempJson({ ...post, slug: 'news-four' }), dataset: 'posts', baseline, newsOut: out }), /slug does not match/);
  } finally { await close(); }
});

test('a historical manual post edit is not subject to generation checks', async () => {
  const { db, close } = await seededDb();
  try {
    const old = SEED.posts[0];
    assert.ok(old.publishedAt < '2026-09-01');
    const edit = { ...old, description: `${old.description} Updated.`, content: `${old.content}\n\nSee [Nowhere Diner](/directory/nowhere-diner) for a $12 lunch.` };
    const out = await submit(db, { kind: 'manual', idempotencyKey: 'hist', recordFile: tempJson(edit), dataset: 'posts', baseline: await baselineFile(db) });
    assert.equal(out.exitCode, 0);
    assert.deepEqual(out.result.items.map(({ op, expectedLiveRev }) => [op, expectedLiveRev]), [['update', 1]]);
  } finally { await close(); }
});

test('unchanged-row skip, idempotent replay and mismatch, asset dedupe across submissions', async () => {
  const { db, close } = await seededDb();
  try {
    const baseline = await baselineFile(db);
    const same = await submit(db, { kind: 'manual', idempotencyKey: 'same', recordFile: tempJson(SEED.businesses[2]), dataset: 'businesses', baseline });
    assert.deepEqual(same.result, { submissionId: null, reason: 'no-changes' });

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-replay-'));
    fs.mkdirSync(path.join(root, 'public/images/businesses'), { recursive: true });
    const bytes = JPEG('replay-image');
    fs.writeFileSync(path.join(root, 'public/images/businesses/replay.jpg'), bytes);
    const record = { ...SEED.businesses[2], slug: 'replay-biz', image: '/images/businesses/replay.jpg' };
    const opts = { kind: 'manual', idempotencyKey: 'replay', recordFile: tempJson(record), dataset: 'businesses', baseline, root };
    const first = await submit(db, opts);
    const replay = await submit(db, opts);
    assert.equal(replay.result.submissionId, first.result.submissionId);
    assert.equal(replay.result.existing, true);
    assert.deepEqual(replay.result.items, first.result.items);
    assert.deepEqual(replay.result.assets.map((asset) => asset.deduped), [true], 'the replay finds the stored asset');
    await assert.rejects(submit(db, { ...opts, recordFile: tempJson({ ...record, proTip: 'Different.' }) }), (error) => error.code === 'StateError' && error.message === 'idempotency-mismatch');
    // Same bytes under another name in a new submission reuse the stored path.
    fs.writeFileSync(path.join(root, 'public/images/businesses/Other Name.jpg'), bytes);
    const second = await submit(db, { ...opts, idempotencyKey: 'dedupe', recordFile: tempJson({ ...record, slug: 'dedupe-biz', image: '/images/businesses/Other Name.jpg' }) });
    assert.deepEqual(second.result.assets, [{ sha256: sha256(bytes), path: first.result.assets[0].path, deduped: true }]);
    assert.equal((await db.query('select count(*)::int as n from content.assets')).rows[0].n, 1);
  } finally { await close(); }
});
