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
    // Model the earlier candidate's table before replaying the additive column migration.
    await db.query('alter table content.content_action_ledger drop column if exists action_type');
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

test('optional action types default by kind, validate the vocabulary and keep learning groups separate', async () => {
  const { db, close } = await testDb();
  try {
    const fresh = await recordAction(db, action);
    const refresh = await recordAction(db, { ...action, actionKind: 'refresh', slug: 'full-refresh' });
    const snippetInput = { ...action, actionKind: 'refresh', actionType: 'snippet', slug: 'snippet' };
    const snippet = await recordAction(db, snippetInput);
    assert.deepEqual(await recordAction(db, { ...snippetInput, actionType: 'refresh' }), snippet);
    for (const actionType of ['merge', 'new', 'link']) await recordAction(db, { ...action, slug: actionType, actionType });
    await assert.rejects(recordAction(db, { ...action, slug: 'invalid', actionType: 'invalid' }), /check constraint/);
    await db.query('update content.content_action_ledger set outcome_2w=$2 where id=$1', [fresh.id, { clicks: 20 }]);
    // Earlier candidate rows have no subtype: readers/grouping must infer refresh.
    await db.query('update content.content_action_ledger set action_type=null,outcome_2w=$2 where id=$1', [refresh.id, { clicks: 5 }]);
    await db.query('update content.content_action_ledger set outcome_2w=$2 where id=$1', [snippet.id, { clicks: 30 }]);
    const actions = new Map((await listActions(db)).map((row) => [row.slug, row]));
    assert.equal(actions.get(action.slug).action_type, 'new');
    assert.equal(actions.get('full-refresh').action_type, 'refresh');
    assert.equal(actions.get('snippet').action_type, 'snippet', 'replay preserves original subtype');
    const weights = await actionWeights(db);
    assert.equal(weights.length, 3);
    assert.equal(weights.find((row) => row.actionType === 'snippet').averageClickDelta, 20);
    assert.equal(weights.find((row) => row.actionType === 'refresh').averageClickDelta, -5);
    assert.equal(weights.find((row) => row.actionKind === 'new_post').actionType, 'new');
  } finally { await close(); }
});

test('fillOutcomes waits until window end plus three days for 2w/4w and never refetches filled observations', async () => {
  const { db, close } = await testDb();
  try {
    await recordAction(db, action);
    const calls = [];
    const gscFetch = async (request) => { calls.push(request); return [{ clicks: 30, impressions: 200, ctr: 0.15, position: 8 }]; };
    assert.deepEqual(await fillOutcomes(db, { now: '2026-10-15T11:59:59Z', gscFetch }), { filled: 0 });
    assert.deepEqual(await fillOutcomes(db, { now: '2026-10-15T12:00:00Z', gscFetch }), { filled: 0 });
    assert.deepEqual(await fillOutcomes(db, { now: '2026-10-16T23:59:59.999Z', gscFetch }), { filled: 0 });
    assert.equal(calls.length, 0, 'do not query GSC before the end-date lag expires');
    assert.deepEqual(await fillOutcomes(db, { now: '2026-10-17T00:00:00Z', gscFetch }), { filled: 1 });
    let row = (await listActions(db))[0];
    assert.equal(row.outcome_2w.clicks, 30); assert.equal(row.outcome_4w, null);
    assert.deepEqual(calls[0], { start: '2026-10-08', end: '2026-10-14', dimensions: [], page: action.url, query: action.targetQuery });
    await fillOutcomes(db, { now: '2026-10-28T12:00:00Z', gscFetch }); assert.equal(calls.length, 1);
    await fillOutcomes(db, { now: '2026-10-29T12:00:00Z', gscFetch }); assert.equal(calls.length, 1);
    await fillOutcomes(db, { now: '2026-10-30T23:59:59.999Z', gscFetch }); assert.equal(calls.length, 1);
    await fillOutcomes(db, { now: '2026-10-31T00:00:00Z', gscFetch }); assert.equal(calls.length, 2);
    await fillOutcomes(db, { now: '2026-11-10T12:00:00Z', gscFetch }); assert.equal(calls.length, 2);
    row = (await listActions(db))[0]; assert.equal(row.outcome_4w.clicks, 30);
  } finally { await close(); }
});

