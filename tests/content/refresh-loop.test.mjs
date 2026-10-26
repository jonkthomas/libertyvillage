// Refresh loop (scripts/content/refresh.mjs): weakest-post selection from GSC
// rows, snapshot-before-change, same slug/URL, the full refresh gate on a real
// local store, the durable weekly cap of 2, gate-fail publishes nothing, the
// ledger call carries before/after, and rollback restores the exact row.
import './fixtures/agent-sdk-mock.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { GATE_MODEL } from '../../scripts/automation/constants.mjs';
import * as store from '../../scripts/content/store.mjs';
import { keyOf, recordSha } from '../../scripts/content/canonical.mjs';
import { explain } from '../../ops/weekly-digest/lib/plain-english.mjs';
import {
  REFRESH, closeRefresh, expectedCtr, extractRefreshedPost, listRefreshes, planRefresh, rankRefreshCandidates, refreshScore,
  reserveRefresh, rollbackRefresh, runRefreshLoop, submitRefresh,
} from '../../scripts/content/refresh.mjs';
import { FAST_SMOKE, hasTestDb, liveRecord, localSite, publishDirect, seededDb } from './fixtures/content-db.mjs';

const skip = !hasTestDb && 'CONTENT_TEST_DATABASE_URL not set';
const REPO = fileURLToPath(new URL('../../', import.meta.url));
const IMAGE = JSON.parse(fs.readFileSync(new URL('../../data/posts.json', import.meta.url), 'utf8'))[0].image;
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
    { page: page(SLUGS[0]), query: 'walking liberty village', clicks: 1, impressions: 90, ctr: 0.01, position: 4 },
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
  assert.equal(ranked[0].url, page(SLUGS[0]));
  assert.deepEqual(rankRefreshCandidates({ gsc: GSC, posts, exclude: new Set([SLUGS[0]]) }).map((c) => c.slug)[0], SLUGS[1], 'cooldown exclusions skip a post');
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

// The runner's binding, in process: real store/submit/gate/deploy, fake generator.
function loopDeps(db, site, { now, review = pass, rewrite, recordAction, seen }) {
  return {
    plan: () => planRefresh(db, { gsc: GSC, now }),
    reserve: (candidate) => reserveRefresh(db, { candidate, now }),
    generate: async (snapshot) => {
      // Snapshot first: the row exists and still equals what is live, before any change.
      const row = (await db.query('select payload_sha256, live_rev from content.refresh_snapshots where id=$1', [snapshot.snapshotId])).rows[0];
      const live = await liveRecord(db, 'posts', snapshot.slug);
      seen?.push({ slug: snapshot.slug, snapshotSha: row.payload_sha256, liveSha: recordSha(live) });
      const before = await livePosts(db);
      return { before, after: before.map((p) => (p.slug === snapshot.slug ? rewrite(p) : p)) };
    },
    submit: async (snapshot, generated) => (await submitRefresh(db, {
      snapshotId: snapshot.snapshotId, ...generated, actor: 'uat:refresh', env: site.env, checkout: REPO, now,
      deps: { gate: { review, smoke: FAST_SMOKE }, recordAction },
    })).result,
    close: (fields) => closeRefresh(db, { ...fields, now }),
    log: () => {},
  };
}
const better = (p) => ({ ...p, title: `${p.title}: routes, timing and tips`, description: `${p.description} Updated with clearer routes and timing.`,
  content: `${p.content}\n## Timing\n\nWeekday mornings are quieter.\n`, updatedAt: '2026-11-02' });

test('weekly run: refreshes the 2 weakest posts in place, ledger gets before/after, cap holds across runs, rollback restores the exact row', { skip }, async () => {
  const { db, close } = await refreshDb();
  const site = await localSite(db);
  try {
    await site.build();
    const actions = [];
    const seen = [];
    const run1 = await runRefreshLoop({ deps: loopDeps(db, site, { now: MON, rewrite: better, seen, recordAction: async (_db, action) => { actions.push(action); return { id: actions.length }; } }) });
    assert.equal(run1.refreshed, 2);
    assert.deepEqual(run1.outcomes.map((o) => o.slug), [SLUGS[0], SLUGS[1]], 'the two weakest by score, in order');
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
    assert.equal(actions[0].details.before.title, 'Guide walks');
    assert.equal(actions[0].details.after.title, 'Guide walks: routes, timing and tips');
    assert.match(actions[0].details.change, /title/);

    // Cap: a second run the same ISO week refreshes nothing, and the DB refuses a direct reserve too.
    const run2 = await runRefreshLoop({ deps: loopDeps(db, site, { now: MON, rewrite: better, recordAction: async () => {} }) });
    assert.equal(run2.refreshed, 0);
    assert.equal(run2.attempted, 0);
    const direct = await reserveRefresh(db, { candidate: { slug: SLUGS[2] }, now: new Date(MON.getTime() + 3 * 86_400_000) });
    assert.equal(direct.capReached, true);
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
    assert.equal(lint.result.reasonCode, 'refresh-fact-check');
    assert.equal(explain(lint.result.reasonCode).title, 'Refresh failed the fact check');

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
