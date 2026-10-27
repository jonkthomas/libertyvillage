import './fixtures/agent-sdk-mock.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { decideRefresh, evaluateRefreshes, evaluationWindows, fetchEvaluationRows } from '../../scripts/content/refresh-evaluate.mjs';
import { closeRefresh, refreshIdempotencyKey, reserveRefresh } from '../../scripts/content/refresh.mjs';
import { readLive } from '../../scripts/content/store.mjs';
import { baseline, cases, siteBefore } from './fixtures/refresh-evaluation-cases.mjs';
import { FAST_SMOKE, hasTestDb, liveRecord, localSite, publishDirect, seededDb } from './fixtures/content-db.mjs';
import { evaluateRefreshRun } from '../../ops/exedev-runner/runner.mjs';
import { buildModel, parseRun } from '../../ops/weekly-digest/lib/digest.mjs';
import { renderRefreshed } from '../../ops/weekly-digest/lib/refreshed.mjs';
import { explain } from '../../ops/weekly-digest/lib/plain-english.mjs';

for (const fixture of cases) test(`four-week decision: ${fixture.name}`, () => {
  const result = decideRefresh({ baseline, siteBefore, ...fixture });
  assert.equal(result.verdict, fixture.verdict);
  assert.equal(explain(result.reasonCode).known, true);
});

test('missing, malformed or zero site data fails closed', () => {
  for (const change of [{ page: null }, { siteAfter: null }, { siteAfter: { clicks: 0, impressions: 1000, position: 8 } },
    { baseline: null }, { page: { clicks: 1, impressions: NaN, position: 8 } }]) {
    assert.equal(decideRefresh({ baseline, page: baseline, siteBefore, siteAfter: siteBefore, ...change }), null);
  }
});

test('GSC uses final rows, fixed post-settling dates and exact page URL for any page kind', async () => {
  const calls = [];
  const snapshot = { url: 'https://libertyvillage.co/guide/parking-guide', created_at: '2026-10-01T05:00:00Z', closed_at: '2026-10-02T05:00:00Z',
    baseline: { ...baseline, startDate: '2026-09-01', endDate: '2026-09-28' } };
  const windows = evaluationWindows(snapshot);
  assert.deepEqual(windows, { before: { startDate: '2026-09-01', endDate: '2026-09-28' }, after: { startDate: '2026-10-09', endDate: '2026-10-29' } });
  const measured = await fetchEvaluationRows({ searchanalytics: { query: async (request) => {
    calls.push(request.requestBody);
    return { data: { rows: [baseline] } };
  } } }, snapshot);
  assert.equal(calls.length, 3);
  assert.ok(calls.every((c) => c.dataState === 'final'));
  assert.deepEqual(calls[0].dimensionFilterGroups[0].filters[0], { dimension: 'page', operator: 'equals', expression: snapshot.url });
  assert.equal(calls[1].dimensionFilterGroups, undefined, 'site-wide includes all page kinds');
  assert.deepEqual(measured.page, baseline);
  assert.equal((await fetchEvaluationRows({ searchanalytics: { query: async () => ({ data: {} }) } }, snapshot)).page, null);
});

const skip = !hasTestDb && 'CONTENT_TEST_DATABASE_URL not set';
const NOW = new Date('2026-12-01T05:00:00Z');
async function publishedSnapshot(db, post, when, index) {
  const snap = await reserveRefresh(db, { candidate: { slug: post.slug, baseline }, now: new Date(when) });
  assert.ok(snap.snapshotId);
  const refreshed = { ...post, title: `${post.title}: refreshed` };
  const published = await publishDirect(db, { kind: 'refresh', idempotencyKey: refreshIdempotencyKey(db.target, snap.snapshotId),
    items: [{ dataset: 'posts', key: post.slug, payload: refreshed, expectedLiveRev: snap.liveRev }] });
  await db.query('update content.submissions set smoke_passed_at=$2 where id=$1', [published.submissionId, when]);
  await closeRefresh(db, { snapshotId: snap.snapshotId, submissionId: published.submissionId,
    now: new Date(when), deps: { recordAction: async () => {} } });
  return { ...snap, post, refreshed, index };
}

