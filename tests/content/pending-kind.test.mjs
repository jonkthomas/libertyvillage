import test from 'node:test';
import assert from 'node:assert/strict';
import { testDb } from './helpers/db.mjs';
import { listPendingByKind } from '../../scripts/content/store.mjs';
import { runCli } from '../../scripts/content/cli.mjs';

const insert = async (db, kind, state, smoke = null, notified = null, target = db.target) => {
  const idempotencyKey = `pending-${kind}-${state}-${Math.random().toString(36).slice(2)}`;
  const result = await db.query(`insert into content.submissions
    (kind,target,actor,idempotency_key,request_sha256,state,smoke_passed_at,notified_at)
    values($1,$2,'test:pending',$3,$4,$5,$6,$7) returning id`,
    [kind, target, idempotencyKey, 'a'.repeat(64), state, smoke, notified]);
  return Number(result.rows[0].id);
};

test('news preflight lists only genuinely pending news for this target, not historical published rows', async () => {
  const { db, close } = await testDb();
  try {
    const pending = await insert(db, 'news', 'published');
    await insert(db, 'news', 'published', new Date(), new Date());
    await insert(db, 'blog', 'published');
    await insert(db, 'news', 'rejected');
    await insert(db, 'news', 'published', null, null, 'staging');
    await db.query(`insert into content.submissions
      (kind,target,actor,idempotency_key,request_sha256,state,smoke_passed_at,notified_at)
      select 'news',$1,'test:history','historical-'||n,$2,'published',now(),now()
      from generate_series(1,500) as n`, [db.target, 'b'.repeat(64)]);
    const query = db.query.bind(db);
    let reads = 0;
    db.query = (...args) => { reads += 1; return query(...args); };
    assert.deepEqual(await listPendingByKind(db, { target: db.target, kind: 'news' }), [pending]);
    assert.equal(reads, 1, 'preflight should execute one bounded pending-id query, never show history');
    db.query = query;
    const { result, exitCode } = await runCli(['pending', '--kind', 'news', '--target', db.target]);
    assert.equal(exitCode, 0);
    assert.deepEqual(result, [pending]);
    await assert.rejects(listPendingByKind(db, { target: db.target, kind: 'manual' }), /pending kind required/);
  } finally { await close(); }
});
