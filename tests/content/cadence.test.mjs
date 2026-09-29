import assert from 'node:assert/strict';
import test from 'node:test';
import { testDb } from './helpers/db.mjs';
import { runCli } from '../../scripts/content/cli.mjs';
import * as cadence from '../../scripts/content/cadence.mjs';
import { ALL } from '../../scripts/content/canonical.mjs';

const week = '2026-09-28';
const ref = (slotNumber = 1, lane = 'content') => ({ target: 'test', weekStart: week, lane, slotNumber });

async function fixture(db, { slug, kind = 'blog', category = 'guides', smoke = 'passed', op = 'insert',
  overall = 8.5, passed = true, blockers = 0, time = '2026-09-30T12:00:00Z', live = true } = {}) {
  const id = Number((await db.query(`insert into content.submissions(kind,target,actor,idempotency_key,request_sha256,state,smoke_passed_at)
    values($1,'test','fixture',$2,'sha','published',$3) returning id`, [kind, `fixture:${slug}:${Math.random()}`, time])).rows[0].id);
  await db.query('insert into content.entries(dataset,key,position,head_rev) values(\'posts\',$1,$2,1) on conflict(dataset,key) do nothing', [slug, id]);
  await db.query(`insert into content.revisions(dataset,key,rev,payload,payload_sha256,source,actor,submission_id)
    values('posts',$1,1,$2::json,$3,'writer','fixture',$4) on conflict do nothing`, [slug, JSON.stringify({ category }), 'a'.repeat(64), id]);
  if (live) await db.query("update content.entries set live_rev=1 where dataset='posts' and key=$1", [slug]);
  await db.query(`insert into content.submission_items(submission_id,dataset,key,op,published_rev,smoke)
    values($1,'posts',$2,$3,1,$4)`, [id, slug, op, smoke]);
  await db.query(`insert into content.gate_rounds(submission_id,round,candidate_digest,content_sha,overall,passed,blocking_count,decision)
    values($1,1,'digest',$2,$3,$4,$5,'go')`, [id, 'a'.repeat(40), overall, passed, blockers]);
  return id;
}
const observe = async () => ({ rev: 1, snapshotId: 'hosted-snapshot' });
const aliasManifest = (entries = {}) => ({ schema: 1, snapshot_id: 'a'.repeat(40),
  deployment_url: 'https://example.test/deployment', datasets: { posts: { entries } },
  files: Object.fromEntries(ALL.map((dataset) => [`${dataset}.json`, 'c'.repeat(64)])), media: [] });
const fetched = (manifest, status = 200) => async () => new Response(JSON.stringify(manifest), { status,
  headers: { 'content-type': 'application/json' } });

test('alias observer fetches once, matches revision and fails closed on invalid or unavailable manifest', async () => {
  const slug = 'first-guide';
  let calls = 0;
  const fetchImpl = async (url, init) => {
    calls++;
    assert.equal(url, 'https://example.test/content-snapshot/manifest.json');
    assert.equal(init.headers['x-vercel-protection-bypass'], 'bypass');
    return fetched(aliasManifest({ [slug]: { rev: 1, sha: 'b'.repeat(64) } }))();
  };
  const alias = await cadence.createAliasObserver({ siteUrl: 'https://example.test', bypass: 'bypass', fetchImpl });
  assert.deepEqual(await alias(slug), { rev: 1, snapshotId: 'a'.repeat(40) });
  assert.equal(await alias('missing'), null);
  assert.equal(calls, 1);
  const { db, close } = await testDb();
  try {
    await fixture(db, { slug });
    const count = await cadence.countCurrentWeek(db, { target: 'test', weekStart: week, observe: alias });
    assert.equal(count.contentCount, 1);
    const stale = await cadence.createAliasObserver({ siteUrl: 'https://example.test', fetchImpl: fetched(aliasManifest({ [slug]: { rev: 2, sha: 'b'.repeat(64) } })) });
    assert.equal((await cadence.countCurrentWeek(db, { target: 'test', weekStart: week, observe: stale })).contentCount, 0);
    const missing = await cadence.createAliasObserver({ siteUrl: 'https://example.test', fetchImpl: fetched(aliasManifest()) });
    assert.equal((await cadence.countCurrentWeek(db, { target: 'test', weekStart: week, observe: missing })).contentCount, 0);
  } finally { await close(); }
  await assert.rejects(cadence.createAliasObserver({ siteUrl: 'https://example.test', fetchImpl: fetched({}, 500) }), /unavailable/);
  await assert.rejects(cadence.createAliasObserver({ siteUrl: 'https://example.test', fetchImpl: fetched({}) }), /invalid/);
  await assert.rejects(cadence.createAliasObserver({ siteUrl: 'https://example.test', fetchImpl: async () => new Response('{bad json', { status: 200 }) }), /invalid/);
  await assert.rejects(cadence.createAliasObserver({ siteUrl: 'https://example.test', fetchImpl: async () => { throw new Error('network down'); } }), /unavailable/);
  await assert.rejects(cadence.createAliasObserver({ fetchImpl: fetched(aliasManifest()) }), /CONTENT_SITE_URL/);
});