test('local DB loser uses real rollback, confirms HTTP restore, persists learnings and second run does nothing', { skip }, async (t) => {
  const handle = await seededDb(); t.after(() => handle.close());
  const { db } = handle;
  const posts = (await readLive(db, { datasets: ['posts'] })).datasets.posts.records.filter((p) => p.category !== 'news' && !p.roundupCoverage);
  assert.ok(posts.length >= 3);
  const snapshots = [];
  for (let i = 0; i < 3; i++) snapshots.push(await publishedSnapshot(db, posts[i], `2026-10-${String(5 + i * 7).padStart(2, '0')}T05:00:00Z`, i));
  const site = await localSite(db); t.after(() => site.close()); await site.build();
  const pageUrl = `${site.origin}/blog/${snapshots[0].slug}`;
  assert.ok((await (await fetch(pageUrl)).text()).includes(snapshots[0].refreshed.title));
  const measure = async (s) => ({ page: [{ clicks: 16, impressions: 1000, position: 8 }, { clicks: 24, impressions: 1000, position: 8 },
    { clicks: 1, impressions: 199, position: 8 }][snapshots.find((snap) => snap.snapshotId === Number(s.id)).index], siteBefore, siteAfter: siteBefore });
  const result = await evaluateRefreshes(db, { now: NOW, env: site.env, deps: { measure, rollbackDeps: { gate: { smoke: FAST_SMOKE } } } });
  assert.deepEqual([result.evaluated, result.reverted, result.won], [3, 1, 1]);
  assert.deepEqual(result.outcomes.map((o) => o.verdict), ['lost', 'won', 'inconclusive']);
  assert.deepEqual(await liveRecord(db, 'posts', snapshots[0].slug), snapshots[0].post);
  assert.equal((await db.query('select state from content.refresh_snapshots where id=$1', [snapshots[0].snapshotId])).rows[0].state, 'rolled-back');
  const action = (await db.query("select actor,action,from_rev,to_rev from content.actions where actor='auto-revert'")).rows;
  assert.equal(action.length, 1); assert.equal(action[0].action, 'rollback');
  assert.ok(site.state.hookPosts > 0);
  const response = await fetch(pageUrl); assert.equal(response.status, 200);
  const html = await response.text(); assert.ok(html.includes(snapshots[0].post.title)); assert.ok(!html.includes(snapshots[0].refreshed.title));
  assert.equal(result.learnings.split('\n').length, 3); assert.match(result.learnings, /→.*CTR.*adjusted.*position.*lost/);
  const hooks = site.state.hookPosts;
  const again = await evaluateRefreshes(db, { now: NOW, deps: { measure: () => { throw new Error('must not measure twice'); } } });
  assert.deepEqual([again.evaluated, again.reverted, again.won], [0, 0, 0]); assert.equal(site.state.hookPosts, hooks);
  assert.equal((await db.query('select count(*)::int n from content.refresh_evaluations')).rows[0].n, 3);
  const cli = JSON.parse(execFileSync(process.execPath, ['scripts/content/cli.mjs', 'refresh', 'evaluate',
    '--target', 'test', '--expect-db', handle.name], { cwd: new URL('../../', import.meta.url), encoding: 'utf8',
    env: { ...process.env, CONTENT_DATABASE_URL: handle.url, CONTENT_DB_NAME: handle.name, CONTENT_SITE_URL: site.origin },
    stdio: ['ignore', 'pipe', 'pipe'] }));
  assert.deepEqual([cli.evaluated, cli.reverted, cli.won], [0, 0, 0]);
  t.diagnostic(`GET ${pageUrl} -> 200: old title restored; actor=auto-revert admin rollback; snapshot=rolled-back; evaluated=3 reverted=1 won=1; second run=0 hook calls=unchanged`);
});

test('moved live_rev, already rolled-back, young snapshots and absent GSC never trigger rollback', { skip }, async (t) => {
  const handle = await seededDb(); t.after(() => handle.close()); const { db } = handle;
  const post = (await readLive(db, { datasets: ['posts'] })).datasets.posts.records.find((p) => p.category !== 'news' && !p.roundupCoverage);
  const snap = await publishedSnapshot(db, post, '2026-10-05T05:00:00Z', 0);
  const measure = async () => ({ page: baseline, siteBefore, siteAfter: null });
  let result = await evaluateRefreshes(db, { now: new Date('2026-10-20'), deps: { measure } });
  assert.equal(result.evaluated, 0);
  result = await evaluateRefreshes(db, { now: NOW, deps: { measure } });
  assert.equal(result.deferred, 1); assert.equal(result.evaluated, 0);
  assert.equal((await db.query('select count(*)::int n from content.refresh_evaluations')).rows[0].n, 0);
  const rev = (await db.query("select live_rev from content.entries where dataset='posts' and key=$1", [post.slug])).rows[0].live_rev;
  await publishDirect(db, { kind: 'manual', idempotencyKey: 'later-edit', items: [{ dataset: 'posts', key: post.slug, payload: { ...post, title: 'Later edit' }, expectedLiveRev: rev }] });
  result = await evaluateRefreshes(db, { now: NOW, deps: { measure: () => { throw new Error('must skip'); } } });
  assert.equal(result.skipped, 1); assert.equal(result.evaluated, 0);
  assert.equal((await liveRecord(db, 'posts', post.slug)).title, 'Later edit');
  await db.query("update content.refresh_snapshots set state='rolled-back' where id=$1", [snap.snapshotId]);
  assert.equal((await evaluateRefreshes(db, { now: NOW })).skipped, 0);
});

test('runner evaluation logs reach the weekly digest as evaluated / reverted / won with plain-English reasons', () => {
  const events = [{ at: '2026-12-01T05:00:00Z', event: 'start', job: 'seo-improvements', target: 'production' }];
  const result = { evaluated: 2, reverted: 1, won: 1, learnings: 'old → new | won', outcomes: [
    { snapshotId: 1, slug: 'lost-page', verdict: 'lost', reasonCode: 'refresh-eval-lost', rollbackState: 'reverted' },
    { snapshotId: 2, slug: 'won-page', verdict: 'won', reasonCode: 'refresh-eval-won' },
  ] };
  const cli = (args) => { assert.deepEqual(args, ['refresh', 'evaluate', '--target', 'production']); return { stdout: JSON.stringify(result) }; };
  assert.equal(evaluateRefreshRun({ cli, target: 'production', log: (event, details) => events.push({ event, ...details }) }).learnings, result.learnings);
  const run = parseRun('seo-improvements-production-test.jsonl', events.map((e) => JSON.stringify(e)).join('\n'));
  const model = buildModel({ runs: [run], window: { to: '2026-12-02' } });
  const html = renderRefreshed([], model.refreshEvaluations);
  assert.match(html, /2 evaluated · 1 reverted · 1 won/); assert.match(html, /Refresh lost clicks at a steady position/);
  assert.doesNotMatch(html, /refresh-eval-lost/);
  evaluateRefreshRun({ cli: () => { throw new Error('dry run must not evaluate'); }, dryRun: true });
});

