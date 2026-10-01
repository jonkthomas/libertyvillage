import test from 'node:test';
import assert from 'node:assert/strict';
import { testDb } from './helpers/db.mjs';
import { listPendingByKind, PENDING_BY_KIND_SQL, PENDING_NEWS_BACKLOG_CAP, PENDING_NEWS_PAGE, StateError } from '../../scripts/content/store.mjs';
import { runCli } from '../../scripts/content/cli.mjs';

const insert = async (db, kind, state, smoke = null, notified = null, target = db.target) => {
  const idempotencyKey = `pending-${kind}-${state}-${Math.random().toString(36).slice(2)}`;
  const result = await db.query(`insert into content.submissions
    (kind,target,actor,idempotency_key,request_sha256,state,smoke_passed_at,notified_at)
    values($1,$2,'test:pending',$3,$4,$5,$6,$7) returning id`,
    [kind, target, idempotencyKey, 'a'.repeat(64), state, smoke, notified]);
  return Number(result.rows[0].id);
};

const bulk = async (db, { prefix, count, state, smoke, notified }) => {
  const result = await db.query(`insert into content.submissions
    (kind,target,actor,idempotency_key,request_sha256,state,smoke_passed_at,notified_at)
    select 'news',$1,'test:bulk',$2||n,$3,$4,$5,$6 from generate_series(1,$7) as n returning id`,
    [db.target, `${prefix}-`, 'c'.repeat(64), state, smoke, notified, count]);
  return result.rows.map((r) => Number(r.id)).sort((a, b) => a - b);
};

const indexNames = (db) => db.query("select indexname from pg_indexes where schemaname='content' and tablename='submissions'").then((r) => r.rows.map((row) => row.indexname));
const preflightIndexes = async (db) => (await indexNames(db)).filter((name) => name === 'submissions_pending_idx' || name === 'submissions_active_idx').sort();

const walkNodes = (node, visit) => { visit(node); for (const child of node?.Plans ?? []) walkNodes(child, visit); };

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

test('roundup preflight lists pending roundup submissions', async () => {
  const { db, close } = await testDb();
  try {
    // Remove this compatibility shim when migration 0003 adds roundup.
    const constraint = (await db.query("select pg_get_constraintdef(oid) as definition from pg_constraint where conrelid='content.submissions'::regclass and conname='submissions_kind_check'")).rows[0]?.definition || '';
    if (!constraint.includes("'roundup'")) {
      await db.query('alter table content.submissions drop constraint submissions_kind_check');
      await db.query("alter table content.submissions add constraint submissions_kind_check check (kind in ('seed','business','blog','blog-live','news','roundup','seo','topic-discovery','manual','admin'))");
    }
    const id = await insert(db, 'roundup', 'published');
    await insert(db, 'roundup', 'published', new Date(), new Date());
    assert.deepEqual(await listPendingByKind(db, { target: db.target, kind: 'roundup' }), [id]);
  } finally { await close(); }
});

test('pending preflight pages a backlog larger than one page without dropping work', async () => {
  const { db, close } = await testDb();
  try {
    await bulk(db, { prefix: 'hist', count: 5000, state: 'published', smoke: new Date(), notified: new Date() });
    const backlog = await bulk(db, { prefix: 'pend', count: PENDING_NEWS_PAGE + 5, state: 'published', smoke: null, notified: null });
    await db.query('analyze content.submissions');

    // One page returns at most PENDING_NEWS_PAGE ids ascending; a full page signals more work.
    const page = await listPendingByKind(db, { target: db.target, kind: 'news' });
    assert.equal(page.length, PENDING_NEWS_PAGE);
    assert.deepEqual(page, [...page].sort((a, b) => a - b));
    assert.ok(backlog.slice(0, PENDING_NEWS_PAGE).every((id) => page.includes(id)));

    // Explicit paging enumerates the whole backlog with bounded per-query work.
    const query = db.query.bind(db);
    let reads = 0;
    db.query = (...args) => { reads += 1; return query(...args); };
    const enumerated = [];
    for (;;) {
      const part = await listPendingByKind(db, { target: db.target, kind: 'news', afterId: enumerated.length ? enumerated[enumerated.length - 1] : null });
      enumerated.push(...part);
      if (part.length < PENDING_NEWS_PAGE) break;
    }
    db.query = query;
    assert.deepEqual(enumerated, backlog, 'paging must surface every pending id, none silently discarded');
    assert.equal(reads, 2, 'a >page backlog is enumerated with one bounded query per page, never one query per row');

    // The CLI default (the runner's path) enumerates every page and stays complete.
    const { result, exitCode } = await runCli(['pending', '--kind', 'news', '--target', db.target]);
    assert.equal(exitCode, 0);
    assert.deepEqual(result, backlog);

    // An explicit single page is opt-in and cursor-addressable.
    const head = await runCli(['pending', '--kind', 'news', '--target', db.target, '--limit', '7']);
    assert.deepEqual(head.result, backlog.slice(0, 7));
    const tail = await runCli(['pending', '--kind', 'news', '--target', db.target, '--after', String(backlog[6])]);
    assert.deepEqual(tail.result, backlog.slice(7));

    await assert.rejects(listPendingByKind(db, { target: db.target, kind: 'news', limit: 0 }), /pending page limit/);
    await assert.rejects(listPendingByKind(db, { target: db.target, kind: 'news', limit: 1.5 }), /pending page limit/);
    await assert.rejects(listPendingByKind(db, { target: db.target, kind: 'news', afterId: 0 }), /pending page cursor/);
    await assert.rejects(runCli(['pending', '--kind', 'news', '--limit', '0']), /positive integer/);
  } finally { await close(); }
});