test('migration accepts roundup, ISO slug handles year boundary, immutable keys hold', async () => {
  const { db, close } = await testDb();
  try {
    assert.equal(cadence.weekStartUtc('2026-12-31'), '2026-12-28');
    assert.deepEqual(cadence.isoWeek('2026-12-31'), { year: 2026, week: 53 });
    assert.equal(cadence.roundupSlug('2026-09-28'), 'liberty-village-news-week-2026-w40');
    assert.equal(cadence.roundupSlug('2027-01-04'), 'liberty-village-news-week-2027-w01');
    await db.query("insert into content.submissions(kind,target,actor,idempotency_key,request_sha256,state) values('roundup','test','fixture','roundup-kind','sha','open')");
    await db.query("insert into content.entries(dataset,key) values('posts',$1)", [cadence.roundupSlug(week)]);
    const claim = await cadence.reserveSlot(db, { ...ref(2, 'roundup'), owner: 'one' });
    assert.equal(claim.reserved, true);
    assert.equal(claim.slot.week_start_utc, week);
    await assert.rejects(db.query("update content.cadence_slots set roundup_slug='changed' where target='test'"), /cadence-immutable/);
    await assert.rejects(db.query("delete from content.cadence_slots where target='test'"), /cadence-immutable/);
  } finally { await close(); }
});

