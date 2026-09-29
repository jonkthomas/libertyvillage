// Trusted blog `submit --source-pack`: bounded read, re-verification against the
// live DB export, cadence-attempt digest binding, immutable context on replay; the
// gate hands the stored (never scratch) facts to the reviewer and the fixer.
import './fixtures/agent-sdk-mock.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { GATE_MODEL } from '../../scripts/automation/constants.mjs';
import { buildRecordRepairPlan } from '../../scripts/automation/record-repair.mjs';
import { buildSourcePack, canonicalJson } from '../../scripts/automation/blog-source-pack.mjs';
import * as cadence from '../../scripts/content/cadence.mjs';
import * as store from '../../scripts/content/store.mjs';
import { BLOG_SOURCE_PACK_MAX_BYTES, submitContent } from '../../scripts/content/submit.mjs';
import { baselineFile, hasTestDb, seededDb } from './fixtures/content-db.mjs';

const { gateContent, blogPackEvidence } = await import('../../scripts/content/gate.mjs');
const skip = !hasTestDb && 'CONTENT_TEST_DATABASE_URL not set';
const jpeg = (label) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`hero:${label}`)]);

function blogPost(slug) {
  const day = new Date().toISOString().slice(0, 10);
  return {
    slug, title: `Liberty Village brunch notes ${slug.slice(-4)}`, description: 'A short guide to weekend brunch in the neighbourhood.',
    content: '## Weekend brunch\n\nLiberty Village has several places that serve brunch on weekends.\n',
    publishedAt: day, updatedAt: day, category: 'lifestyle', tags: ['brunch', 'food', 'liberty village', 'weekend'],
    answerBlock: 'Several Liberty Village spots serve weekend brunch.',
    faqs: [1, 2, 3, 4].map((n) => ({ question: `Question ${n}?`, answer: `Answer ${n}.` })),
    image: `/images/blog/${slug}.jpg`, relatedServices: [], relatedTopics: [], relatedPosts: [], keyTakeaways: ['One', 'Two', 'Three', 'Four'], author: 'LibertyVillage.co',
  };
}

async function livePack(db, topic, now = new Date()) {
  const snapshot = await store.readLive(db);
  const records = (name) => snapshot.datasets[name].records;
  const built = buildSourcePack({ topic, businesses: records('businesses'), posts: records('posts'), services: records('services'), topics: records('topics'), now });
  assert.ok(built.ok, `pack for ${topic}: ${built.reason}`);
  return built.pack;
}

function packFile(pack) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-pack-'));
  const file = path.join(dir, 'pack.json');
  fs.writeFileSync(file, typeof pack === 'string' ? pack : `${canonicalJson(pack)}\n`);
  return file;
}

async function submitBlog(db, { key, suffix, sourcePack, kind = 'blog' }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-pack-ws-'));
  const post = blogPost(`liberty-village-brunch-notes-${suffix}`);
  fs.mkdirSync(path.join(root, 'public/images/blog'), { recursive: true });
  fs.writeFileSync(path.join(root, 'public', post.image.slice(1)), jpeg(suffix));
  const recordFile = path.join(root, 'post.json');
  fs.writeFileSync(recordFile, JSON.stringify(post));
  return submitContent(db, { kind, idempotencyKey: key, actor: 'uat:pack', root, recordFile, dataset: 'posts', baseline: await baselineFile(db), sourcePack }, { checkout: root });
}

const storedContext = async (db, id) => (await db.query('select context from content.submissions where id=$1', [id])).rows[0].context;

