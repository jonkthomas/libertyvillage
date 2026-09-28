// docs/specs/neon-gate-candidate-media-inventory.md: g3 reviews (and the fixer)
// see a grounded submission's own verified /media hero first, ahead of live media
// and checkout listings; unverified /media rows never enter the inventory.
import './fixtures/agent-sdk-mock.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { GATE_MODEL } from '../../scripts/automation/constants.mjs';
import { buildRecordRepairPlan } from '../../scripts/automation/record-repair.mjs';
import * as store from '../../scripts/content/store.mjs';
import { submitContent } from '../../scripts/content/submit.mjs';
import { baselineFile, publishDirect, seededDb, seedRecords, tempJson } from './fixtures/content-db.mjs';

const { gateContent } = await import('../../scripts/content/gate.mjs');
const { INVENTORY_IMAGE_LIMIT } = await import('../../scripts/automation/review-agent.mjs');

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const jpeg = (label) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`hero:${label}`)]);
const WALKING = 'The loop from Liberty Village Park to Trinity Bellwoods is a 5-minute walk.';

// A checkout whose listings alone overflow the inventory image bound.
function crowdedCheckout() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-gate-media-checkout-'));
  const dir = path.join(root, 'public/images/blog');
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < INVENTORY_IMAGE_LIMIT + 50; i += 1) fs.writeFileSync(path.join(dir, `listed-${String(i).padStart(3, '0')}.jpg`), '');
  return root;
}

function blogLivePost(slug, generatedAt, image) {
  const day = generatedAt.slice(0, 10);
  return {
    slug, title: `Liberty Village park walks ${slug.slice(-4)}`, description: 'A short guide to walking loops through the neighbourhood parks.',
    content: `## Walking loops\n\n${WALKING}\n`,
    publishedAt: day, updatedAt: day, category: 'lifestyle', tags: ['parks', 'walking', 'liberty village', 'outdoors'],
    answerBlock: 'Liberty Village has several short walking loops that connect its parks.',
    faqs: [1, 2, 3, 4].map((n) => ({ question: `Question ${n}?`, answer: `Answer ${n}.` })),
    image, relatedServices: [], relatedTopics: [], relatedPosts: [], keyTakeaways: ['One', 'Two', 'Three', 'Four'], author: 'LibertyVillage.co',
  };
}

// blog-live submit. `hero` is either a workspace JPG (converted to /media by submit)
// or an existing path written straight into the record.
async function submitPost(db, suffix, { heroBytes, heroPath }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-gate-media-ws-'));
  let image = heroPath;
  if (heroBytes) {
    fs.mkdirSync(path.join(root, 'public/images/blog'), { recursive: true });
    fs.writeFileSync(path.join(root, 'public/images/blog', `new-hero-${suffix}.jpg`), heroBytes);
    image = `/images/blog/new-hero-${suffix}.jpg`;
  }
  const generatedAt = new Date(Date.now() - 3_600_000).toISOString();
  const out = await submitContent(db, {
    kind: 'blog-live', idempotencyKey: `media:${suffix}:${Math.random()}`, actor: 'uat:test', root,
    recordFile: tempJson(blogLivePost(`liberty-village-park-walks-${suffix}`, generatedAt, image)), dataset: 'posts',
    baseline: await baselineFile(db), topicKey: suffix.padEnd(64, 'c').slice(0, 64), generatedAt,
  }, { checkout: root });
  assert.equal(out.exitCode, 0, JSON.stringify(out.result));
  const { items } = await store.getSubmission(db, out.result.submissionId);
  const [row] = (await db.query('select r.payload from content.round_items i join content.revisions r using(dataset,key,rev) where i.submission_id=$1 and i.round=0', [out.result.submissionId])).rows;
  return { id: out.result.submissionId, key: items[0].key, record: row.payload };
}

const verdictFor = (contentSha, overall, findings) => ({ overall, findings, model: GATE_MODEL, commit_sha: contentSha });
const walkingFinding = (key) => ({ severity: 'high', path: `data/posts.json#${key}`, note: 'unsupported walking-route time: Liberty Village Park to Trinity Bellwoods is not a 5-minute walk' });
const imageFinding = (key, image) => ({ severity: 'high', path: `data/posts.json#${key}`, note: `hero image ${image} is not in the verified asset inventory` });

