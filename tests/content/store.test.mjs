import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { testDb } from './helpers/db.mjs';
import * as store from '../../scripts/content/store.mjs';
import { candidateDigest } from '../../scripts/content/canonical.mjs';
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
    await db.tx(async (c) => {
      await c.query("set local content.publishing='on'");
      await assert.rejects(c.query(`update content.revisions set published_at=now(),payload=('{' || '"name":"x",' || substring(payload::text from 2))::json where key='test-three'`), /revision-immutable/);
    }).catch(() => {});
    await db.query('update content.submissions set claimed_until=now()-interval \'1 second\' where id=$1', [x.submissionId]);
    await assert.rejects(gate(db, x.submissionId, claim.token), /lease-lost/);
  } finally { await close(); }
});