test('blog --source-pack: verified facts stored in context; replay keeps the ORIGINAL context', { skip }, async () => {
  const { db, close } = await seededDb();
  try {
    const pack = await livePack(db, 'Brunch Spots');
    const first = await submitBlog(db, { key: 'pack-replay', suffix: 'aaaa', sourcePack: packFile(pack) });
    assert.equal(first.exitCode, 0);
    const context = await storedContext(db, first.result.submissionId);
    assert.equal(context.sourcePack.fingerprint, pack.fingerprint);
    assert.equal(context.sourcePack.sha256, createHash('sha256').update(canonicalJson(pack)).digest('hex'));
    assert.deepEqual(context.sourcePack.sources.map((source) => source.id), pack.sources.map((source) => source.id));
    assert.ok(context.sourcePack.sources.every((source) => source.claims.every((claim) => claim.verbatim.length <= 600)), 'facts are bounded');
    assert.ok(JSON.stringify(context.sourcePack).length <= 48000);
    const other = await livePack(db, 'Food and Drink');
    assert.notEqual(other.fingerprint, pack.fingerprint);
    const replay = await submitBlog(db, { key: 'pack-replay', suffix: 'aaaa', sourcePack: packFile(other) });
    assert.equal(replay.result.submissionId, first.result.submissionId);
    assert.equal(replay.result.existing, true);
    assert.deepEqual(await storedContext(db, first.result.submissionId), context, 'context is immutable on idempotent replay');
    const plain = await submitBlog(db, { key: 'no-pack', suffix: 'bbbb' });
    assert.equal((await storedContext(db, plain.result.submissionId)).sourcePack, undefined, 'blog without a pack keeps the legacy context');
  } finally { await close(); }
});

test('blog --source-pack refusals: tampered, stale, oversized, symlinked, wrong kind, cadence digest mismatch', { skip }, async () => {
  const { db, close } = await seededDb();
  try {
    const pack = await livePack(db, 'Brunch Spots');
    const tampered = { ...pack, sources: pack.sources.map((source, index) => index ? source : { ...source, claims: [{ claim: 'hours', field: 'hours', verbatim: 'Open 24 hours' }] }) };
    await assert.rejects(submitBlog(db, { key: 'tampered', suffix: 'cccc', sourcePack: packFile(tampered) }), /blog source pack failed verification: .*invalid-(?:fingerprint|claims)/);
    const stale = await livePack(db, 'Brunch Spots', new Date(Date.now() - 7 * 3600_000));
    await assert.rejects(submitBlog(db, { key: 'stale', suffix: 'dddd', sourcePack: packFile(stale) }), /stale-generated-at/);
    await assert.rejects(submitBlog(db, { key: 'huge', suffix: 'eeee', sourcePack: packFile(' '.repeat(BLOG_SOURCE_PACK_MAX_BYTES + 1)) }), /bounded regular file/);
    const link = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lv-pack-link-')), 'pack.json');
    fs.symlinkSync(packFile(pack), link);
    await assert.rejects(submitBlog(db, { key: 'link', suffix: 'ffff', sourcePack: link }), /blog source pack unreadable/);
    await assert.rejects(submitBlog(db, { key: 'manual-pack', suffix: 'gggg', kind: 'manual', sourcePack: packFile(pack) }), /only for blog/);
    await assert.rejects(submitBlog(db, { key: 'cadence:orphan', suffix: 'hhhh', sourcePack: packFile(pack) }), /does not match its cadence attempt/);
    const weekStart = cadence.weekStartUtc(new Date());
    const slotRef = { target: 'test', weekStart, lane: 'content', slotNumber: 1 };
    const { token } = await cadence.reserveSlot(db, { ...slotRef, owner: 'uat' });
    const wrong = await cadence.recordAttempt(db, { slotRef, token, intentFingerprint: 'brunch spot', topicKey: 't', sourcePackDigest: 'f'.repeat(64) });
    await assert.rejects(submitBlog(db, { key: wrong.idempotencyKey, suffix: 'iiii', sourcePack: packFile(pack) }), /does not match its cadence attempt/);
    await cadence.recordAttemptOutcome(db, { idempotencyKey: wrong.idempotencyKey, token, outcome: 'failed-before-submit' });
    const right = await cadence.recordAttempt(db, { slotRef, token, intentFingerprint: 'brunch spot 2', topicKey: 't2', sourcePackDigest: pack.fingerprint });
    const ok = await submitBlog(db, { key: right.idempotencyKey, suffix: 'jjjj', sourcePack: packFile(pack) });
    assert.ok(ok.result.submissionId, 'cadence attempt with the matching digest is accepted');
    assert.equal((await db.query("select count(*)::int as n from content.submissions where kind='blog'")).rows[0].n, 1, 'no refused submit wrote a row');
  } finally { await close(); }
});