// Run the gate with a review that records its inventory and blocks when the hero is
// absent from it (the grounded reviewer's behaviour) or on the walking-route claim.
async function gateOnce(db, id, checkout, { reviews, fix, onPhase }) {
  const seen = { reviews: [], fixes: [] };
  const out = await gateContent(db, { submission: id, actor: 'uat:test' }, {
    env: { SLACK_WEBHOOK_URL: 'http://127.0.0.1:9/slack' }, checkout,
    deps: {
      onPhase,
      fetchImpl: async () => new Response('ok', { status: 200 }),
      review: async ({ inventory, contentSha }) => {
        seen.reviews.push(inventory);
        return reviews(seen.reviews.length - 1, inventory, contentSha);
      },
      fix: async (args) => {
        seen.fixes.push(args.inventory);
        return { check: args.validate(fix(args)) };
      },
    },
  });
  return { out, seen };
}

const assertHeroFirst = (inventory, image, label) => {
  assert.ok(inventory, `${label}: grounded inventory present`);
  assert.equal(inventory.blogImages[0], image, `${label}: verified current-submission hero listed first`);
  assert.ok(inventory.blogImages.length <= INVENTORY_IMAGE_LIMIT, `${label}: image bound preserved`);
  assert.equal(inventory.blogImages.filter((entry) => entry === image).length, 1, `${label}: listed once`);
};

test('GREEN: a newly submitted blog JPG (/media) is in review + fixer inventory before live media and a full listing', async () => {
  const { db, close } = await seededDb();
  try {
    // Live media (a published business hero) and an unreferenced valid stored asset.
    const liveBytes = jpeg('live');
    const livePath = `/media/${sha256(liveBytes).slice(0, 16)}/live-biz.jpg`;
    const biz = seedRecords().businesses[1];
    await publishDirect(db, { kind: 'manual', idempotencyKey: 'live-media', items: [{ dataset: 'businesses', key: 'live-media-biz', payload: { ...biz, slug: 'live-media-biz', image: livePath }, expectedLiveRev: null }], assets: [{ sha256: sha256(liveBytes), path: livePath, contentType: 'image/jpeg', bytes: liveBytes }] });
    const strayBytes = jpeg('stray');
    const strayPath = `/media/${sha256(strayBytes).slice(0, 16)}/stray.jpg`;
    await db.query("insert into content.assets(sha256,path,content_type,bytes,byte_size) values($1,$2,'image/jpeg',$3,$4)", [sha256(strayBytes), strayPath, strayBytes, strayBytes.length]);

    const heroBytes = jpeg('new-0001');
    const post = await submitPost(db, '0001', { heroBytes });
    const image = post.record.image;
    assert.equal(image, `/media/${sha256(heroBytes).slice(0, 16)}/new-hero-0001.jpg`, 'submit converted the JPG to a stored /media path');
    const checkout = crowdedCheckout();

    // Round 0: image verified, walking-route claim flagged -> repair; crash right after
    // the repair decision persists so the fixer runs on the RESUME path.
    const crash = new Error('crash after recordRound:repair');
    const first = gateOnce(db, post.id, checkout, {
      reviews: (_round, inventory, contentSha) => (inventory.blogImages.includes(image)
        ? verdictFor(contentSha, 6.5, [walkingFinding(post.key)])
        : verdictFor(contentSha, 6.5, [imageFinding(post.key, image), walkingFinding(post.key)])),
      fix: () => { throw new Error('fixer must not run before the crash'); },
      onPhase: (phase) => { if (phase === 'recordRound:repair') throw crash; },
    });
    await assert.rejects(first, (error) => error === crash);
    const { rounds: afterCrash } = await store.getSubmission(db, post.id);
    assert.deepEqual(afterCrash.map((round) => round.decision), ['repair']);
    const round0 = afterCrash[0].verdict.findings.map((finding) => finding.note);
    assert.ok(!round0.some((note) => note.includes(image)), `round 0 review saw the hero: ${round0.join(' | ')}`);

    // Resume: fixer inventory carries the hero; round 1 still blocks on an unsupported
    // walking-route claim even though the image is verified. No publication.
    const resumed = await gateOnce(db, post.id, checkout, {
      reviews: (_round, inventory, contentSha) => verdictFor(contentSha, 7, [
        ...(inventory.blogImages.includes(image) ? [] : [imageFinding(post.key, image)]),
        walkingFinding(post.key),
      ]),
      fix: ({ payload }) => buildRecordRepairPlan({
        files: [{ file: 'data/posts.json', records: [{ key: post.key, record: { ...payload[0].records[0], answerBlock: 'Liberty Village has short walking loops between its parks.' } }] }],
        reason: 'soften walking claim',
      }),
    });
    // The first fixer call is the resumed round-0 repair; the walking-route finding then
    // keeps repairing until the unchanged budget closes the submission.
    assert.ok(resumed.seen.fixes.length >= 1, 'fixer ran on resume');
    assert.equal(resumed.seen.reviews.length, resumed.seen.fixes.length);
    resumed.seen.fixes.forEach((inventory, i) => assertHeroFirst(inventory, image, `fixer call ${i}${i === 0 ? ' (resume)' : ''}`));
    resumed.seen.reviews.forEach((inventory, i) => assertHeroFirst(inventory, image, `review round ${i + 1}`));
    assert.equal(resumed.seen.fixes[0].blogImages[1], livePath, 'live media follows current-submission media');
    assert.equal(resumed.seen.fixes[0].blogImages[2], '/images/blog/listed-000.jpg', 'checkout listings follow live media');
    assert.ok(!resumed.seen.fixes[0].blogImages.includes(strayPath), 'an unreferenced stored asset is not listed');
    const { submission, rounds } = await store.getSubmission(db, post.id);
    assert.equal(submission.state, 'blocked', 'unsupported walking-route claim still blocks');
    assert.equal(submission.published_at ?? null, null);
    const last = rounds.at(-1).verdict.findings.map((finding) => finding.note);
    assert.ok(last.some((note) => /walking-route/.test(note)));
    assert.ok(!last.some((note) => note.includes(image)), 'the verified hero is not flagged');
    assert.equal((await db.query("select count(*)::int as c from content.entries where dataset='posts' and key=$1 and live_rev is not null", [post.key])).rows[0].c, 0, 'nothing published');
  } finally { await close(); }
});

