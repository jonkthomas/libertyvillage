import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { testDb } from './helpers/db.mjs';
import * as store from '../../scripts/content/store.mjs';
import { candidateDigest } from '../../scripts/content/canonical.mjs';
import { createHash } from 'node:crypto';
const base = JSON.parse(await readFile(new URL('../../data/businesses.json', import.meta.url)));
const business = (slug) => ({ ...base[0], slug, name: slug });
async function candidate(db, slug, idem = slug, expectedLiveRev = null) {
  return store.createSubmission(db, { kind: 'manual', target: 'test', actor: 'test', idempotencyKey: idem,
    items: [{ dataset: 'businesses', key: slug, payload: business(slug), expectedLiveRev }] });
}
async function gate(db, id, token, decision = 'go') {
  const vector = (await db.query('select * from content.round_items where submission_id=$1 and round=0', [id])).rows;
  await store.recordRound(db, id, token, { round: 0, candidateDigest: candidateDigest(vector), contentSha: 'a'.repeat(40), verdict: {}, overall: 8, passed: decision === 'go', blockingCount: 0, lint: {}, decision });
}
test('first publish, immutable trigger, replay, rollback and emptying guard', async () => {
  const { db, close } = await testDb();
  try {
    const x = await candidate(db, 'test-one');
    const { token } = await store.claimSubmission(db, x.submissionId, { owner: 'test' });
    await gate(db, x.submissionId, token);
    const result = await store.publishSubmission(db, x.submissionId, token, { actor: 'test' });
    assert.equal(result.liveSeq, 1);
    assert.equal((await store.publishSubmission(db, x.submissionId, token)).existing, true);
    assert.ok((await db.query("select published_at from content.revisions where key='test-one'")).rows[0].published_at);
    await assert.rejects(db.query("update content.revisions set published_at=now() where key='test-one'"), /revision-immutable/);
    await assert.rejects(db.query("update content.revisions set payload='{}'::json where key='test-one'"), /revision-immutable/);
    await assert.rejects(db.query("delete from content.revisions where key='test-one'"), /revision-immutable/);
    await assert.rejects(store.adminAction(db, { op:'unpublish', dataset:'businesses', key:'test-one', actor:'test', reason:'test', idempotencyKey:'unpub', owner:'test' }), /dataset-would-be-empty/);
    const y = await candidate(db, 'test-two');
    const claim = await store.claimSubmission(db, y.submissionId, { owner: 'test' });
    await gate(db, y.submissionId, claim.token);
    await store.publishSubmission(db, y.submissionId, claim.token);
    const admin = await store.adminAction(db, { op:'unpublish', dataset:'businesses', key:'test-one', actor:'test', reason:'test', idempotencyKey:'unpub', owner:'test' });
    assert.equal(admin.rev, null);
    const roll = await store.adminAction(db, { op:'rollback', dataset:'businesses', key:'test-one', toRev:1, actor:'test', reason:'test', idempotencyKey:'roll', owner:'test' });
    assert.equal(roll.rev, 2);
    assert.equal((await store.readLive(db)).datasets.businesses.count, 2);
  } finally { await close(); }
});
test('reordered JSON keys rejected even under publishing flag; lease loss', async () => {
  const { db, close } = await testDb();
  try {
    const x = await candidate(db, 'test-three');
    const claim = await store.claimSubmission(db, x.submissionId, { owner:'test' });
    const original = (await db.query("select payload from content.revisions where key='test-three'")).rows[0].payload;
    const reordered = Object.fromEntries(Object.entries(original).reverse());
    assert.notEqual(JSON.stringify(reordered), JSON.stringify(original));
    await assert.rejects(db.tx(async (c) => {
      await c.query("set local content.publishing='on'");
      await c.query("update content.revisions set published_at=now(),payload=$1::json where key='test-three'", [JSON.stringify(reordered)]);
    }), /revision-immutable/);
    await assert.rejects(db.query("update content.revisions set published_at=now() where key='test-three'"), /revision-immutable/);
    await db.query('update content.submissions set claimed_until=now()-interval \'1 second\' where id=$1', [x.submissionId]);
    await assert.rejects(gate(db, x.submissionId, claim.token), /lease-lost/);
  } finally { await close(); }
});
test('discovery outcome follows publish and terminal rejection', async () => {
  const { db, close } = await testDb();
  try {
    const submit = async (name) => store.createSubmission(db, { kind:'manual', target:'test', actor:'test', idempotencyKey:name,
      items:[{ dataset:'businesses', key:name, payload:business(name), expectedLiveRev:null }],
      discoverySeen:[{nameKey:name,firstSeen:'2026-09-27'}] });
    const good = await submit('seen-good');
    const goodToken = (await store.claimSubmission(db, good.submissionId, {owner:'test'})).token;
    await gate(db, good.submissionId, goodToken);
    await store.publishSubmission(db, good.submissionId, goodToken);
    const bad = await submit('seen-bad');
    const badToken = (await store.claimSubmission(db, bad.submissionId, {owner:'test'})).token;
    await gate(db, bad.submissionId, badToken, 'validation');
    const outcomes = (await db.query("select name_key,outcome,outcome_submission_id from content.discovery_seen order by name_key")).rows;
    assert.deepEqual(outcomes.map((r) => [r.name_key,r.outcome,Number(r.outcome_submission_id)]),
      [['seen-bad','rejected',bad.submissionId],['seen-good','added',good.submissionId]]);
  } finally { await close(); }
});
test('snapshot excludes assets referenced only by an unpublished candidate', async () => {
  const { db, close } = await testDb();
  try {
    const bytes = Buffer.from('candidate-only-image');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const path = `/media/${sha256.slice(0,16)}/candidate.webp`;
    const candidate = await store.createSubmission(db, { kind:'manual', target:'test', actor:'test', idempotencyKey:'candidate-image',
      items:[{ dataset:'businesses', key:'candidate-image', payload:{...business('candidate-image'),image:path}, expectedLiveRev:null }],
      assets:[{sha256,path,contentType:'image/webp',bytes}] });
    assert.equal((await store.readLive(db)).media.length, 0);
    const token = (await store.claimSubmission(db,candidate.submissionId,{owner:'test'})).token;
    await gate(db,candidate.submissionId,token);
    await store.publishSubmission(db,candidate.submissionId,token);
    assert.deepEqual((await store.readLive(db)).media,[{path,sha256,byte_size:bytes.length}]);
  } finally { await close(); }
});
test('new and idempotent submissions expose the current candidate vector', async () => {
  const { db, close } = await testDb();
  try {
    const input = { kind:'manual',target:'test',actor:'test',idempotencyKey:'vector-idem',
      items:[{dataset:'businesses',key:'vector-test',payload:business('vector-test'),expectedLiveRev:null}] };
    const first = await store.createSubmission(db,input);
    const shown = await store.getSubmission(db,first.submissionId);
    assert.equal(shown.rounds.length,1);
    assert.equal(shown.rounds[0].round,0);
    assert.equal(shown.rounds[0].items[0].rev,1);
    const second = await store.createSubmission(db,input);
    assert.equal(second.existing,true);
    assert.equal(second.items[0].rev,1);
    assert.equal(second.items[0].expectedLiveRev,null);
  } finally { await close(); }
});
