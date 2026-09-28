import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { testDb } from './helpers/db.mjs';
import * as store from '../../scripts/content/store.mjs';
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
    const next = await ready(db,make('shared-key',1));
    await store.publishSubmission(db,next.id,next.token);
    await assert.rejects(store.compensateSubmission(db,first.id,first.token,{actor:'test',reason:'test'}), (e) => e.code === 'ConflictError');
    assert.equal((await db.query("select live_rev from content.entries where key='shared-key'")).rows[0].live_rev, 2);
    await assert.rejects(store.createSubmission(db,make('shared-key',1)), (e) => e.code === 'ConflictError');
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