test('CLI default pending enumeration is finite: exactly-cap succeeds, one row over fails closed', async () => {
  const { db, close } = await testDb();
  try {
    const atCap = await bulk(db, { prefix: 'cap-ok', count: PENDING_NEWS_BACKLOG_CAP, state: 'published', smoke: null, notified: null });
    const ok = await runCli(['pending', '--kind', 'news', '--target', db.target]);
    assert.equal(ok.exitCode, 0);
    assert.deepEqual(ok.result, atCap, 'a backlog exactly at the cap enumerates completely');

    await bulk(db, { prefix: 'cap-over', count: 1, state: 'published', smoke: null, notified: null });
    await assert.rejects(
      runCli(['pending', '--kind', 'news', '--target', db.target]),
      (error) => error instanceof StateError && /pending backlog exceeds 1000 ids for kind news; propagation is stuck/.test(error.message),
      'overflow must fail closed as state needing inspection, never a silent truncation or source-edit hint');

    // Explicit single pages are unaffected by the enumeration cap.
    const page = await runCli(['pending', '--kind', 'news', '--target', db.target, '--limit', '5']);
    assert.deepEqual(page.result, atCap.slice(0, 5));
  } finally { await close(); }
});

test('pending preflight uses the partial pending index, not a sequential scan over history', async () => {
  const { db, close } = await testDb();
  try {
    await bulk(db, { prefix: 'hist', count: 5000, state: 'published', smoke: new Date(), notified: new Date() });
    await bulk(db, { prefix: 'pend', count: 3, state: 'published', smoke: null, notified: null });
    await bulk(db, { prefix: 'closed', count: 3000, state: 'rejected', smoke: null, notified: null });
    const open = await insert(db, 'news', 'open');
    const gating = await insert(db, 'news', 'gating');
    await db.query('analyze content.submissions');

    const explain = async (sql, params = []) => JSON.parse(JSON.stringify((await db.query(`explain (analyze, format json) ${sql}`, params)).rows[0]['QUERY PLAN']));
    const assertNoSeqScan = (plan, message) => walkNodes(plan[0].Plan, (node) => {
      if (node['Node Type'] === 'Seq Scan' && node['Relation Name'] === 'submissions') assert.fail(message);
    });

    const pendingPlan = await explain(PENDING_BY_KIND_SQL, [db.target, 'news', null, PENDING_NEWS_PAGE]);
    const planText = JSON.stringify(pendingPlan);
    assert.match(planText, /submissions_pending_idx/, 'pending preflight must scan the 0002 partial pending index');
    assertNoSeqScan(pendingPlan, 'pending preflight must not sequentially scan completed history');

    // The open/gating resume route (list --submissions --state open,gating --kind news).
    // Literals in the probe match the CLI's fixed state set; the parameterized
    // `state=any($1)` form can fall back to a generic plan after 5 runs.
    const activePlan = await explain("select * from content.submissions where state in ('open','gating') and kind=$1 and target=$2 order by id desc", ['news', db.target]);
    assert.match(JSON.stringify(activePlan), /submissions_active_idx/, 'open/gating listing must scan the 0002 partial active index');
    assertNoSeqScan(activePlan, 'open/gating listing must not sequentially scan closed history');
    const active = (await db.query("select id from content.submissions where state in ('open','gating') and kind=$1 and target=$2 order by id desc", ['news', db.target])).rows.map((r) => Number(r.id));
    assert.deepEqual(active, [open, gating].sort((a, b) => b - a));
  } finally { await close(); }
});

test('0002 forward migration restores missing preflight indexes and stays idempotent', async () => {
  const { db, close, url, name } = await testDb();
  const priorUnpooled = process.env.CONTENT_DATABASE_URL_UNPOOLED;
  const priorName = process.env.CONTENT_DB_NAME;
  try {
    assert.deepEqual(await preflightIndexes(db), ['submissions_active_idx', 'submissions_pending_idx']);

    // Simulate missing 0002 index/version state in the current multi-version fixture.
    await db.query('drop index content.submissions_pending_idx');
    await db.query('drop index content.submissions_active_idx');
    await db.query("delete from content.schema_migrations where version='0002'");

    process.env.CONTENT_DATABASE_URL_UNPOOLED = url;
    process.env.CONTENT_DB_NAME = name;
    const migrated = await runCli(['migrate']);
    assert.deepEqual(migrated.result, { applied: ['0002'] });
    assert.deepEqual(await preflightIndexes(db), ['submissions_active_idx', 'submissions_pending_idx']);
    const versions = (await db.query('select version from content.schema_migrations order by version')).rows.map((r) => r.version);
    assert.deepEqual(versions, ['0001', '0002', '0003', '0004', '0005']);

    const again = await runCli(['migrate']);
    assert.deepEqual(again.result, { applied: [] }, 'migrate must not reapply recorded versions');
  } finally {
    process.env.CONTENT_DATABASE_URL_UNPOOLED = priorUnpooled;
    process.env.CONTENT_DB_NAME = priorName;
    await close();
  }
});
