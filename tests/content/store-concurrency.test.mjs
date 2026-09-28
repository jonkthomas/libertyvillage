import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { testDb } from './helpers/db.mjs';
import * as store from '../../scripts/content/store.mjs';
import { deployContent } from '../../scripts/content/deploy.mjs';
import { candidateDigest } from '../../scripts/content/canonical.mjs';
const template = JSON.parse(await readFile(new URL('../../data/businesses.json', import.meta.url)))[0];
let serial = 0;
const make = (slug, expectedLiveRev = null) => ({ kind: 'manual', target:'test', actor:'test', idempotencyKey:`test-${++serial}`, items:[{ dataset:'businesses', key:slug, payload:{...template,slug,name:slug}, expectedLiveRev }] });
async function ready(db, input) {
  const created = await store.createSubmission(db, input);
  const token = (await store.claimSubmission(db, created.submissionId, { owner:'test' })).token;
  const vector = (await db.query('select * from content.round_items where submission_id=$1 and round=0', [created.submissionId])).rows;
  await store.recordRound(db, created.submissionId, token, { round:0, candidateDigest:candidateDigest(vector), contentSha:'b'.repeat(40), verdict:{}, overall:8, passed:true, blockingCount:0, lint:{}, decision:'go' });
  return { id:created.submissionId, token };
}
test('two connections publish once; parallel new entries get distinct positions', async () => {
  const { db, close } = await testDb();
  try {
    const x = await ready(db, make('race-one'));
    const results = await Promise.all([store.publishSubmission(db,x.id,x.token),store.publishSubmission(db,x.id,x.token)]);
    assert.deepEqual(results.map((r) => r.existing).sort(), [false,true]);
    const [a,b] = await Promise.all([ready(db,make('race-two')),ready(db,make('race-three'))]);
    await Promise.all([store.publishSubmission(db,a.id,a.token),store.publishSubmission(db,b.id,b.token)]);
    const positions = (await db.query("select position from content.entries where dataset='businesses' and live_rev is not null")).rows.map((r) => r.position);
    assert.equal(new Set(positions).size, 3);
  } finally { await close(); }
});
test('stale base conflicts and later publish prevents compensation', async () => {
  const { db, close } = await testDb();
  try {
    const first = await ready(db,make('shared-key'));
    await store.publishSubmission(db,first.id,first.token);
    const oldExport = await store.readLive(db);
    const next = await ready(db,make('shared-key',1));
    await store.publishSubmission(db,next.id,next.token);
    await assert.rejects(store.compensateSubmission(db,first.id,first.token,{actor:'test',reason:'test'}), (e) => e.code === 'ConflictError');
    assert.equal((await db.query("select live_rev from content.entries where key='shared-key'")).rows[0].live_rev, 2);
    await assert.rejects(store.createSubmission(db,make('shared-key',oldExport.datasets.businesses.entries['shared-key'].rev)), (e) => e.code === 'ConflictError');
    const unaffected = await ready(db,make('other-key'));
    await store.publishSubmission(db,unaffected.id,unaffected.token);
    assert.equal((await db.query("select live_rev from content.entries where key='shared-key'")).rows[0].live_rev, 2);
  } finally { await close(); }
});
test('repair round invalidates reviewed vector', async () => {
  const { db, close } = await testDb();
  try {
    const created = await store.createSubmission(db,make('repair-key'));
    const token = (await store.claimSubmission(db,created.submissionId,{owner:'test'})).token;
    const vector = (await db.query('select * from content.round_items where submission_id=$1',[created.submissionId])).rows;
    await store.recordRound(db,created.submissionId,token,{round:0,candidateDigest:candidateDigest(vector),contentSha:'c'.repeat(40),verdict:{},overall:6,passed:false,blockingCount:1,lint:{},decision:'repair'});
    await store.addRepairRound(db,created.submissionId,token,{fromRound:0,repairs:[{dataset:'businesses',key:'repair-key',payload:{...template,slug:'repair-key',name:'fixed'}}]});
    await assert.rejects(store.publishSubmission(db,created.submissionId,token), (e) => e.code === 'StateError');
  } finally { await close(); }
});

test('admin replay cannot share an active lease and can claim after release', async () => {
  const { db, close } = await testDb();
  try {
    const published = await ready(db, make('admin-lease'));
    await store.publishSubmission(db, published.id, published.token);
    const opts = { op: 'rollback', dataset: 'businesses', key: 'admin-lease', toRev: 1,
      actor: 'test', owner: 'test', reason: 'retry', idempotencyKey: 'admin-lease-retry' };
    const first = await store.adminAction(db, opts);
    const replay = await store.adminAction(db, opts);
    assert.equal(replay.existing, true);
    assert.equal(replay.submissionId, first.submissionId);
    assert.equal(replay.token, null);
    assert.deepEqual(await deployContent(db, { submission: replay.submissionId, token: replay.token, actor: 'test' }),
      { result: { smoke: 'claimed' }, exitCode: 1 });
    await store.renewClaim(db, first.submissionId, first.token);
    await store.releaseClaim(db, first.submissionId, first.token);
    const next = await store.claimSubmission(db, replay.submissionId, { owner: 'replay' });
    assert.notEqual(next.token, first.token);
    await store.releaseClaim(db, replay.submissionId, next.token);
  } finally { await close(); }
});

test('concurrent admin requests reserve one idempotency key before dataset mutation', async () => {
  const { db, close } = await testDb();
  try {
    const published = await ready(db, make('admin-race'));
    await store.publishSubmission(db, published.id, published.token);
    let releaseDataset;
    let locked;
    const datasetLocked = new Promise((resolve) => { locked = resolve; });
    const hold = db.tx(async (client) => {
      await client.query("select pg_advisory_xact_lock(hashtext('content:' || $1))", ['businesses']);
      locked();
      await new Promise((resolve) => { releaseDataset = resolve; });
    });
    await datasetLocked;
    const opts = { op: 'rollback', dataset: 'businesses', key: 'admin-race', toRev: 1,
      actor: 'test', owner: 'test', reason: 'same', idempotencyKey: 'admin-race-key' };
    let reads = 0;
    const wrapper = { ...db, tx: (fn) => db.tx((client) => fn({
      query: async (sql, params) => {
        const result = await client.query(sql, params);
        if (sql === 'select * from content.submissions where idempotency_key=$1') reads += 1;
        return result;
      },
    })) };
    const requests = [store.adminAction(wrapper, opts), store.adminAction(wrapper, opts)];
    try {
      for (let attempt = 0; attempt < 40 && reads < 2; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    } finally { releaseDataset(); await hold; }
    const results = await Promise.all(requests);
    assert.deepEqual(results.map((result) => result.existing).sort(), [false, true]);
    assert.equal(results[0].submissionId, results[1].submissionId);
    assert.equal((await db.query("select count(*)::int as count from content.submissions where idempotency_key='admin-race-key'")).rows[0].count, 1);
  } finally { await close(); }
});