test('concurrent roundup converges, expired claim fences stale token, attempts replay and advance', async () => {
  const { db, close } = await testDb();
  try {
    const claims = await Promise.all(Array.from({ length: 8 }, (_, i) => cadence.reserveSlot(db, { ...ref(i + 1, 'roundup'), owner: `worker-${i}` })));
    assert.equal(claims.filter((item) => item.reserved).length, 1);
    assert.equal(Number((await db.query("select count(*) as n from content.cadence_slots where lane='roundup'")).rows[0].n), 1);
    const winner = claims.find((item) => item.reserved);
    const slotRef = { ...ref(winner.slot.slot_number, 'roundup') };
    const first = await cadence.recordAttempt(db, { slotRef, token: winner.token, intentFingerprint: 'one', topicKey: 'one', sourcePackDigest: 'pack' });
    const replay = await cadence.recordAttempt(db, { slotRef, token: winner.token, intentFingerprint: 'other', topicKey: 'other', sourcePackDigest: 'pack' });
    assert.equal(replay.idempotencyKey, first.idempotencyKey);
    assert.equal(replay.existing, true);
    await cadence.recordAttemptOutcome(db, { idempotencyKey: first.idempotencyKey, token: winner.token, outcome: 'rejected' });
    assert.equal((await db.query('select week_start_utc::text as week from content.cadence_attempts where idempotency_key=$1', [first.idempotencyKey])).rows[0].week, week);
    await assert.rejects(cadence.recordAttempt(db, { slotRef, token: winner.token, intentFingerprint: 'one', topicKey: 'one', sourcePackDigest: 'pack' }), /already attempted/);
    const second = await cadence.recordAttempt(db, { slotRef, token: winner.token, intentFingerprint: 'two', topicKey: 'two', sourcePackDigest: 'pack' });
    assert.equal(second.ordinal, 2);
    await cadence.recordAttemptOutcome(db, { idempotencyKey: second.idempotencyKey, token: winner.token, outcome: 'published' });
    assert.equal((await cadence.recordAttempt(db, { slotRef, token: winner.token, intentFingerprint: 'three', topicKey: 'three', sourcePackDigest: 'pack' })).idempotencyKey, second.idempotencyKey);
    await db.query("update content.cadence_slots set claimed_until=now()-interval '1 second' where lane='roundup'");
    const reclaimed = await cadence.reserveSlot(db, { ...ref(99, 'roundup'), owner: 'next' });
    assert.equal(reclaimed.slot.slot_number, winner.slot.slot_number);
    await assert.rejects(cadence.renewSlot(db, slotRef, winner.token), (error) => error.code === 'ClaimError');
    await assert.rejects(cadence.recordAttempt(db, { slotRef, token: winner.token, intentFingerprint: 'bad', topicKey: 'bad', sourcePackDigest: 'pack' }), (error) => error.code === 'ClaimError');
    await db.query(`insert into content.cadence_slots(target,week_start_utc,lane,slot_number)
      values('staging',$1,'content',1)`, [week]);
    assert.equal((await db.query("select count(*) as n from content.cadence_slots where target='test' and lane='content'")).rows[0].n, '0');
  } finally { await close(); }
});

test('current-week count requires live revision, final passing gate and hosted observation', async () => {
  const { db, close } = await testDb();
  try {
    assert.equal((await cadence.countCurrentWeek(db, { target: 'test', weekStart: week, observe })).met, false);
    await fixture(db, { slug: 'first-guide' });
    await fixture(db, { slug: 'second-guide' });
    await fixture(db, { slug: cadence.roundupSlug(week), kind: 'roundup', category: 'news' });
    const green = await cadence.countCurrentWeek(db, { target: 'test', weekStart: week, observe });
    assert.deepEqual([green.contentCount, green.roundupCount, green.met], [2, 1, true]);
    const withoutObserver = await cadence.countCurrentWeek(db, { target: 'test', weekStart: week });
    assert.equal(withoutObserver.met, false);
    assert.equal(withoutObserver.observer, 'unavailable');
    assert.deepEqual([withoutObserver.dbOnly.contentCount, withoutObserver.dbOnly.roundupCount], [2, 1]);
    assert.equal((await cadence.countCurrentWeek(db, { target: 'test', weekStart: week, observe: async () => ({ rev: 2, snapshotId: 'other' }) })).met, false);
    await db.query("update content.submission_items set smoke='superseded' where key='first-guide'");
    assert.equal((await cadence.countCurrentWeek(db, { target: 'test', weekStart: week, observe })).met, false);
    await db.query("update content.submission_items set smoke='passed' where key='first-guide'");
    await db.query("update content.entries set live_rev=null where key='first-guide'");
    assert.equal((await cadence.countCurrentWeek(db, { target: 'test', weekStart: week, observe })).contentCount, 1);
    await fixture(db, { slug: 'low-score', overall: 7.99 });
    await fixture(db, { slug: 'blocker', blockers: 1 });
    await fixture(db, { slug: 'news-blog', category: 'news' });
    await fixture(db, { slug: 'updated', op: 'update' });
    await fixture(db, { slug: 'daily-news', kind: 'news', category: 'news' });
    await fixture(db, { slug: 'late-smoke', time: '2026-10-05T00:00:00Z' });
    await fixture(db, { slug: 'null-smoke', smoke: null });
    await fixture(db, { slug: 'final-failed' });
    const finalId = (await db.query("select submission_id from content.submission_items where key='final-failed'")).rows[0].submission_id;
    await db.query(`insert into content.gate_rounds(submission_id,round,candidate_digest,content_sha,overall,passed,blocking_count,decision)
      values($1,2,'digest',$2,8.5,false,0,'block')`, [finalId, 'a'.repeat(40)]);
    const red = await cadence.countCurrentWeek(db, { target: 'test', weekStart: week, observe });
    assert.deepEqual([red.contentCount, red.roundupCount, red.met], [1, 1, false]);
    assert.equal(red.dbOnly.contentCount, 1);
    await db.query("update content.entries set live_rev=1 where key='first-guide'");
    const again = await cadence.countCurrentWeek(db, { target: 'test', weekStart: week, observe });
    assert.equal(again.contentCount, 2);
    await fixture(db, { slug: 'first-guide' });
    assert.equal((await cadence.countCurrentWeek(db, { target: 'test', weekStart: week, observe })).contentCount, 2, 'same slug counts once');
  } finally { await close(); }
});