test('GREEN: an asset stored by an earlier (unpublished) submission qualifies when the current vector references it', async () => {
  const { db, close } = await seededDb();
  try {
    const heroBytes = jpeg('shared');
    const earlier = await submitPost(db, '0002', { heroBytes });
    const image = earlier.record.image;
    const current = await submitPost(db, '0003', { heroPath: image });
    const owner = (await db.query('select submission_id from content.assets where path=$1', [image])).rows[0].submission_id;
    assert.equal(Number(owner), earlier.id, 'the row belongs to the earlier submission');
    const { seen } = await gateOnce(db, current.id, crowdedCheckout(), {
      reviews: (_round, inventory, contentSha) => verdictFor(contentSha, 5, [
        { severity: 'critical', path: `data/posts.json#${current.key}`, note: 'slug duplicates an existing post' },
      ]),
      fix: () => { throw new Error('unexpected fixer call'); },
    });
    assertHeroFirst(seen.reviews[0], image, 'review of the referencing submission');
  } finally { await close(); }
});

test('negative: hash-mismatched, size-mismatched or prefix-mismatched /media rows stay out and a high finding still blocks', async () => {
  const { db, close } = await seededDb();
  try {
    const claimed = jpeg('claimed');
    const other = jpeg('tampered-bytes');
    const sizeBytes = jpeg('size');
    const prefixBytes = jpeg('prefix');
    const cases = [
      // stored bytes do not hash to the row's digest
      ['0004', { sha: sha256(claimed), path: `/media/${sha256(claimed).slice(0, 16)}/bad-hash.jpg`, bytes: other, size: other.length }],
      // the path matches the stored bytes but the row's full digest does not
      ['0008', { sha: sha256(jpeg('row-digest')), path: `/media/${sha256(other).slice(0, 16)}/bad-row-digest.jpg`, bytes: other, size: other.length }],
      // byte_size disagrees with the stored bytes
      ['0005', { sha: sha256(sizeBytes), path: `/media/${sha256(sizeBytes).slice(0, 16)}/bad-size.jpg`, bytes: sizeBytes, size: sizeBytes.length + 1 }],
      // the path's <sha16> is not the digest prefix
      ['0006', { sha: sha256(prefixBytes), path: `/media/${'0123456789abcdef'}/bad-prefix.jpg`, bytes: prefixBytes, size: prefixBytes.length }],
    ];
    for (const [suffix, row] of cases) {
      await db.query("insert into content.assets(sha256,path,content_type,bytes,byte_size) values($1,$2,'image/jpeg',$3,$4)", [row.sha, row.path, row.bytes, row.size]);
      const post = await submitPost(db, suffix, { heroPath: row.path });
      const { out, seen } = await gateOnce(db, post.id, crowdedCheckout(), {
        reviews: (_round, inventory, contentSha) => verdictFor(contentSha, 8.6, inventory.blogImages.includes(row.path) ? [] : [imageFinding(post.key, row.path)]),
        fix: () => { throw new Error('fixer refused'); },
      });
      assert.equal(seen.reviews.length >= 1, true, `${suffix}: g1 passed and g3 ran`);
      assert.ok(!seen.reviews[0].blogImages.includes(row.path), `${suffix}: unverified row not listed`);
      assert.notEqual(out.result.state, 'published', `${suffix}: ${JSON.stringify(out.result)}`);
      const { rounds } = await store.getSubmission(db, post.id);
      assert.ok(rounds[0].verdict.findings.some((finding) => finding.note.includes(row.path)), `${suffix}: image flagged high`);
      assert.equal(rounds[0].passed, false);
    }
  } finally { await close(); }
});