test('gate: reviewer AND fixer receive the bounded stored pack facts; fixer references include the cited records', { skip }, async () => {
  const { db, close } = await seededDb();
  try {
    const pack = await livePack(db, 'Brunch Spots');
    const submitted = await submitBlog(db, { key: 'pack-gate', suffix: 'kkkk', sourcePack: packFile(pack) });
    const id = submitted.result.submissionId;
    const { items } = await store.getSubmission(db, id);
    const key = items[0].key;
    const seen = { reviews: [], fixes: [] };
    const finding = { severity: 'high', path: `data/posts.json#${key}`, note: 'answer block overstates coverage' };
    await gateContent(db, { submission: id, actor: 'uat:pack' }, {
      env: { SLACK_WEBHOOK_URL: 'http://127.0.0.1:9/slack' }, checkout: fs.mkdtempSync(path.join(os.tmpdir(), 'lv-pack-checkout-')),
      deps: {
        fetchImpl: async () => new Response('ok', { status: 200 }),
        review: async ({ evidence, contentSha }) => {
          seen.reviews.push(evidence);
          return seen.reviews.length === 1
            ? { overall: 7, findings: [finding], model: GATE_MODEL, commit_sha: contentSha }
            : { overall: 5, findings: [{ ...finding, severity: 'critical', note: 'still unsupported' }], model: GATE_MODEL, commit_sha: contentSha };
        },
        fix: async (args) => {
          seen.fixes.push({ evidence: args.evidence, references: args.references.map((record) => record.slug) });
          const record = args.payload[0].records[0];
          return { check: args.validate(buildRecordRepairPlan({ files: [{ file: 'data/posts.json', records: [{ key, record: { ...record, answerBlock: 'Some Liberty Village spots serve weekend brunch.' } }] }], reason: 'soften' })) };
        },
      },
    });
    assert.ok(seen.reviews.length >= 1 && seen.fixes.length >= 1, 'review and fixer both ran');
    const expected = blogPackEvidence(await storedContext(db, id));
    assert.equal(expected.sourcePack.fingerprint, pack.fingerprint);
    for (const evidence of seen.reviews) assert.deepEqual(evidence, expected, 'review evidence = stored facts');
    for (const fix of seen.fixes) {
      assert.deepEqual(fix.evidence, expected, 'fixer evidence = stored facts');
      for (const source of pack.sources) assert.ok(fix.references.includes(source.id), `fixer references include ${source.id}`);
    }
    assert.ok(JSON.stringify(expected).length <= 48000);
    const { submission } = await store.getSubmission(db, id);
    assert.equal(submission.state, 'blocked', 'thresholds unchanged: no publication below 8');
  } finally { await close(); }
});

test('blogPackEvidence re-bounds stored facts and ignores contexts without a pack', () => {
  assert.equal(blogPackEvidence({ now: 'x' }), null);
  const long = 'x'.repeat(5000);
  const evidence = blogPackEvidence({ sourcePack: { fingerprint: 'a'.repeat(64), topic: long, sources: Array.from({ length: 20 }, (_, i) => ({ id: `b${i}`, name: long, claims: Array.from({ length: 20 }, () => ({ field: 'description', verbatim: long })) })) } });
  assert.equal(evidence.sourcePack.sources.length, 12);
  assert.equal(evidence.sourcePack.topic.length, 300);
  assert.ok(evidence.sourcePack.sources.every((source) => source.claims.length === 12 && source.claims.every((claim) => claim.verbatim.length === 600)));
});