test('deadline requires an observer and propagates observation failure without alert intent', async () => {
  const { db, close } = await testDb();
  try {
    await fixture(db, { slug: 'observer-probe' });
    const input = { target: 'test', weekStart: week, now: '2026-10-05T00:00:00Z' };
    await assert.rejects(cadence.evaluateDeadline(db, input), (error) => error.code === 'StateError' && error.message === 'observer required');
    await assert.rejects(cadence.evaluateDeadline(db, { ...input, observe: null }), (error) => error.code === 'StateError' && error.message === 'observer required');
    await assert.rejects(cadence.evaluateDeadline(db, { ...input, observe: async () => { throw new Error('alias failed'); } }), /alias failed/);
    assert.equal((await db.query('select count(*)::int as n from content.cadence_alerts')).rows[0].n, 0);
  } finally { await close(); }
});

test('consumption requires smoke plus a current-live observation', async () => {
  const { db, close } = await testDb();
  try {
    const claim = await cadence.reserveSlot(db, { ...ref(), owner: 'owner' });
    const slotRef = ref();
    const recorded = await cadence.recordAttempt(db, { slotRef, token: claim.token,
      intentFingerprint: 'guide-intent', topicKey: 'guide', sourcePackDigest: 'digest' });
    const id = Number((await db.query(`insert into content.submissions(kind,target,actor,idempotency_key,request_sha256,state)
      values('blog','test','fixture',$1,'sha','open') returning id`, [recorded.idempotencyKey])).rows[0].id);
    await cadence.attachSubmission(db, { idempotencyKey: recorded.idempotencyKey, token: claim.token, submissionId: id });
    await cadence.recordAttemptOutcome(db, { idempotencyKey: recorded.idempotencyKey, token: claim.token, outcome: 'published' });
    await assert.rejects(cadence.recordAttemptOutcome(db, { idempotencyKey: recorded.idempotencyKey, token: claim.token, outcome: 'consumed', observe }), /requires smoke/);
    await cadence.recordAttemptOutcome(db, { idempotencyKey: recorded.idempotencyKey, token: claim.token, outcome: 'smoked' });
    await assert.rejects(cadence.recordAttemptOutcome(db, { idempotencyKey: recorded.idempotencyKey, token: claim.token, outcome: 'consumed', observe }), /not current-live/);
    assert.deepEqual(await cadence.consumedFingerprints(db, { target: 'test' }), ['guide-intent']);
  } finally { await close(); }
});