test('empty GSC outcomes stay pending and out of learning until an explicit metric row arrives', async () => {
  const { db, close } = await testDb();
  try {
    await recordAction(db, action);
    let available = false;
    const gscFetch = async () => available ? [{ clicks: 0, impressions: 10, ctr: 0, position: 20 }] : [];
    assert.deepEqual(await fillOutcomes(db, { now: '2026-11-10', gscFetch }), { filled: 0 });
    const pending = (await listActions(db))[0];
    assert.equal(pending.outcome_2w, null); assert.equal(pending.outcome_4w, null);
    assert.deepEqual(await actionWeights(db), [], 'empty responses cannot teach a false negative click delta');
    available = true;
    assert.deepEqual(await fillOutcomes(db, { now: '2026-11-10', gscFetch }), { filled: 2 });
    const measured = (await listActions(db))[0];
    assert.equal(measured.outcome_2w.clicks, 0); assert.equal(measured.outcome_4w.clicks, 0);
    assert.equal((await actionWeights(db))[0].averageClickDelta, -10, 'an explicit zero-click observation is a valid outcome');
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
    assert.deepEqual(lastFullWeek(new Date('2026-10-26T10:00:00Z')), { start: '2026-10-12', end: '2026-10-18' });
    assert.equal((await baselineFor(db, { url: action.url, targetQuery: action.targetQuery, now: '2026-10-26' })).clicks, null);
    const request = [];
    const gscFetch = async (r) => { request.push(r); return [{ keys: [action.url, action.targetQuery], clicks: 12, impressions: 100, ctr: 0.12, position: 9 }]; };
    for (let i = 0; i < 2; i++) await writeWeeklySnapshot(db, { now: '2026-10-26', gscFetch });
    assert.equal((await db.query('select count(*)::int as n from content.gsc_weekly_snapshot')).rows[0].n, 1);
    assert.equal(request[0].start, '2026-10-12'); assert.equal(request[0].end, '2026-10-18');
    assert.deepEqual(lastFullWeek(new Date('2026-10-27T23:59:59.999Z')), { start: '2026-10-12', end: '2026-10-18' });
    assert.deepEqual(lastFullWeek(new Date('2026-10-28T00:00:00Z')), { start: '2026-10-19', end: '2026-10-25' });
    assert.equal((await baselineFor(db, { url: action.url, targetQuery: action.targetQuery, now: '2026-10-26' })).clicks, 12);
    assert.equal((await baselineFor(db, { url: action.url, targetQuery: action.targetQuery, now: '2026-10-28' })).clicks, 12,
      'Monday finalized snapshot remains a valid T0 for the Wednesday publish');
    assert.equal((await baselineFor(db, { url: action.url, targetQuery: action.targetQuery, now: '2026-11-02' })).clicks, null,
      'a snapshot whose end is over two weeks old remains stale');
    assert.equal((await baselineFor(db, { url: 'https://libertyvillage.co/blog/new', targetQuery: action.targetQuery, now: '2026-10-26' })).clicks, 0);
    await assert.rejects(writeWeeklySnapshot(db, { now: '2026-10-26', gscFetch: async () => { throw Error('offline'); } }));
    assert.equal((await db.query('select count(*)::int as n from content.gsc_weekly_snapshot')).rows[0].n, 1);
  } finally { await close(); }
});

test('empty weekly fetch retains the prior snapshot and can be retried when data arrives', async () => {
  const { db, close } = await testDb();
  try {
    const now = '2026-10-26T10:00:00Z';
    const data = [{ keys: [action.url, action.targetQuery], clicks: 12, impressions: 100, ctr: 0.12, position: 9 }];
    await writeWeeklySnapshot(db, { now, gscFetch: async () => data });
    await writeWeeklySnapshot(db, { now, gscFetch: async () => [] });
    assert.equal((await baselineFor(db, { url: action.url, targetQuery: action.targetQuery, now })).clicks, 12,
      'empty response must not delete the available baseline');
    await writeWeeklySnapshot(db, { now, gscFetch: async () => [{ ...data[0], clicks: 15 }] });
    assert.equal((await baselineFor(db, { url: action.url, targetQuery: action.targetQuery, now })).clicks, 15);
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