test('negative: a referenced asset that is also live but fails verification stays out of review and fixer inventory', async () => {
  const { db, close } = await seededDb();
  try {
    const good = jpeg('live-then-corrupted');
    const livePath = `/media/${sha256(good).slice(0, 16)}/live-corrupted.jpg`;
    const biz = seedRecords().businesses[1];
    await publishDirect(db, { kind: 'manual', idempotencyKey: 'live-corrupt', items: [{ dataset: 'businesses', key: 'live-corrupt-biz', payload: { ...biz, slug: 'live-corrupt-biz', image: livePath }, expectedLiveRev: null }], assets: [{ sha256: sha256(good), path: livePath, contentType: 'image/jpeg', bytes: good }] });
    const post = await submitPost(db, '0009', { heroPath: livePath });
    // Same length, different bytes: only a byte hash can tell.
    const corrupted = Buffer.from(good); corrupted[corrupted.length - 1] ^= 0xff;
    await db.query('update content.assets set bytes=$2 where path=$1', [livePath, corrupted]);
    const { out, seen } = await gateOnce(db, post.id, crowdedCheckout(), {
      reviews: (_round, inventory, contentSha) => verdictFor(contentSha, 6.5, inventory.blogImages.includes(livePath) ? [] : [imageFinding(post.key, livePath)]),
      fix: ({ payload }) => buildRecordRepairPlan({ files: [{ file: 'data/posts.json', records: [{ key: post.key, record: payload[0].records[0] }] }], reason: 'no-op' }),
    });
    assert.ok(seen.reviews.length >= 1 && seen.fixes.length >= 1, 'review and fixer both ran');
    for (const inventory of [...seen.reviews, ...seen.fixes]) assert.ok(!inventory.blogImages.includes(livePath), 'corrupted live+referenced path not listed');
    assert.notEqual(out.result.state, 'published', JSON.stringify(out.result));
    const { rounds } = await store.getSubmission(db, post.id);
    assert.ok(rounds.every((round) => round.passed === false));
    assert.ok(rounds[0].verdict.findings.some((finding) => finding.note.includes(livePath)), 'image flagged high');
  } finally { await close(); }
});

test('negative: a /media path with no stored asset is rejected by g1 before any review', async () => {
  const { db, close } = await seededDb();
  try {
    // submit refuses unknown /media, so create the submission through the store directly.
    const generatedAt = new Date(Date.now() - 3_600_000).toISOString();
    const missing = `/media/${'f'.repeat(16)}/absent.jpg`;
    const post = blogLivePost('liberty-village-park-walks-0007', generatedAt, missing);
    const created = await store.createSubmission(db, {
      kind: 'blog-live', target: db.target, actor: 'uat:test', idempotencyKey: 'missing-media',
      context: { now: generatedAt, topicKey: 'd'.repeat(64) }, items: [{ dataset: 'posts', key: post.slug, payload: post, expectedLiveRev: null }],
    });
    const { out, seen } = await gateOnce(db, created.submissionId, crowdedCheckout(), {
      reviews: () => { throw new Error('review must not run'); },
      fix: () => { throw new Error('fixer must not run'); },
    });
    assert.equal(seen.reviews.length, 0);
    assert.deepEqual([out.result.state, out.result.decision], ['rejected', 'validation'], JSON.stringify(out.result));
    const { rounds } = await store.getSubmission(db, created.submissionId);
    assert.ok(rounds[0].lint.errors.some((error) => /^image-missing: .*absent\.jpg/.test(error)), JSON.stringify(rounds[0].lint));
  } finally { await close(); }
});
