import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { testDb } from './helpers/db.mjs';
import { recordAction, fillOutcomes, actionWeights, listActions, writeWeeklySnapshot, baselineFor, lastFullWeek } from '../../scripts/content/ledger.mjs';
import { recordPublishedPosts } from '../../scripts/content/submit.mjs';
import { seedRecords, publishDirect } from './fixtures/content-db.mjs';
const action = { actionKind: 'new_post', slug: 'coffee', url: 'https://libertyvillage.co/blog/coffee', pageType: 'blog', targetQuery: 'liberty village coffee', queryType: 'local-intent', actedAt: '2026-10-01T12:00:00Z', baseline: { clicks: 10, impressions: 100, ctr: 0.1, position: 15 } };

test('growth migration applies twice and UTC daily action identity preserves T0', async () => {
  const { db, close, url } = await testDb();
  try {
    const migration = await fs.readFile(new URL('../../scripts/content/migrations/0006_growth_ledger.sql', import.meta.url), 'utf8');
    await db.query(migration); await db.query(migration);
    await db.query("set timezone='America/Toronto'");
    const first = await recordAction(db, action);
    assert.deepEqual(await recordAction(db, { ...action, actedAt: '2026-10-01T23:59:00Z', baseline: { clicks: 999 } }), first);
    assert.notDeepEqual(await recordAction(db, { ...action, actedAt: '2026-10-02T00:01:00Z' }), first);
    const rows = await listActions(db, { since: '2026-10-01' });
    assert.equal(rows.length, 2); assert.equal(rows[1].baseline.clicks, 10);
    const stdout = execFileSync(process.execPath, ['scripts/content/ledger.mjs', 'list', '2026-10-01'], { env: { ...process.env, CONTENT_DATABASE_URL: url }, encoding: 'utf8' });
    assert.equal(JSON.parse(stdout).length, 2);
    console.log('LIVE ledger list CLI: 2 actions, original baseline 10 clicks preserved');
  } finally { await close(); }
});

test('fillOutcomes fills only due 2w/4w windows and does not fetch filled observations', async () => {
  const { db, close } = await testDb();
  try {
    await recordAction(db, action);
    const calls = [];
    const gscFetch = async (request) => { calls.push(request); return [{ clicks: 30, impressions: 200, ctr: 0.15, position: 8 }]; };
    assert.deepEqual(await fillOutcomes(db, { now: '2026-10-15T11:59:59Z', gscFetch }), { filled: 0 });
    assert.deepEqual(await fillOutcomes(db, { now: '2026-10-15T12:00:00Z', gscFetch }), { filled: 1 });
    let row = (await listActions(db))[0];
    assert.equal(row.outcome_2w.clicks, 30); assert.equal(row.outcome_4w, null);
    assert.deepEqual(calls[0], { start: '2026-10-08', end: '2026-10-14', dimensions: [], page: action.url, query: action.targetQuery });
    await fillOutcomes(db, { now: '2026-10-28T12:00:00Z', gscFetch }); assert.equal(calls.length, 1);
    await fillOutcomes(db, { now: '2026-10-29T12:00:00Z', gscFetch }); assert.equal(calls.length, 2);
    await fillOutcomes(db, { now: '2026-11-10T12:00:00Z', gscFetch }); assert.equal(calls.length, 2);
    row = (await listActions(db))[0]; assert.equal(row.outcome_4w.clicks, 30);
  } finally { await close(); }
});

test('weights average each action once, prefer 4w, ignore missing baselines, shrink small samples', async () => {
  const { db, close } = await testDb();
  try {
    const a = await recordAction(db, action);
    const b = await recordAction(db, { ...action, slug: 'b' });
    const c = await recordAction(db, { ...action, slug: 'c', baseline: {} });
    await db.query('update content.content_action_ledger set outcome_2w=$2,outcome_4w=$3 where id=$1', [a.id, { clicks: 20 }, { clicks: 40 }]);
    await db.query('update content.content_action_ledger set outcome_2w=$2 where id=any($1::bigint[])', [[b.id, c.id], { clicks: 20 }]);
    await recordAction(db, { ...action, slug: 'refresh', actionKind: 'refresh', pageType: 'guide', queryType: 'informational' });
    const weights = await actionWeights(db);
    assert.equal(weights.length, 1); assert.equal(weights[0].samples, 2); assert.equal(weights[0].averageClickDelta, 20);
    assert.equal(weights[0].weight, 1 + 20 / 30 * 2 / 5);
  } finally { await close(); }
});

test('weekly snapshot stores page/query rows replay-safely and T0 distinguishes zero from unknown', async () => {
  const { db, close } = await testDb();
  try {
    assert.deepEqual(lastFullWeek(new Date('2026-10-26T10:00:00Z')), { start: '2026-10-19', end: '2026-10-25' });
    assert.equal((await baselineFor(db, { url: action.url, targetQuery: action.targetQuery, now: '2026-10-26' })).clicks, null);
    const request = [];
    const gscFetch = async (r) => { request.push(r); return [{ keys: [action.url, action.targetQuery], clicks: 12, impressions: 100, ctr: 0.12, position: 9 }]; };
    for (let i = 0; i < 2; i++) await writeWeeklySnapshot(db, { now: '2026-10-26', gscFetch });
    assert.equal((await db.query('select count(*)::int as n from content.gsc_weekly_snapshot')).rows[0].n, 1);
    assert.equal(request[0].start, '2026-10-19'); assert.equal(request[0].end, '2026-10-25');
    assert.equal((await baselineFor(db, { url: action.url, targetQuery: action.targetQuery, now: '2026-10-26' })).clicks, 12);
    assert.equal((await baselineFor(db, { url: 'https://libertyvillage.co/blog/new', targetQuery: action.targetQuery, now: '2026-10-26' })).clicks, 0);
    await assert.rejects(writeWeeklySnapshot(db, { now: '2026-10-26', gscFetch: async () => { throw Error('offline'); } }));
    assert.equal((await db.query('select count(*)::int as n from content.gsc_weekly_snapshot')).rows[0].n, 1);
  } finally { await close(); }
});

test('published post hook records once and ledger failure cannot undo publication', async () => {
  const { db, close } = await testDb();
  try {
    const post = { ...seedRecords().posts[0], slug: 'ledger-publish' };
    const published = await publishDirect(db, { kind: 'blog', idempotencyKey: 'publish:ledger', items: [{ dataset: 'posts', key: post.slug, op: 'insert', payload: post }] });
    await recordPublishedPosts(db, published.submissionId);
    await recordPublishedPosts(db, published.submissionId);
    assert.equal((await listActions(db)).length, 1);
    const warnings = [];
    await recordPublishedPosts(db, published.submissionId, { recordAction: async () => { throw Error('secret database details'); }, warn: (s) => warnings.push(s) });
    assert.equal(warnings.length, 1); assert.doesNotMatch(warnings[0], /secret/);
    assert.equal((await db.query('select state from content.submissions where id=$1', [published.submissionId])).rows[0].state, 'published');
  } finally { await close(); }
});