test('deadline alert intent dedupes and delivery retries the same key', async () => {
  const { db, close } = await testDb();
  try {
    await fixture(db, { slug: 'only-guide' });
    assert.equal((await cadence.evaluateDeadline(db, { target: 'test', weekStart: week, now: '2026-10-04T23:59:59Z', observe })).due, false);
    const first = await cadence.evaluateDeadline(db, { target: 'test', weekStart: week, now: '2026-10-05T00:00:00Z', observe });
    assert.equal(first.alerts.length, 2);
    assert.ok(first.alerts.every((item) => item.created));
    assert.ok((await cadence.evaluateDeadline(db, { target: 'test', weekStart: week, now: '2026-10-05T00:00:01Z', observe })).alerts.every((item) => !item.created));
    const keys = [];
    const bad = () => { throw new Error('secret raw evidence'); };
    await cadence.deliverPendingAlerts(db, { target: 'test', send: bad, maxAttempts: 2 });
    await cadence.deliverPendingAlerts(db, { target: 'test', send: bad, maxAttempts: 2 });
    const capped = await cadence.deliverPendingAlerts(db, { target: 'test', send: () => { throw new Error('unexpected'); }, maxAttempts: 2 });
    assert.equal(capped.pending, 0);
    const rows = (await db.query('select * from content.cadence_alerts')).rows;
    assert.ok(rows.every((item) => item.delivery_attempts === 2 && item.delivered_at === null && !item.last_error.includes('secret')));
    await cadence.deliverPendingAlerts(db, { target: 'test', maxAttempts: 3, send: (payload) => {
      keys.push(payload.notificationKey);
      assert.equal(payload.weekStart, week);
      assert.equal(JSON.stringify(payload).includes('evidence'), false);
    } });
    assert.equal(new Set(keys).size, 2);
    assert.ok((await db.query('select delivered_at from content.cadence_alerts')).rows.every((item) => item.delivered_at));
  } finally { await close(); }
});

test('CLI count and reserve require bound test DB', async () => {
  const { db, name, close } = await testDb();
  const priorSiteUrl = process.env.CONTENT_SITE_URL;
  try {
    process.env.CONTENT_SITE_URL = 'https://example.test';
    assert.equal((await runCli(['cadence', 'count', '--week-start', week, '--expect-db', name],
      { delegates: { fetchImpl: fetched(aliasManifest()) } })).result.contentCount, 0);
    await assert.rejects(runCli(['cadence', 'deadline', '--week-start', week, '--now', '2026-10-05T00:00:00Z', '--expect-db', name],
      { delegates: { fetchImpl: fetched({}, 500) } }), /unavailable/);
    assert.equal((await db.query('select count(*)::int as n from content.cadence_alerts')).rows[0].n, 0);
    await assert.rejects(runCli(['cadence', 'count', '--week-start', week, '--observations', 'scratch.json', '--expect-db', name],
      { delegates: { fetchImpl: fetched(aliasManifest()) } }), /hosted alias/);
    await assert.rejects(runCli(['cadence', 'reserve', '--week-start', week, '--lane', 'content', '--slot-number', '1', '--owner', 'cli']), /expect-db/);
    const reserved = await runCli(['cadence', 'reserve', '--week-start', week, '--lane', 'content', '--slot-number', '1', '--owner', 'cli', '--expect-db', name]);
    assert.equal(reserved.result.reserved, true);
    assert.equal(reserved.result.slot.week_start_utc, week);
    assert.equal((await cadence.renewSlot(db, ref(), reserved.result.token)).week_start_utc, week);
    await cadence.recordAttempt(db, { slotRef: ref(), token: reserved.result.token,
      intentFingerprint: 'status-intent', topicKey: 'status-topic', sourcePackDigest: 'digest' });
    await cadence.recordMissedAlert(db, { target: 'test', weekStart: week, alertKind: 'WEEKLY_NEWS_MISSED',
      counts: { content: 0, roundup: 0 }, failureClass: 'test' });
    const status = await runCli(['cadence', 'status', '--week-start', week, '--expect-db', name]);
    assert.equal(status.result.slots[0].week_start_utc, week);
    assert.equal(status.result.attempts[0].week_start_utc, week);
    assert.equal(status.result.alerts[0].week_start_utc, week);
  } finally { process.env.CONTENT_SITE_URL = priorSiteUrl; await close(); }
});
