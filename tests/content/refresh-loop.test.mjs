// Refresh loop (scripts/content/refresh.mjs): weakest-post selection from GSC
// rows, snapshot-before-change, same slug/URL, the full refresh gate on a real
// local store, the durable weekly cap of 2, gate-fail publishes nothing, the
// ledger call carries before/after, and rollback restores the exact row.
import './fixtures/agent-sdk-mock.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { refreshDeps, acceptGeneratedOutput } from '../../ops/exedev-runner/runner.mjs';

import { GATE_MODEL } from '../../scripts/automation/constants.mjs';
import { canonicalJson } from '../../scripts/automation/blog-source-pack.mjs';
import { checkKindPolicy } from '../../scripts/content/submit.mjs';
import { validateRecord } from '../../scripts/content/validate.mjs';
import { lintPost } from '../../scripts/blog-lint.mjs';
import * as store from '../../scripts/content/store.mjs';
import { keyOf, recordSha } from '../../scripts/content/canonical.mjs';
import { explain } from '../../ops/weekly-digest/lib/plain-english.mjs';
import {
  REFRESH, closeRefresh, expectedCtr, extractRefreshedPost, isLeakQuery, listRefreshes, planRefresh, rankRefreshCandidates, refreshScore,
  refreshLogLine, refreshIdempotencyKey, reserveRefresh, rollbackRefresh, runRefreshLoop, splitIntro, submitRefresh,
} from '../../scripts/content/refresh.mjs';
import { refreshRow, renderRefreshed } from '../../ops/weekly-digest/lib/refreshed.mjs';
import { baselineFile, FAST_SMOKE, hasTestDb, liveRecord, localSite, publishDirect, seededDb, tempJson } from './fixtures/content-db.mjs';
import { invoke as invokeRefreshWriter } from '../runner/fixtures/refresh-writer.mjs';

const skip = !hasTestDb && 'CONTENT_TEST_DATABASE_URL not set';
const REPO = fileURLToPath(new URL('../../', import.meta.url));
const IMAGE = JSON.parse(fs.readFileSync(new URL('../../data/posts.json', import.meta.url), 'utf8'))[0].image;

test('GoodLife starts with a heading: the intro is empty and a snippet may prepend one without changing its body', () => {
  const original = JSON.parse(fs.readFileSync(new URL('../../data/posts.json', import.meta.url), 'utf8'))
    .find((post) => post.slug === 'goodlife-fitness-liberty-village-review-guide');
  assert.match(original.content, /^## /);
  assert.deepEqual(splitIntro(original.content), { intro: '', rest: original.content });
  const updated = { ...original, content: `Compare the gym using this local guide.\n\n${original.content}` };
  assert.equal(extractRefreshedPost({ before: [original], after: [updated], slug: original.slug, mode: 'snippet' }), updated);
  assert.equal(splitIntro(updated.content).rest, original.content);
  assert.throws(() => extractRefreshedPost({ before: [original], after: [{ ...updated, content: updated.content + '\nBody edit' }],
    slug: original.slug, mode: 'snippet' }), (error) => error.reason === 'refresh-snippet-overreach');
});

test('round3: realistic GoodLife snippet passes despite immutable legacy findings, but new unsupported facts and edits remain refused', () => {
  const read = (name) => JSON.parse(fs.readFileSync(new URL(`../../data/${name}.json`, import.meta.url)));
  const live = Object.fromEntries(['posts', 'businesses', 'services', 'topics'].map((name) => [name, read(name)]));
  const original = { ...live.posts.find((p) => p.slug === 'goodlife-fitness-liberty-village-review-guide'),
    answerBlock: 'GoodLife Fitness Liberty Village is at 47 Jefferson Ave.' };
  assert.ok(lintPost(original, { businesses: live.businesses }).findings.some((f) => f.detail.startsWith('answerBlock:')));
  const record = { ...original, title: 'GoodLife Fitness Liberty Village: Prices & Hours',
    description: 'Compare GoodLife Fitness Liberty Village membership, equipment and classes before choosing your gym.',
    content: `Compare GoodLife Fitness Liberty Village membership, equipment and classes.\n\n${splitIntro(original.content).rest}` };
  const policy = (payload, mode = 'snippet') => checkKindPolicy({ kind: 'refresh', items: [{ dataset: 'posts', key: original.slug, op: 'update', payload }],
    ctx: { refresh: { mode, original } }, live, deps: { validateRecord, lintMode: 'fail' } });
  assert.deepEqual(policy(record).errors, [], 'a realistic rewrite is not blocked by immutable legacy text');
  assert.equal(policy(record, 'full').ok, false, 'full refresh retains whole-post lint');
  const invented = policy({ ...record, content: `GoodLife Fitness Liberty Village charges $99999.\n\n${splitIntro(original.content).rest}` });
  assert.equal(invented.ok, false);
  assert.ok(invented.lint.some((e) => e.includes('[unsupported-price]')));
  assert.deepEqual(invented.refusalDetail, { kind: 'fact-check', failures: [{ code: 'unsupported-price', field: 'content', businessSlug: 'goodlife-fitness-liberty-village' }] });
  assert.equal(policy({ ...record, faqs: [] }).ok, false, 'excluded fields cannot be modified');
  assert.equal(policy({ ...record, content: record.content + '\nChanged body.' }).ok, false);
  assert.equal(policy({ ...record, content: `[Guide](/blog/invented-guide)\n\n${splitIntro(original.content).rest}` }).ok, false);
});

test('round3: fact-check rule/field/business identifiers survive submit, close, replay and the runner log without bodies', { skip }, async (t) => {
  const handle = await refreshDb();
  t.after(() => handle.close());
  const { db } = handle;
  const before = await livePosts(db);
  const business = (await store.readLive(db, { datasets: ['businesses'] })).datasets.businesses.records[0];
  const original = { ...before.find((p) => p.slug === SLUGS[0]), content: `Local guide.\n\n## Details\n\n[${business.name}](/directory/${business.slug}) charges $98765.\n` };
  const rev = (await db.query("select live_rev from content.entries where dataset='posts' and key=$1", [original.slug])).rows[0].live_rev;
  await publishDirect(db, { kind: 'manual', items: [{ dataset: 'posts', key: original.slug, payload: original, expectedLiveRev: Number(rev) }], idempotencyKey: 'round3:legacy' });
  const posts = await livePosts(db);
  const snapshot = await reserveRefresh(db, { candidate: { slug: original.slug, mode: 'snippet' }, now: MON });
  const record = { ...original, title: `${original.title}: local tips`, content: `[${business.name}](/directory/${business.slug}) charges $99999.\n\n${splitIntro(original.content).rest}` };
  const out = await submitRefresh(db, { snapshotId: snapshot.snapshotId, before: posts, after: posts.map((p) => p.slug === original.slug ? record : p),
    actor: 'uat:round3', checkout: REPO, now: MON });
  assert.equal(out.exitCode, 2);
  assert.equal(out.result.reasonCode, 'refresh-fact-check');
  const expected = { kind: 'fact-check', failures: [{ code: 'unsupported-price', field: 'content', businessSlug: business.slug }] };
  assert.deepEqual(refreshLogLine(out.result).refusalDetail, expected);
  assert.deepEqual(refreshLogLine(await closeRefresh(db, { snapshotId: snapshot.snapshotId })).refusalDetail, expected, 'durable on replay');
  assert.equal((await liveRecord(db, 'posts', original.slug)).content, original.content, 'refused draft never published');
  const hostile = refreshLogLine({ refusalDetail: { kind: 'fact-check', failures: [
    { code: 'PRIVATE BODY', field: 'content', businessSlug: business.slug },
    ...Array.from({ length: 30 }, () => ({ code: 'unsupported-price', field: 'PRIVATE BODY', businessSlug: 'PRIVATE BODY', claim: 'PRIVATE BODY' })),
  ] } });
  assert.equal(hostile.refusalDetail.failures.length, 20);
  assert.ok(!JSON.stringify(hostile).includes('PRIVATE BODY'));
  const site = await localSite(db);
  t.after(() => site.close());
  // A resumed submission hits g1, rather than the initial submit policy. Its
  // terminal gate round must preserve the same identifiers through close.
  const gated = await reserveRefresh(db, { candidate: { slug: original.slug, mode: 'snippet' }, now: MON });
  await store.createSubmission(db, { kind: 'refresh', target: db.target, actor: 'uat:round3',
    idempotencyKey: refreshIdempotencyKey(db.target, gated.snapshotId),
    context: { now: MON.toISOString(), refresh: { snapshotId: gated.snapshotId, mode: 'snippet', original } },
    items: [{ dataset: 'posts', key: original.slug, op: 'update', payload: record, expectedLiveRev: gated.liveRev }] });
  const gateRefused = await submitRefresh(db, { snapshotId: gated.snapshotId, actor: 'uat:round3', checkout: REPO, now: MON,
    env: site.env, deps: { gate: { review: pass, smoke: FAST_SMOKE } } });
  assert.equal(gateRefused.exitCode, 2);
  assert.deepEqual(refreshLogLine(gateRefused.result).refusalDetail, expected, 'gate g1 preserves detail');
  const retry = await reserveRefresh(db, { candidate: { slug: original.slug, mode: 'snippet' }, now: MON });
  const valid = { ...original, title: `${original.title}: local tips`, content: `Plan your local walk.\n\n${splitIntro(original.content).rest}` };
  const published = await submitRefresh(db, { snapshotId: retry.snapshotId, before: posts, after: posts.map((p) => p.slug === original.slug ? valid : p),
    actor: 'uat:round3', checkout: REPO, now: MON, env: site.env, deps: { gate: { review: pass, smoke: FAST_SMOKE } } });
  assert.equal(published.exitCode, 0);
  const url = `${site.origin}/blog/${original.slug}`;
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.ok((await response.text()).includes(valid.title));
  assert.equal((await liveRecord(db, 'posts', original.slug)).content, valid.content);
  t.diagnostic(`GET ${url} -> 200; snippet with immutable legacy claim published; unsupported-price refused with field=content businessSlug=${business.slug}; replay retains detail`);
});
const MON = new Date('2026-11-02T05:00:00Z');   // ISO week 2026-W45
const NEXT_MON = new Date('2026-11-09T05:00:00Z');

// Plain posts with no business names, so the claim linter has nothing to flag.
function post(slug, title) {
  return {
    slug, title, description: `A short local guide: ${title.toLowerCase()}.`,
    content: `## Getting started\n\nLiberty Village is a neighbourhood in west-central Toronto.\n\n## Planning ahead\n\nCheck the city website before you go.\n`,
    publishedAt: '2026-05-01', updatedAt: '2026-05-01', category: 'lifestyle', tags: ['liberty village', 'guide', 'toronto', 'local'],
    answerBlock: 'Liberty Village is a neighbourhood in west-central Toronto.',
    faqs: [1, 2, 3, 4].map((n) => ({ question: `Question ${n}?`, answer: `Answer ${n}.` })),
    image: IMAGE, relatedServices: [], relatedTopics: [], relatedPosts: [], keyTakeaways: ['One', 'Two', 'Three', 'Four'], author: 'LibertyVillage.co',
  };
}
const SLUGS = ['refresh-walks-guide', 'refresh-parking-guide', 'refresh-winter-guide', 'refresh-dogs-guide'];
const page = (slug, extra = '') => `https://libertyvillage.co/blog/${slug}${extra}`;

// Fixture GSC rows (28 days). Expected missed-click scores:
//   walks:   pos 3.0, 1000 impr, 10 clicks -> 1000 × (0.10 − 0.01)  = 90
//   parking: pos 14 (scored at 8), 2000 impr, 4 clicks -> 2000 × (0.025 − 0.002) = 46
//   winter:  pos 6, 300 impr, 6 clicks -> 300 × (0.04 − 0.02) = 6
//   dogs:    40 impressions, below the 50 floor -> not a candidate
const GSC = {
  pages: [
    { page: page(SLUGS[0]), clicks: 6, impressions: 600, ctr: 0.01, position: 3 },
    { page: `https://www.libertyvillage.co/blog/${SLUGS[0]}/`, clicks: 4, impressions: 400, ctr: 0.01, position: 3 },
    { page: page(SLUGS[1]), clicks: 4, impressions: 2000, ctr: 0.002, position: 14 },
    { page: page(SLUGS[2]), clicks: 6, impressions: 300, ctr: 0.02, position: 6 },
    { page: page('refresh-top-guide'), clicks: 900, impressions: 3000, ctr: 0.3, position: 1.2 },
    { page: page(SLUGS[3]), clicks: 0, impressions: 40, ctr: 0, position: 30 },
    { page: page('not-a-live-post'), clicks: 0, impressions: 9000, ctr: 0, position: 9 },
    { page: 'https://libertyvillage.co/guide/transit-guide', clicks: 0, impressions: 9000, ctr: 0, position: 9 },
  ],
  queries: [
    { page: page(SLUGS[0]), query: 'liberty village walks', clicks: 5, impressions: 700, ctr: 0.007, position: 3 },
    { page: page(SLUGS[0]), query: 'walking liberty village', clicks: 1, impressions: 90, ctr: 0.01, position: 3.5 },
    // Leak queries (position 4-20, >50 impressions, CTR <5%) put parking in the snippet lane;
    // the larger non-leak query is not the snippet's target.
    { page: page(SLUGS[1]), query: 'parking near me', clicks: 40, impressions: 1600, ctr: 0.025, position: 2 },
    { page: page(SLUGS[1]), query: 'liberty village parking', clicks: 4, impressions: 1500, ctr: 0.003, position: 14 },
  ],
};

test('weakest-post selection: missed-click score, merged rows, floors and exclusions', () => {
  assert.equal(expectedCtr(1), 0.28);
  assert.equal(expectedCtr(14), 0.01);
  assert.equal(refreshScore({ impressions: 1000, ctr: 0.3, position: 1 }), 0, 'a page beating its expected CTR scores 0');
  const posts = [...SLUGS.map((slug) => post(slug, slug)), post('refresh-top-guide', 'Top'), { ...post('refresh-news-item', 'News'), category: 'news' }];
  const ranked = rankRefreshCandidates({ gsc: { ...GSC, pages: [...GSC.pages, { page: page('refresh-news-item'), clicks: 0, impressions: 5000, ctr: 0, position: 5 }] }, posts });
  assert.deepEqual(ranked.map((c) => c.slug), [SLUGS[0], SLUGS[1], SLUGS[2]], 'news, non-blog, unknown, sub-floor and already-strong pages are never candidates');
  assert.deepEqual(ranked.map((c) => c.score), [90, 46, 6]);
  assert.deepEqual(ranked[0].baseline, { clicks: 10, impressions: 1000, ctr: 0.01, position: 3 }, 'www and trailing-slash rows merge');
  assert.equal(ranked[0].targetQuery, 'liberty village walks', 'top query by impressions');
  assert.deepEqual(ranked.map((c) => c.mode), ['full', 'snippet', 'full'], 'only the page with a leak query starts in the snippet lane');
  assert.equal(ranked[1].targetQuery, 'liberty village parking', 'a snippet refresh targets the top leak query');
  const after = rankRefreshCandidates({ gsc: GSC, posts, snippetDone: new Set([SLUGS[1]]) });
  assert.equal(after.find((c) => c.slug === SLUGS[1]).mode, 'full', 'a full rewrite is considered only after the snippet refresh');
  assert.equal(ranked[0].url, page(SLUGS[0]));
  assert.deepEqual(rankRefreshCandidates({ gsc: GSC, posts, exclude: new Set([SLUGS[0]]) }).map((c) => c.slug)[0], SLUGS[1], 'cooldown exclusions skip a post');
});

test('leak-query thresholds: position 4-20, more than 50 impressions, CTR under 5%', () => {
  const q = (position, impressions, ctr) => isLeakQuery({ position, impressions, ctr });
  assert.equal(q(4, 51, 0.049), true);
  assert.equal(q(20, 51, 0.049), true);
  assert.equal(q(3.9, 500, 0.01), false, 'top-3 is not a leak');
  assert.equal(q(20.1, 500, 0.01), false, 'beyond position 20 is a ranking problem, not a snippet one');
  assert.equal(q(10, 50, 0.01), false, 'needs more than 50 impressions');
  assert.equal(q(10, 500, 0.05), false, 'CTR must be under 5%');
});

test('snippet-only rewrite: title, description and intro may change; the body beyond the intro may not', () => {
  const base = post(SLUGS[1], 'Parking');
  assert.deepEqual(splitIntro(base.content), { intro: '', rest: base.content }, 'a body that opens with a section has an empty intro');
  const withIntro = { ...base, content: `Parking is tight on weekends.\n\n${base.content}` };
  assert.equal(splitIntro(withIntro.content).intro, 'Parking is tight on weekends.\n\n');
  const before = [withIntro, post(SLUGS[0], 'Walks')];
  const snippet = (fn) => { try { return extractRefreshedPost({ before, after: [fn({ ...withIntro }), before[1]], slug: SLUGS[1], mode: 'snippet' }); } catch (error) { return error.reason; } };
  const ok = snippet((p) => ({ ...p, title: 'Liberty Village Parking: Lots and Street Rules', description: 'Where to park.', content: `Short answer: use the Green P lots.\n\n${base.content}`, updatedAt: '2026-11-02' }));
  assert.equal(ok.title, 'Liberty Village Parking: Lots and Street Rules');
  assert.equal(splitIntro(ok.content).rest, splitIntro(withIntro.content).rest, 'body beyond the intro byte-identical');
  assert.equal(snippet((p) => ({ ...p, title: 'New', content: `${p.content}\n## Extra\n\nMore.\n` })), 'refresh-snippet-overreach');
  assert.equal(snippet((p) => ({ ...p, title: 'New', content: p.content.replace('Planning ahead', 'Plan ahead') })), 'refresh-snippet-overreach');
  assert.equal(snippet((p) => ({ ...p, title: 'New', faqs: [] })), 'refresh-snippet-overreach');
  assert.equal(snippet((p) => ({ ...p, title: 'New', answerBlock: 'Different.' })), 'refresh-snippet-overreach');
  // The same edit is fine as a full rewrite.
  assert.equal(extractRefreshedPost({ before, after: [{ ...withIntro, title: 'New', faqs: [] }, before[1]], slug: SLUGS[1] }).title, 'New');
});

test('generator output: exactly the snapshot post may change, same slug and publish date', () => {
  const before = SLUGS.map((slug) => post(slug, slug));
  const edit = (fn) => before.map((p) => (p.slug === SLUGS[0] ? fn({ ...p }) : p));
  const ok = extractRefreshedPost({ before, after: edit((p) => ({ ...p, title: 'Better title' })), slug: SLUGS[0] });
  assert.equal(ok.title, 'Better title');
  const reason = (after) => { try { extractRefreshedPost({ before, after, slug: SLUGS[0] }); return 'accepted'; } catch (error) { return error.reason; } };
  assert.equal(reason(edit((p) => ({ ...p, slug: 'refresh-walks-guide-2026' }))), 'refresh-slug-changed');
  assert.equal(reason(edit((p) => ({ ...p, publishedAt: '2026-10-01' }))), 'refresh-date-changed');
  assert.equal(reason(before.map((p) => (p.slug === SLUGS[1] ? { ...p, title: 'x' } : p.slug === SLUGS[0] ? { ...p, title: 'y' } : p))), 'refresh-off-target');
  assert.equal(reason([...before, post('refresh-extra', 'extra')]), 'refresh-slug-changed');
  assert.equal(reason(before), 'refresh-no-change');
});

async function refreshDb() {
  const handle = await seededDb();
  const seeded = await publishDirect(handle.db, { items: SLUGS.map((slug) => ({ dataset: 'posts', key: slug, payload: post(slug, `Guide ${slug.split('-')[1]}`) })), idempotencyKey: 'seed:refresh' });
  await handle.db.query('update content.submissions set deploy_requested_at=now(),smoke_passed_at=now(),notified_at=now() where id=$1', [seeded.submissionId]);
  return handle;
}

const pass = async ({ contentSha }) => ({ overall: 9, findings: [], model: GATE_MODEL, commit_sha: contentSha });
const livePosts = async (db) => (await store.readLive(db, { datasets: ['posts'] })).datasets.posts.records;

test('writer repairs unsupported-address once, then the existing refresh gate publishes and serves the grounded snippet', { skip }, async (t) => {
  const handle = await refreshDb();
  t.after(() => handle.close());
  const { db } = handle;
  const business = JSON.parse(fs.readFileSync(new URL('../../data/businesses.json', import.meta.url)))
    .find((b) => b.slug === 'goodlife-fitness-liberty-village');
  const original = { ...post(SLUGS[0], 'GoodLife Fitness Liberty Village guide'),
    content: '## Details\n\nGoodLife Fitness Liberty Village is at 85 Hanna Ave Suite 200.' };
  const rev = (await db.query("select live_rev from content.entries where dataset='posts' and key=$1", [original.slug])).rows[0].live_rev;
  await publishDirect(db, { kind: 'manual', idempotencyKey: 'seed:grounding-writer', items: [
    { dataset: 'businesses', key: business.slug, payload: business },
    { dataset: 'posts', key: original.slug, payload: original, expectedLiveRev: Number(rev) },
  ] });
  const before = await livePosts(db);
  const snapshot = await reserveRefresh(db, { candidate: { slug: original.slug, mode: 'snippet' }, now: MON });
  const written = invokeRefreshWriter(t, { slug: original.slug, query: 'goodlife guide', mode: 'snippet' }, true, 'lint-repair', { target: original });
  assert.equal(written.probes.length, 2, 'unsupported intro must receive a revision before submission');
  const record = extractRefreshedPost({ ...written.observed.result, slug: original.slug, mode: 'snippet' });
  assert.match(record.content, /^GoodLife Fitness Liberty Village is at 85 Hanna Ave/);
  const site = await localSite(db);
  t.after(() => site.close());
  const out = await submitRefresh(db, { snapshotId: snapshot.snapshotId, before,
    after: before.map((p) => p.slug === record.slug ? record : p),
    actor: 'uat:writer-grounding', checkout: REPO, now: MON, env: site.env,
    deps: { gate: { review: pass, smoke: FAST_SMOKE } } });
  assert.equal(out.exitCode, 0, JSON.stringify(out.result));
  assert.equal(out.result.state, 'published');
  assert.equal(splitIntro(record.content).rest, original.content, 'legacy body remains byte-for-byte unchanged');
  const url = `${site.origin}/blog/${record.slug}`;
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.ok((await response.text()).includes(record.title.replaceAll('&', '&amp;')));
  const exported = await fetch(`${site.origin}/content-snapshot/posts.json`);
  assert.equal(exported.status, 200);
  assert.equal((await exported.json()).find((p) => p.slug === record.slug).content, record.content);
  assert.equal((await liveRecord(db, 'posts', record.slug)).content, record.content);
  t.diagnostic(`GET ${url} -> 200; GET ${site.origin}/content-snapshot/posts.json -> 200, grounded intro exported; writer received unsupported-address and revised once; existing gate published; immutable stale body preserved.`);
});

test('writer repairs draft-changed-topic once, then the unchanged gate publishes and serves the bound title', { skip }, async (t) => {
  const handle = await refreshDb();
  t.after(() => handle.close());
  const { db } = handle;
  const business = JSON.parse(fs.readFileSync(new URL('../../data/businesses.json', import.meta.url)))
    .find((b) => b.slug === 'goodlife-fitness-liberty-village');
  const original = { ...post(SLUGS[0], 'GoodLife Fitness: Honest Review, Prices & Hours 2026'),
    content: '## Details\n\nGoodLife Fitness Liberty Village is at 85 Hanna Ave Suite 200.' };
  const rev = (await db.query("select live_rev from content.entries where dataset='posts' and key=$1", [original.slug])).rows[0].live_rev;
  await publishDirect(db, { kind: 'manual', idempotencyKey: 'seed:binding-writer', items: [
    { dataset: 'businesses', key: business.slug, payload: business },
    { dataset: 'posts', key: original.slug, payload: original, expectedLiveRev: Number(rev) },
  ] });
  const before = await livePosts(db);
  const snapshot = await reserveRefresh(db, { candidate: { slug: original.slug, mode: 'snippet' }, now: MON });
  const written = invokeRefreshWriter(t, { slug: original.slug, query: 'goodlife guide', mode: 'snippet' }, true, 'title-repair', { target: original });
  assert.equal(written.probes.length, 2, 'unbound title must receive a revision before submission');
  const record = extractRefreshedPost({ ...written.observed.result, slug: original.slug, mode: 'snippet' });
  assert.equal(record.title, 'GoodLife Fitness Review: Prices, Hours & Tips');
  const site = await localSite(db);
  t.after(() => site.close());
  const out = await submitRefresh(db, { snapshotId: snapshot.snapshotId, before,
    after: before.map((p) => p.slug === record.slug ? record : p),
    actor: 'uat:writer-binding', checkout: REPO, now: MON, env: site.env,
    deps: { gate: { review: pass, smoke: FAST_SMOKE } } });
  assert.equal(out.exitCode, 0, JSON.stringify(out.result));
  assert.equal(out.result.state, 'published');
  assert.equal(splitIntro(record.content).rest, original.content, 'legacy body remains byte-for-byte unchanged');
  const url = `${site.origin}/blog/${record.slug}`;
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.ok((await response.text()).includes(record.title.replaceAll('&', '&amp;')));
  const exported = await fetch(`${site.origin}/content-snapshot/posts.json`);
  assert.equal(exported.status, 200);
  assert.equal((await exported.json()).find((p) => p.slug === record.slug).content, record.content);
  assert.equal((await liveRecord(db, 'posts', record.slug)).content, record.content);
  t.diagnostic(`GET ${url} -> 200; GET ${site.origin}/content-snapshot/posts.json -> 200, grounded intro exported; writer received draft-changed-topic and revised once; existing gate published; immutable stale body preserved.`);
});

// The runner's binding, in process: real store/submit/gate/deploy, fake generator.
function loopDeps(db, site, { now, review = pass, rewrite, recordAction, seen, events }) {
  return {
    plan: () => planRefresh(db, { gsc: GSC, now, env: site.env, checkout: REPO, deps: { gate: { review, smoke: FAST_SMOKE }, recordAction } }),
    reserve: (candidate) => reserveRefresh(db, { candidate, now }),
    generate: async (snapshot) => {
      // Snapshot first: the row exists and still equals what is live, before any change.
      const row = (await db.query('select payload_sha256, live_rev from content.refresh_snapshots where id=$1', [snapshot.snapshotId])).rows[0];
      const live = await liveRecord(db, 'posts', snapshot.slug);
      seen?.push({ slug: snapshot.slug, snapshotSha: row.payload_sha256, liveSha: recordSha(live) });
      const before = await livePosts(db);
      return { before, after: before.map((p) => (p.slug === snapshot.slug ? rewrite(p, snapshot) : p)) };
    },
    submit: async (snapshot, generated) => (await submitRefresh(db, {
      snapshotId: snapshot.snapshotId, ...generated, actor: 'uat:refresh', env: site.env, checkout: REPO, now,
      deps: { gate: { review, smoke: FAST_SMOKE }, recordAction },
    })).result,
    close: (fields) => closeRefresh(db, { ...fields, now }),
    log: (event, details) => events?.push({ event, ...details }),
  };
}
// The writer, faked: a snippet refresh rewrites title, description and intro only.
const snippetOnly = (p) => ({ ...p, title: `${p.title}: where to park and what it costs`, description: 'Lots, street rules and rates in one place.',
  content: `Short answer first: the paid lots fill early.\n\n${p.content}`, updatedAt: '2026-11-02' });
const byLane = (p, snapshot) => (snapshot.mode === 'snippet' ? snippetOnly(p) : better(p));
const better = (p) => ({ ...p, title: `${p.title}: routes, timing and tips`, description: `${p.description} Updated with clearer routes and timing.`,
  content: `${p.content}\n## Timing\n\nWeekday mornings are quieter.\n`, updatedAt: '2026-11-02' });

test('runner discards other-post edits before real DB publish and local HTTP smoke', { skip }, async (t) => {
  const { db, close } = await refreshDb();
  const site = await localSite(db);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-refresh-contained-'));
  const trusted = path.join(root, 'trusted');
  const scratch = path.join(root, 'scratch');
  for (const dir of [trusted, scratch]) fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  try {
    await site.build();
    const before = await livePosts(db);
    const slug = SLUGS[0], otherSlug = SLUGS[1];
    const events = [];
    const postsFile = path.join(trusted, 'data/posts.json');
    const runner = refreshDeps({ target: 'test', slot: 'containment', request: {}, run: root,
      export: () => fs.writeFileSync(postsFile, JSON.stringify(before)),
      readPosts: () => JSON.parse(fs.readFileSync(postsFile, 'utf8')),
      writePosts: (posts) => fs.writeFileSync(postsFile, JSON.stringify(posts)),
      generate: () => {
        const output = before.map((p) => p.slug === slug ? better(p) : p.slug === otherSlug ? { ...p, content: `${p.content}\nPRIVATE OFF-TARGET BODY`, updatedAt: '2026-11-02' } : p);
        fs.writeFileSync(path.join(scratch, 'data/posts.json'), JSON.stringify(output));
        return acceptGeneratedOutput(scratch, trusted, 'seo-improvements', ['data/posts.json'], before, true);
      },
      log: (event, details) => events.push({ event, ...details }),
    });
    const deps = loopDeps(db, site, { now: MON, recordAction: async () => {}, events });
    const plan = deps.plan;
    deps.plan = async () => ({ ...await plan(), candidates: [{ slug, title: 'Guide walks', mode: 'full' }] });
    deps.generate = runner.generate;
    const result = await runRefreshLoop({ deps });
    assert.equal(result.refreshed, 1, JSON.stringify(result));
    assert.deepEqual(await liveRecord(db, 'posts', otherSlug), before.find((p) => p.slug === otherSlug));
    assert.deepEqual(JSON.parse(fs.readFileSync(postsFile, 'utf8')).filter((p) => p.slug !== slug), before.filter((p) => p.slug !== slug));
    assert.deepEqual(events.find((e) => e.discardedOffTarget).discardedOffTarget, [otherSlug]);
    assert.ok(!JSON.stringify(events).includes('PRIVATE OFF-TARGET BODY'));
    const items = (await db.query("select i.key from content.submission_items i join content.submissions s on s.id=i.submission_id where s.kind='refresh'")).rows;
    assert.deepEqual(items.map((i) => i.key), [slug]);
    const url = `${site.origin}/blog/${slug}`;
    const served = await fetch(url);
    assert.equal(served.status, 200);
    assert.ok((await served.text()).includes(better(before.find((p) => p.slug === slug)).title));
    t.diagnostic(`GET ${url} -> 200; refreshed title served; ${otherSlug} unchanged in DB and checkout; discardedOffTarget=[${otherSlug}]`);
  } finally { fs.rmSync(root, { recursive: true, force: true }); await site.close(); await close(); }
});

test('sorted-key single-post snippet publishes; an off-target edit is refused and logged without bodies', { skip }, async (t) => {
  const { db, close } = await refreshDb();
  const site = await localSite(db);
  try {
    await site.build();
    const before = await livePosts(db);
    const slug = SLUGS[0];
    const snapshot = await reserveRefresh(db, { candidate: { slug, mode: 'snippet' }, now: MON });
    const after = JSON.parse(canonicalJson(before.map((p) => p.slug === slug ? snippetOnly(p) : p)));
    const out = await submitRefresh(db, { snapshotId: snapshot.snapshotId, before, after, actor: 'uat:refresh', env: site.env, checkout: REPO, now: MON,
      deps: { gate: { review: pass, smoke: FAST_SMOKE } } });
    assert.equal(out.exitCode, 0, JSON.stringify(out.result));
    assert.equal(out.result.state, 'published');
    const url = `${site.origin}/blog/${slug}`;
    const served = await fetch(url);
    assert.equal(served.status, 200);
    assert.match(await served.text(), /where to park and what it costs/);
    t.diagnostic(`GET ${url} -> 200, refreshed title served`);
    for (const p of before.filter((p) => p.slug !== slug)) assert.deepEqual(await liveRecord(db, 'posts', p.slug), p);

    const current = await livePosts(db);
    const target = SLUGS[1];
    const other = SLUGS[2];
    const bad = JSON.parse(canonicalJson(current.map((p) => p.slug === target ? snippetOnly(p) : p.slug === other ? { ...p, content: `${p.content}\nPRIVATE BODY MUST NOT APPEAR IN LOGS` } : p)));
    const snap = await reserveRefresh(db, { candidate: { slug: target, mode: 'snippet' }, now: MON });
    const events = [];
    const result = await runRefreshLoop({ deps: {
      plan: () => ({ isoWeek: '2026-W45', remaining: 1, candidates: [{ slug: target }] }),
      reserve: () => snap, generate: () => ({ before: current, after: bad }),
      submit: async (s, generated) => (await submitRefresh(db, { snapshotId: s.snapshotId, ...generated, actor: 'uat:refresh', now: MON })).result,
      log: (event, details) => events.push({ event, details }),
    } });
    assert.equal(result.outcomes[0].reasonCode, 'refresh-off-target');
    const logged = events.find((e) => e.event === 'refresh-outcome').details;
    assert.deepEqual(logged.refusalDetail, { kind: 'changed', slug: other });
    assert.doesNotMatch(JSON.stringify(logged), /PRIVATE BODY|content/);
    assert.deepEqual(await liveRecord(db, 'posts', other), current.find((p) => p.slug === other));
    assert.equal((await db.query("select count(*)::int as n from content.submissions where kind='refresh'")).rows[0].n, 1, 'off-target output never reaches submission');
  } finally { await site.close(); await close(); }
});

test('refresh comparison keeps array order, values and post membership strict; key order alone is no change', () => {
  const before = SLUGS.slice(0, 2).map((slug) => post(slug, slug));
  const slug = SLUGS[0];
  assert.throws(() => extractRefreshedPost({ before, after: JSON.parse(canonicalJson(before)), slug }), (e) => e.reason === 'refresh-no-change');
  const after = JSON.parse(canonicalJson(before.map((p) => p.slug === slug ? snippetOnly(p) : p)));
  for (const change of [
    (p) => ({ ...p, tags: [...p.tags].reverse() }),
    (p) => ({ ...p, updatedAt: '2026-11-02' }),
    (p) => ({ ...p, faqs: p.faqs.map((q, i) => i ? q : { ...q, answer: 'Changed' }) }),
  ]) assert.throws(() => extractRefreshedPost({ before, after: [after[0], change(after[1])], slug }), (e) => e.reason === 'refresh-off-target');
  for (const [posts, kind, changedSlug] of [[after.slice(0, 1), 'removed', SLUGS[1]], [[...after, post('refresh-added', 'Added')], 'added', 'refresh-added'], [[...after, after[1]], 'duplicate', SLUGS[1]]]) {
    assert.throws(() => extractRefreshedPost({ before, after: posts, slug }), (e) => {
      assert.deepEqual(e.detail, { kind, slug: changedSlug }); return true;
    });
  }
});

test('weekly run: refreshes the 2 weakest posts in place, ledger gets before/after, cap holds across runs, rollback restores the exact row', { skip }, async () => {
  const { db, close } = await refreshDb();
  const site = await localSite(db);
  try {
    await site.build();
    const actions = [];
    const seen = [];
    const run1 = await runRefreshLoop({ deps: loopDeps(db, site, { now: MON, rewrite: byLane, seen, recordAction: async (_db, action) => { actions.push(action); return { id: actions.length }; } }) });
    assert.equal(run1.refreshed, 2);
    assert.deepEqual(run1.outcomes.map((o) => [o.slug, o.mode, o.state]), [[SLUGS[0], 'full', 'published'], [SLUGS[1], 'snippet', 'published']], 'the two weakest by score, in order; one full, one snippet');
    for (const s of seen) assert.equal(s.snapshotSha, s.liveSha, `${s.slug}: snapshot taken before any change`);

    // Same slug and URL: an in-place update of the existing entry, now live with the new title.
    const subs = (await db.query("select s.id, s.state, i.key, i.op from content.submissions s join content.submission_items i on i.submission_id=s.id where s.kind='refresh' order by s.id")).rows;
    assert.deepEqual(subs.map((r) => [r.key, r.op, r.state]), [[SLUGS[0], 'update', 'published'], [SLUGS[1], 'update', 'published']]);
    const live = await livePosts(db);
    assert.equal(live.length, 4 + SLUGS.length, 'no post added or removed');
    assert.match((await liveRecord(db, 'posts', SLUGS[0])).title, /routes, timing and tips$/);
    assert.ok(site.state.deployment.pages.has(`/blog/${SLUGS[0]}`), 'the deploy hook rebuilt the same URL');
    assert.equal(run1.outcomes[0].url, page(SLUGS[0]));

    assert.equal(actions.length, 2);
    assert.equal(actions[0].actionKind, 'refresh');
    assert.equal(actions[0].slug, SLUGS[0]);
    assert.equal(actions[0].url, page(SLUGS[0]));
    assert.equal(actions[0].targetQuery, 'liberty village walks');
    assert.equal(actions[0].queryType, 'local-intent');
    assert.equal(actions[0].pageType, 'blog');
    assert.deepEqual(actions[0].baseline, { clicks: 10, impressions: 1000, ctr: 0.01, position: 3 });
    assert.equal(actions[0].details.snapshotId, run1.outcomes[0].snapshotId);
    assert.deepEqual([actions[0].actionType, actions[0].details.actionType], ['refresh', 'refresh']);
    assert.deepEqual([actions[1].actionType, actions[1].details.actionType], ['snippet', 'snippet']);
    assert.equal(actions[1].targetQuery, 'liberty village parking');
    // The published snippet refresh left the body beyond the intro byte-identical.
    const parkingBefore = (await db.query('select payload from content.refresh_snapshots where id=$1', [run1.outcomes[1].snapshotId])).rows[0].payload;
    const parkingAfter = await liveRecord(db, 'posts', SLUGS[1]);
    assert.notEqual(parkingAfter.title, parkingBefore.title);
    assert.equal(splitIntro(parkingAfter.content).rest, splitIntro(parkingBefore.content).rest);
    assert.deepEqual(parkingAfter.faqs, parkingBefore.faqs);
    assert.equal(actions[0].details.before.title, 'Guide walks');
    assert.equal(actions[0].details.after.title, 'Guide walks: routes, timing and tips');
    assert.match(actions[0].details.change, /title/);

    // Cap shared by both lanes: 1 full + 1 snippet = 2, so a second run the same ISO week
    // refreshes nothing, and the DB refuses a direct reserve in either lane.
    const run2 = await runRefreshLoop({ deps: loopDeps(db, site, { now: MON, rewrite: byLane, recordAction: async () => {} }) });
    assert.equal(run2.refreshed, 0);
    assert.equal(run2.attempted, 0);
    const direct = await reserveRefresh(db, { candidate: { slug: SLUGS[2] }, now: new Date(MON.getTime() + 3 * 86_400_000) });
    assert.equal(direct.capReached, true);
    assert.equal((await reserveRefresh(db, { candidate: { slug: SLUGS[3], mode: 'snippet' }, now: MON })).capReached, true);
    assert.equal((await db.query("select count(*)::int as n from content.refresh_snapshots where iso_week='2026-W45'")).rows[0].n, 2);
    // Next week the cap resets; the two refreshed posts sit out their cooldown.
    const nextPlan = await planRefresh(db, { gsc: GSC, now: NEXT_MON });
    assert.equal(nextPlan.remaining, REFRESH.weeklyCap);
    assert.deepEqual(nextPlan.candidates.map((c) => c.slug), [SLUGS[2]]);

    // Rollback restores the snapshot's exact payload through the admin rollback + deploy path.
    const snap = (await db.query('select payload, payload_sha256 from content.refresh_snapshots where id=$1', [run1.outcomes[0].snapshotId])).rows[0];
    const rolled = await rollbackRefresh(db, { snapshotId: run1.outcomes[0].snapshotId, actor: 'uat:rollback', env: site.env, deps: { gate: { smoke: FAST_SMOKE } } });
    assert.equal(rolled.exitCode, 0);
    const restored = await liveRecord(db, 'posts', SLUGS[0]);
    assert.deepEqual(restored, snap.payload);
    assert.equal(recordSha(restored), snap.payload_sha256);
    assert.equal((await listRefreshes(db, { target: 'test' })).find((r) => r.slug === SLUGS[0]).state, 'rolled-back');
  } finally { await site.close(); await close(); }
});

test('gate failure or a slug change publishes nothing, keeps the snapshot and logs a plain-English reason', { skip }, async () => {
  const { db, close } = await refreshDb();
  const site = await localSite(db);
  try {
    await site.build();
    const before = Object.fromEntries(await Promise.all(SLUGS.map(async (slug) => [slug, recordSha(await liveRecord(db, 'posts', slug))])));
    const reject = async ({ contentSha }) => ({ overall: 3, findings: [{ severity: 'critical', note: 'invented a street closure' }], model: GATE_MODEL, commit_sha: contentSha });
    const actions = [];
    const recordAction = async (_db, action) => { actions.push(action); };
    let calls = 0;
    const rewrite = (p) => (++calls === 1 ? better(p) : { ...better(p), slug: `${p.slug}-2026` });
    const result = await runRefreshLoop({ deps: loopDeps(db, site, { now: MON, review: reject, rewrite, recordAction }) });
    assert.equal(result.refreshed, 0);
    assert.deepEqual(result.outcomes.map((o) => [o.slug, o.state, o.reasonCode]), [
      [SLUGS[0], 'failed', 'refresh-gate-failed'],
      [SLUGS[1], 'failed', 'refresh-slug-changed'],
      [SLUGS[2], 'failed', 'refresh-slug-changed'],
    ]);
    for (const slug of SLUGS) assert.equal(recordSha(await liveRecord(db, 'posts', slug)), before[slug], `${slug} unchanged`);
    assert.equal((await db.query("select count(*)::int as n from content.revisions r join content.submissions s on s.id=r.submission_id where s.kind='refresh' and r.published_at is not null")).rows[0].n, 0, 'no refresh revision published');
    assert.deepEqual((await db.query("select state from content.submissions where kind='refresh'")).rows.map((r) => r.state), ['blocked'], 'the slug change never reached submit');
    assert.equal(site.state.hookPosts, 0, 'no deploy hook');
    assert.equal(actions.length, 0, 'no ledger row for an unpublished refresh');
    const snaps = await listRefreshes(db, { target: 'test' });
    assert.equal(snaps.length, 3, 'snapshots retained');
    for (const o of result.outcomes) {
      const e = explain(o.reasonCode);
      assert.equal(e.known, true, o.reasonCode);
      assert.match(e.impact, /kept its previous version/);
    }
    // Failed attempts do not use up the 2 refreshes, but they count toward the 4 attempts a week.
    const fourth = await reserveRefresh(db, { candidate: { slug: SLUGS[3] }, now: MON });
    assert.ok(fourth.snapshotId);
    await closeRefresh(db, { snapshotId: fourth.snapshotId, reasonCode: 'refresh-generator-failed', now: MON });
    assert.equal((await reserveRefresh(db, { candidate: { slug: SLUGS[3] }, now: MON })).capReached, true);
  } finally { await site.close(); await close(); }
});

test('a live row that moved after the snapshot is a conflict, never overwritten; a missing ledger is not fatal', { skip }, async () => {
  const { db, close } = await refreshDb();
  const site = await localSite(db);
  try {
    await site.build();
    const snapshot = await reserveRefresh(db, { candidate: { slug: SLUGS[0], baseline: { clicks: 1, impressions: 100, ctr: 0.01, position: 5 } }, now: MON });
    const before = await livePosts(db);
    await publishDirect(db, { items: [{ dataset: 'posts', key: SLUGS[0], payload: { ...post(SLUGS[0], 'Edited elsewhere') }, expectedLiveRev: snapshot.liveRev }], idempotencyKey: 'manual:edit', kind: 'manual' });
    const after = before.map((p) => (p.slug === SLUGS[0] ? better(p) : p));
    const out = await submitRefresh(db, { snapshotId: snapshot.snapshotId, before, after, actor: 'uat:refresh', env: site.env, checkout: REPO, now: MON, deps: { gate: { review: pass, smoke: FAST_SMOKE } } });
    assert.equal(out.exitCode, 2);
    assert.equal(out.result.reasonCode, 'refresh-conflict');
    assert.equal((await liveRecord(db, 'posts', SLUGS[0])).title, 'Edited elsewhere');

    // Same fact check as a new post: a rewrite naming a business we do not list never publishes.
    const linted = await reserveRefresh(db, { candidate: { slug: SLUGS[2] }, now: MON });
    const current = await livePosts(db);
    const invented = (p) => ({ ...better(p), content: `${p.content}\n[Fake Bistro](/directory/fake-bistro) serves brunch.\n` });
    const lint = await submitRefresh(db, { snapshotId: linted.snapshotId, before: current, after: current.map((p) => (p.slug === SLUGS[2] ? invented(p) : p)),
      actor: 'uat:refresh', env: site.env, checkout: REPO, now: MON, deps: { gate: { review: pass, smoke: FAST_SMOKE } } });
    assert.equal(lint.exitCode, 2);
    // Caught twice over: the new-post claim linter ([unrecorded-business]) and the original-post binding.
    assert.equal(lint.result.reasonCode, 'refresh-unbound');
    assert.equal((await liveRecord(db, 'posts', SLUGS[2])).content.includes('Fake Bistro'), false);
    const { checkKindPolicy, validateRecord } = { ...(await import('../../scripts/content/submit.mjs')), ...(await import('../../scripts/content/validate.mjs')) };
    const original = await liveRecord(db, 'posts', SLUGS[2]);
    const policy = checkKindPolicy({ kind: 'refresh', items: [{ dataset: 'posts', key: SLUGS[2], op: 'update', payload: invented(original) }],
      ctx: { now: MON.toISOString(), refresh: { mode: 'full', original } }, live: { businesses: [], posts: current }, deps: { validateRecord, lintMode: 'fail' } });
    assert.ok(policy.lint.some((finding) => finding.includes('[unrecorded-business]')), 'the new-post claim linter runs for refresh');

    // Ledger module absent (slice A not merged): the refresh still publishes and closes.
    const second = await reserveRefresh(db, { candidate: { slug: SLUGS[1] }, now: MON });
    const posts = await livePosts(db);
    const done = await submitRefresh(db, { snapshotId: second.snapshotId, before: posts, after: posts.map((p) => (p.slug === SLUGS[1] ? better(p) : p)),
      actor: 'uat:refresh', env: site.env, checkout: REPO, now: MON, deps: { gate: { review: pass, smoke: FAST_SMOKE }, recordAction: async () => { throw new Error('ledger down'); } } });
    assert.equal(done.exitCode, 0);
    assert.equal(done.result.state, 'published');
    assert.equal(done.result.ledger, 'unavailable');
  } finally { await site.close(); await close(); }
});

test('migration 0007 adds the refresh kind and is idempotent', { skip }, async () => {
  const { db, close } = await refreshDb();
  try {
    const sql = fs.readFileSync(new URL('../../scripts/content/migrations/0007_refresh_snapshots.sql', import.meta.url), 'utf8');
    await db.query(sql);
    await db.query(sql);
    const snap = await reserveRefresh(db, { candidate: { slug: SLUGS[3] }, now: MON });
    await assert.rejects(db.query("update content.refresh_snapshots set payload='{}'::json where id=$1", [snap.snapshotId]), /refresh-snapshot-immutable/);
    await assert.rejects(db.query('delete from content.refresh_snapshots where id=$1', [snap.snapshotId]), /refresh-snapshot-immutable/);
    assert.equal(keyOf('posts', (await liveRecord(db, 'posts', SLUGS[3]))), SLUGS[3]);
  } finally { await close(); }
});

// ── Review round 1 (Sol): the guarantees must hold through gate repair, deploy
// retries and the new-post source binding. ──────────────────────────────────
const { buildRecordRepairPlan } = await import('../../scripts/automation/record-repair.mjs');
const { submitContent } = await import('../../scripts/content/submit.mjs');
const repairVerdict = (slug) => async ({ contentSha }) => ({ overall: 6.5, findings: [{ severity: 'high', path: `data/posts.json#${slug}`, note: 'Clarify the last section.' }], model: GATE_MODEL, commit_sha: contentSha });
// A real fixer: asks the validator, throws on refusal (review-agent planRecordRepair).
const fixer = (edit, seen) => async ({ validate, payload }) => {
  const record = edit(payload[0].records[0]);
  const check = validate(buildRecordRepairPlan({ files: [{ file: 'data/posts.json', records: [{ key: record.slug, record }] }], reason: 'repair' }));
  seen.push(check);
  if (!check.ok) throw new Error(`invalid repair plan: ${check.errors.join('; ')}`);
  return { check };
};
const sequence = (...verdicts) => { let i = 0; return (args) => verdicts[Math.min(i++, verdicts.length - 1)](args); };
const overreach = (p) => ({ ...p, content: `${p.content}\n## Repair beyond intro\n\nPlanning ahead helps.\n`, faqs: p.faqs.map((q, i) => (i ? q : { ...q, answer: 'Changed by repair.' })) });

test('SOL-B-1: a gate repair cannot widen a snippet refresh; a valid snippet repair still publishes', { skip }, async () => {
  const { db, close } = await refreshDb();
  const site = await localSite(db);
  try {
    await site.build();
    const submitSnippet = async (slug, review, fix) => {
      const snap = await reserveRefresh(db, { candidate: { slug, mode: 'snippet' }, now: MON });
      const posts = await livePosts(db);
      return { snap, out: await submitRefresh(db, { snapshotId: snap.snapshotId, before: posts, after: posts.map((p) => (p.slug === slug ? { ...p, title: `${p.title}: better snippet` } : p)),
        actor: 'uat:refresh', env: site.env, checkout: REPO, now: MON, deps: { gate: { review, fix, smoke: FAST_SMOKE } } }) };
    };
    // Fixer overreach (body section + FAQ): the validator refuses it, nothing publishes.
    const original = await liveRecord(db, 'posts', SLUGS[0]);
    const checks = [];
    const refused = await submitSnippet(SLUGS[0], repairVerdict(SLUGS[0]), fixer(overreach, checks));
    assert.equal(refused.out.exitCode, 2);
    assert.equal(refused.out.result.state, 'failed');
    assert.ok(checks.length >= 1 && checks.every((c) => !c.ok && c.errors.some((e) => e.includes('refresh-snippet-overreach'))), 'every overreaching plan refused by the validator');
    assert.deepEqual(await liveRecord(db, 'posts', SLUGS[0]), original, 'live row untouched');

    // A fixer that bypasses its validator: the next gate round's own policy refuses before publish.
    const bypass = async ({ payload }) => ({ check: { ok: true, errors: [], repaired: [{ dataset: 'posts', key: payload[0].records[0].slug, payload: overreach(payload[0].records[0]) }] } });
    const caught = await submitSnippet(SLUGS[1], sequence(repairVerdict(SLUGS[1]), pass), bypass);
    assert.equal(caught.out.exitCode, 2);
    assert.equal(caught.out.result.reasonCode, 'refresh-snippet-overreach');
    assert.equal(explain('refresh-snippet-overreach').known, true);
    const sub = await store.getSubmission(db, caught.out.result.submissionId);
    assert.deepEqual([sub.submission.state, sub.submission.decision, sub.rounds.length], ['rejected', 'validation', 2], 'round 1 (the repaired draft) rejected by its deterministic check');
    assert.equal((await liveRecord(db, 'posts', SLUGS[1])).title, 'Guide parking');

    // A repair that stays in the snippet (title/description/intro) is accepted and publishes.
    const okChecks = [];
    const good = await submitSnippet(SLUGS[2], sequence(repairVerdict(SLUGS[2]), pass), fixer((p) => ({ ...p, description: 'A clearer description.', content: `Start here.\n\n${p.content}` }), okChecks));
    assert.equal(good.out.exitCode, 0);
    assert.equal(okChecks[0].ok, true);
    const live = await liveRecord(db, 'posts', SLUGS[2]);
    const snapPayload = (await db.query('select payload from content.refresh_snapshots where id=$1', [good.snap.snapshotId])).rows[0].payload;
    assert.equal(live.description, 'A clearer description.');
    assert.equal(splitIntro(live.content).rest, splitIntro(snapPayload.content).rest);
    assert.deepEqual(live.faqs, snapPayload.faqs);
  } finally { await site.close(); await close(); }
});

test('SOL-B-2: a deploy that has not confirmed stays pending; a retry or the next plan finishes it; only then refreshed', { skip }, async () => {
  const { db, close } = await refreshDb();
  const site = await localSite(db);
  try {
    await site.build();
    const actions = [];
    const deps = { gate: { review: pass, smoke: FAST_SMOKE }, recordAction: async (_db, action) => { actions.push(action); } };
    const start = async (slug) => {
      const snap = await reserveRefresh(db, { candidate: { slug }, now: MON });
      const posts = await livePosts(db);
      return { snap, posts };
    };
    site.state.hook = 503;
    const a = await start(SLUGS[0]);
    const after = a.posts.map((p) => (p.slug === SLUGS[0] ? better(p) : p));
    const first = await submitRefresh(db, { snapshotId: a.snap.snapshotId, before: a.posts, after, actor: 'uat:refresh', env: site.env, checkout: REPO, now: MON, deps });
    assert.equal(first.exitCode, 3);
    assert.deepEqual([first.result.state, first.result.pending, first.result.reasonCode], ['reserved', true, 'hook-failed']);
    assert.equal(refreshLogLine(first.result).state, 'pending');
    assert.match(renderRefreshed([{ ...refreshRow(refreshLogLine(first.result)), target: 'production' }]), /not live yet[\s\S]*readers still see the old page/);
    assert.doesNotMatch(renderRefreshed([{ ...refreshRow(refreshLogLine(first.result)), target: 'production' }]), />refreshed</);
    assert.equal(actions.length, 0, 'no ledger row before the page is live');
    assert.doesNotMatch(site.state.deployment.pages.get(`/blog/${SLUGS[0]}`).body.toString(), /routes, timing and tips/, 'old page still served');
    const pendingPlan = await planRefresh(db, { gsc: GSC, now: MON, env: site.env, deps });
    assert.equal(pendingPlan.settled[0].pending, true, 'plan tried to finish it; hook still down');

    // Hook recovers: the same-snapshot retry deploys (no regeneration) and confirms.
    site.state.hook = 'build';
    const hooks = site.state.hookPosts;
    const retry = await submitRefresh(db, { snapshotId: a.snap.snapshotId, before: a.posts, after: a.posts, actor: 'uat:refresh', env: site.env, checkout: REPO, now: MON, deps });
    assert.equal(retry.exitCode, 0);
    assert.equal(retry.result.state, 'published');
    assert.ok(site.state.hookPosts > hooks, 'the retry posted the deploy hook');
    assert.match(site.state.deployment.pages.get(`/blog/${SLUGS[0]}`).body.toString(), /routes, timing and tips/, 'new title served');
    assert.equal(actions.length, 1);
    assert.equal((await db.query("select count(*)::int as n from content.submissions where kind='refresh'")).rows[0].n, 1, 'no second refresh');

    // The next plan also finishes a pending deploy on its own.
    site.state.hook = 503;
    const b = await start(SLUGS[1]);
    const second = await submitRefresh(db, { snapshotId: b.snap.snapshotId, before: b.posts, after: b.posts.map((p) => (p.slug === SLUGS[1] ? better(p) : p)), actor: 'uat:refresh', env: site.env, checkout: REPO, now: MON, deps });
    assert.equal(second.exitCode, 3);
    assert.ok(!(await planRefresh(db, { gsc: GSC, now: NEXT_MON, env: site.env, deps })).candidates.some((c) => c.slug === SLUGS[1]), 'pending is not a candidate');
    site.state.hook = 'build';
    const plan = await planRefresh(db, { gsc: GSC, now: MON, env: site.env, deps });
    assert.deepEqual(plan.settled.map((s) => [s.slug, s.state, s.pending]), [[SLUGS[1], 'published', false]]);
    assert.equal(plan.remaining, 0, 'both confirmed refreshes count toward the week');
    assert.match(site.state.deployment.pages.get(`/blog/${SLUGS[1]}`).body.toString(), /routes, timing and tips/);
  } finally { await site.close(); await close(); }
});

test('SOL-B-3: refresh runs the new-post source binding: links, businesses and topic, also after repair', { skip }, async () => {
  const { db, close } = await refreshDb();
  const site = await localSite(db);
  try {
    await site.build();
    const business = (await store.readLive(db, { datasets: ['businesses'] })).datasets.businesses.records[0];
    const attempt = async (slug, edit, gate = { review: pass, smoke: FAST_SMOKE }) => {
      const snap = await reserveRefresh(db, { candidate: { slug }, now: MON });
      const posts = await livePosts(db);
      return submitRefresh(db, { snapshotId: snap.snapshotId, before: posts, after: posts.map((p) => (p.slug === slug ? edit(better(p)) : p)), actor: 'uat:refresh', env: site.env, checkout: REPO, now: MON, deps: { gate } });
    };
    const broken = await attempt(SLUGS[0], (p) => ({ ...p, content: `${p.content}\nSee [our other guide](/blog/sol-nonexistent-target).\n` }));
    assert.deepEqual([broken.exitCode, broken.result.reasonCode], [2, 'refresh-unbound'], 'nonexistent internal link refused');
    const related = await attempt(SLUGS[1], (p) => ({ ...p, relatedPosts: ['sol-nonexistent-target'] }));
    assert.equal(related.result.reasonCode, 'refresh-unbound');
    const outside = await attempt(SLUGS[2], (p) => ({ ...p, content: `${p.content}\n[${business.name}](/directory/${business.slug}) is nearby.\n` }));
    assert.equal(outside.result.reasonCode, 'refresh-unbound', 'a business the original post never named is outside its evidence');
    for (const slug of SLUGS.slice(0, 3)) assert.match((await liveRecord(db, 'posts', slug)).title, /^Guide /, `${slug} unchanged`);
    assert.equal(explain('refresh-unbound').known, true);

    // After repair: the fixer validator applies the same binding.
    const checks = [];
    const repaired = await attempt(SLUGS[3], (p) => p, { review: repairVerdict(SLUGS[3]), smoke: FAST_SMOKE,
      fix: fixer((p) => ({ ...p, content: `${p.content}\n[More](/guide/sol-nonexistent-topic)\n` }), checks) });
    assert.equal(repaired.exitCode, 2);
    assert.ok(checks.every((c) => !c.ok && c.errors.some((e) => e.includes('invalid-internal-link:/guide/sol-nonexistent-topic'))));
    assert.match((await liveRecord(db, 'posts', SLUGS[3])).title, /^Guide /);

    // The binding cannot be skipped: a bare `content submit --kind refresh` is refused.
    const bare = { ...(await liveRecord(db, 'posts', SLUGS[3])), title: 'Guide dogs: bare submit' };
    await assert.rejects(submitContent(db, { kind: 'refresh', idempotencyKey: 'bare', actor: 'uat', root: REPO, recordFile: tempJson(bare), dataset: 'posts', baseline: await baselineFile(db) }, { checkout: REPO }),
      /refresh submit requires its snapshot binding/);
  } finally { await site.close(); await close(); }
});

test('SOL-B-2 round 2: run 1 hits a 503, run 2 confirms it; the digest shows that refresh once, as refreshed, with before/after', { skip }, async () => {
  const { db, close } = await refreshDb();
  const site = await localSite(db);
  const { buildModel, parseRun } = await import('../../ops/weekly-digest/lib/digest.mjs');
  try {
    await site.build();
    const actions = [];
    const recordAction = async (_db, action) => { actions.push(action); };
    const runLog = async (slot, hour) => {
      const events = [];
      const result = await runRefreshLoop({ deps: loopDeps(db, site, { now: MON, rewrite: byLane, recordAction, events }) });
      const at = (i) => `2026-11-0${hour}T0${i % 10}:00:00Z`;
      const lines = [{ at: at(0), event: 'start', job: 'seo-improvements', target: 'production', slot }, ...events.map((e, i) => ({ at: at(i + 1), ...e })),
        { at: at(9), event: 'success', result: { reason: `refreshed ${result.refreshed} of ${result.attempted}` } }];
      return { result, run: parseRun(`seo-improvements-production-${slot}.jsonl`, lines.map((l) => JSON.stringify(l)).join('\n')) };
    };
    site.state.hook = 503;
    const first = await runLog('202611030423-scheduled', 3);
    assert.equal(first.result.refreshed, 0);
    assert.deepEqual(first.result.outcomes.map((o) => [o.slug, Boolean(o.pending)]), [[SLUGS[0], true]], 'run 1 stops on the pending deploy');
    site.state.hook = 'build';
    const second = await runLog('202611040423-ondemand', 4);
    assert.equal(second.result.recovered, 1, 'run 2 confirmed the pending refresh');
    assert.ok(second.run.refreshes.some((r) => r.slug === SLUGS[0] && r.state === 'published'), 'run 2 logs the confirmed outcome');
    assert.match(site.state.deployment.pages.get(`/blog/${SLUGS[0]}`).body.toString(), /routes, timing and tips/);
    assert.equal(actions.filter((a) => a.slug === SLUGS[0]).length, 1);

    const model = buildModel({ generatedAt: '2026-11-09T13:00:00.000Z', window: { from: '2026-11-02T12:00:00.000Z', to: '2026-11-09T12:00:00.000Z' }, runs: [first.run, second.run], posted: [] });
    const rows = model.refreshes.filter((r) => r.slug === SLUGS[0]);
    assert.equal(rows.length, 1, 'exactly once');
    assert.equal(rows[0].state, 'published');
    assert.deepEqual([rows[0].before.title, rows[0].after.title], ['Guide walks', 'Guide walks: routes, timing and tips']);
    const html = renderRefreshed(model.refreshes);
    assert.doesNotMatch(html, /not live yet/, 'the pending entry is gone');
    assert.match(html, /<s class="dim">Guide walks<\/s><br>Guide walks: routes, timing and tips/);
  } finally { await site.close(); await close(); }
});
