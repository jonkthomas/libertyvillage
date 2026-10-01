// Real-DB end-to-end for the runner cadence wiring. Skipped unless
// CONTENT_TEST_DATABASE_URL points at a disposable LOCAL postgres. The runner's
// weekly-blog / weekly-roundup code runs unchanged against the REAL
// `node scripts/content/cli.mjs` (cadence, export, submit --source-pack, gate with
// the existing --script verdict seam, deploy, smoke, alias observation) and a
// 127.0.0.1 hook/site/Slack stand-in. Only the generator and roundup writer are faked.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { classifyCliFailure, command, parseJson, runWeeklyBlog, runWeeklyRoundup } from '../../ops/exedev-runner/runner.mjs';
import { spawnSync } from 'node:child_process';
import { hasTestDb, publishDirect, seededDb } from '../content/fixtures/content-db.mjs';
import { topicKey } from '../../scripts/automation/topic-queue.mjs';
import { buildSourcePack, canonicalJson } from '../../scripts/automation/blog-source-pack.mjs';
import { weekStartUtc } from '../../scripts/content/cadence.mjs';
import { buildFixture, igUnit, unit } from '../content/fixtures/roundup-v2.mjs';
import { modules } from './fake-cadence.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const skip = !hasTestDb && 'CONTENT_TEST_DATABASE_URL not set';
const PASS = { reviews: [{ overall: 8.5, findings: [] }] };
// Score 7 with a blocking finding the fixer cannot reach (outside the candidate
// diff): the real gate decides `unrepairable` and blocks, no scripted fix needed.
const SCORE7 = { reviews: [{ overall: 7, findings: [{ severity: 'high', path: 'data/businesses.json#unrelated-record', note: 'post relies on a claim no cited record supports' }] }] };
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const jpeg = (label) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`hero:${label}`)]);
const queueEntry = (title) => ({ key: topicKey('blog', title, 'blog/auto-'), kind: 'blog', title, source: 'gsc', rationale: 'runner e2e', addedAt: '2026-09-01T00:00:00.000Z', attempts: 0, branchPrefix: 'blog/auto-' });

async function addQueue(db, titles, tag) {
  const seeded = await publishDirect(db, { idempotencyKey: `queue:${tag}`, items: titles.map((title) => { const payload = queueEntry(title); return { dataset: 'topic-queue', key: payload.key, payload }; }) });
  await db.query('update content.submissions set deploy_requested_at=now(),smoke_passed_at=now(),notified_at=now() where id=$1', [seeded.submissionId]);
}

async function stack(t) {
  const handle = await seededDb();
  const worker = new Worker(new URL('./site-worker.mjs', import.meta.url), { workerData: { url: handle.url, name: handle.name } });
  const [ready] = await once(worker, 'message');
  assert.equal(ready.type, 'ready');
  const origin = ready.origin;
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-runner-e2e-repo-'));
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-runner-e2e-state-'));
  // The pinned checkout: trusted scripts (symlinked; node resolves them in ROOT),
  // a fresh workspace for data/ and new blog JPGs, and existing OG images.
  fs.symlinkSync(path.join(ROOT, 'scripts'), path.join(repo, 'scripts'));
  fs.mkdirSync(path.join(repo, 'public', 'images', 'blog'), { recursive: true });
  fs.symlinkSync(path.join(ROOT, 'public', 'images', 'og'), path.join(repo, 'public', 'images', 'og'));
  // --preserve-symlinks-main keeps the CLI's argv[1] === import.meta.url main guard
  // true through the symlinked scripts/ directory.
  const env = {
    NODE_OPTIONS: '--preserve-symlinks-main', PATH: process.env.PATH, HOME: process.env.HOME, CONTENT_DATABASE_URL: handle.url, CONTENT_DATABASE_URL_UNPOOLED: handle.url,
    CONTENT_DB_NAME: handle.name, CONTENT_SITE_URL: origin, CONTENT_DEPLOY_HOOK_URL: `${origin}/hook`, SLACK_WEBHOOK_URL: `${origin}/slack`,
  };
  const ctx = {
    db: handle.db, repo, stateRoot, origin, calls: [], sources: [], igStatus: 'ok', gateScripts: [], defaultScript: PASS, crash: null, generated: [], shiftMs: 0,
    scriptFile(script) { const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lv-e2e-script-')), 'script.json'); fs.writeFileSync(file, JSON.stringify(script)); return file; },
  };
  const cli = (args, allowExit = []) => {
    ctx.calls.push(args);
    if (ctx.crash && ctx.crash(args)) { ctx.crash = null; throw new Error('simulated runner crash'); }
    const full = args[0] === 'gate' ? [...args, '--script', ctx.scriptFile(ctx.gateScripts.shift() ?? ctx.defaultScript)] : args;
    // Only this test's roundup submit runs through a local-DB fixture whose v2
    // verifier is the contract stub; the real submitContent policy and every
    // other CLI command run unchanged.
    if (args[0] === 'submit' && args.includes('roundup')) {
      // Classify the fixture's refusal exactly as the runner classifies the real CLI's.
      const result = spawnSync(process.execPath, [path.join(ROOT, 'tests/runner/roundup-submit-fixture.mjs'), ...args.slice(1)], { cwd: repo, env, encoding: 'utf8' });
      if (result.status === 0) return { code: 0, stdout: result.stdout };
      throw Object.assign(new Error(`roundup submit fixture exit ${result.status}`), { cliFailure: classifyCliFailure(process.execPath, ['scripts/content/cli.mjs', 'submit'], result) });
    }
    return command(process.execPath, ['scripts/content/cli.mjs', ...full], { cwd: repo, env, allowExit });
  };
  ctx.cliJson = (args) => parseJson(cli(args).stdout);
  ctx.deps = {
    repo, stateRoot, modules, now: () => new Date(Date.now() + ctx.shiftMs), cli, log: () => {}, alertsEnabled: true,
    cadenceStartWeek: weekStartUtc(new Date()), // Explicit activated test target; remains fixed when the E2E clock advances.
    exportSnapshot: () => {
      cli(['export', '--root', '.', '--target', 'test']);
      const data = (name) => readJson(path.join(repo, 'data', name));
      return { businesses: data('businesses.json'), posts: data('posts.json'), services: data('services.json'), topics: data('topics.json'), queue: data('topic-queue.json'), snapshotId: readJson(path.join(repo, '.content-export', 'manifest.json')).snapshot_id };
    },
    // Fake generator = weekly-blog-agent.js with TOPIC_OVERRIDE: grounded sidecar + one post.
    generate: (title) => {
      const data = (name) => readJson(path.join(repo, 'data', name));
      const posts = data('posts.json');
      const now = new Date();
      const built = buildSourcePack({ topic: title, businesses: data('businesses.json'), posts, services: data('services.json'), topics: data('topics.json'), now });
      assert.ok(built.ok, built.reason);
      const slug = `liberty-village-${built.pack.intentKey}-notes`;
      const sidecar = `tasks/auto-blog-runs/${now.toISOString().slice(0, 10)}-${built.pack.intentKey}-source-pack.json`;
      fs.mkdirSync(path.join(repo, 'tasks', 'auto-blog-runs'), { recursive: true });
      fs.writeFileSync(path.join(repo, sidecar), `${canonicalJson(built.pack)}\n`);
      fs.writeFileSync(path.join(repo, 'public', 'images', 'blog', `${slug}.jpg`), jpeg(slug));
      const day = now.toISOString().slice(0, 10);
      posts.push({
        slug, title: `${title} notes`, description: 'A short neighbourhood guide.',
        content: `## Where to go\n\n${built.pack.sources.map((source) => `[${source.name}](/directory/${source.id}) is listed in the Liberty Village directory.`).join('\n\n')}\n`,
        publishedAt: day, updatedAt: day, category: 'lifestyle', tags: ['food', 'liberty village', 'guide', 'local'],
        answerBlock: 'Liberty Village has several places worth a visit.', faqs: [1, 2, 3, 4].map((n) => ({ question: `Question ${n}?`, answer: `Answer ${n}.` })),
        image: `/images/blog/${slug}.jpg`, relatedServices: [], relatedTopics: [], relatedPosts: [], keyTakeaways: ['One', 'Two', 'Three', 'Four'], author: 'LibertyVillage.co',
      });
      fs.writeFileSync(path.join(repo, 'data', 'posts.json'), JSON.stringify(posts));
      ctx.generated.push(title);
      return ['data/posts.json', `public/images/blog/${slug}.jpg`, sidecar];
    },
    source: (script, args) => {
      const value = (name) => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : undefined; };
      ctx.sources.push({ script, args });
      if (script === 'scripts/news-pilot/ig-refetch.mjs') {
        // Fake provider under the source env: rows for exactly the pack's shortcodes.
        const pack = readJson(value('pack'));
        const rows = pack.signals.filter((signal) => signal.post).map((signal) => ({ shortcode: signal.post.shortcode, ownerUsername: signal.post.ownerUsername,
          timestamp: signal.post.timestamp, caption: signal.post.caption, status: ctx.igStatus }));
        fs.writeFileSync(value('out'), JSON.stringify({ fetchedAt: new Date().toISOString(), provider: 'apify', rows }));
        return { code: 0 };
      }
      if (args.includes('--collect')) { fs.mkdirSync(value('out'), { recursive: true }); fs.writeFileSync(path.join(value('out'), 'signals.jsonl'), ''); return { code: 0 }; }
      fs.mkdirSync(value('out'), { recursive: true });
      ctx.roundupWriter({ out: value('out'), now: value('now'), root: value('root') });
      return { code: 0 };
    },
  };
  ctx.count = () => ctx.cliJson(['cadence', 'count', '--week-start', weekStartUtc(new Date()), '--target', 'test']);
  ctx.attempts = async (lane) => (await handle.db.query('select * from content.cadence_attempts where lane=$1 order by slot_number,ordinal', [lane])).rows;
  t.after(async () => {
    worker.postMessage({ type: 'close' });
    await once(worker, 'exit');
    await handle.close();
    for (const dir of [repo, stateRoot]) fs.rmSync(dir, { recursive: true, force: true });
  });
  return ctx;
}

const blog = (ctx, slot) => runWeeklyBlog({ target: 'test', slot, request: {}, deps: ctx.deps });
// The local test target has no compiled mode; inject staging's structured-v2.
const roundup = (ctx, slot) => runWeeklyRoundup({ target: 'test', slot, request: {}, deps: { ...ctx.deps, roundupPublicationMode: 'structured-v2' } });
const blogSubmissions = async (db) => (await db.query("select id,idempotency_key,state,context from content.submissions where kind='blog' order by id")).rows;

test('E2E (a): publish + smoke → attempt smoked→consumed; cadence count increments via the hosted alias', { skip, timeout: 300_000 }, async (t) => {
  const ctx = await stack(t);
  await addQueue(ctx.db, ['Brunch Spots', 'Bars'], 'a');
  assert.equal(ctx.count().contentCount, 0);
  const result = blog(ctx, '202609301100-e2ea0001');
  assert.equal(result.cadenceMet, true);
  assert.equal(ctx.count().contentCount, 2, 'real count through the real alias manifest');
  const attempts = await ctx.attempts('content');
  assert.deepEqual(attempts.map((a) => [a.slot_number, a.ordinal, a.outcome]), [[1, 1, 'consumed'], [2, 1, 'consumed']]);
  const submissions = await blogSubmissions(ctx.db);
  assert.deepEqual(submissions.map((s) => [s.idempotency_key, s.state]), attempts.map((a) => [a.idempotency_key, 'published']));
  assert.deepEqual(submissions.map((s) => s.context.sourcePack.fingerprint), attempts.map((a) => a.source_pack_digest), 'verified trusted pack stored per attempt');
  assert.deepEqual(attempts.map((a) => Number(a.submission_id)), submissions.map((s) => Number(s.id)));
  assert.deepEqual(ctx.generated, ['Brunch Spots', 'Bars'], 'seed pet-friendly queue topic skipped before spend');
  assert.deepEqual(ctx.cliJson(['cadence', 'consumed', '--target', 'test']), attempts.map((a) => a.intent_fingerprint).sort(), 'F6 real `cadence consumed` returns all-time consumed intents');
  assert.deepEqual(blog(ctx, '202610021100-e2ea0002'), { cadenceMet: true, noChanges: true, contentCount: 2 });
  assert.equal(ctx.generated.length, 2, 'goal met: no further generator spend');
});

test('E2E (b): crash after submit, rerun → same idempotency key, no second submission', { skip, timeout: 300_000 }, async (t) => {
  const ctx = await stack(t);
  await addQueue(ctx.db, ['Brunch Spots', 'Bars'], 'b');
  ctx.crash = (args) => args[0] === 'cadence' && args[1] === 'attach';
  assert.throws(() => blog(ctx, '202609301100-e2eb0001'), /simulated runner crash/);
  const [open] = await ctx.attempts('content');
  assert.equal(open.outcome, null);
  assert.equal(open.submission_id, null, 'crash landed between submit and attach');
  const first = await blogSubmissions(ctx.db);
  assert.deepEqual(first.map((s) => s.idempotency_key), [open.idempotency_key]);
  const result = blog(ctx, '202609301105-e2eb0002');
  assert.equal(result.cadenceMet, true);
  const attempts = await ctx.attempts('content');
  assert.deepEqual(attempts.map((a) => [a.slot_number, a.ordinal, a.outcome]), [[1, 1, 'consumed'], [2, 1, 'consumed']]);
  assert.equal(attempts[0].idempotency_key, open.idempotency_key);
  assert.equal(Number(attempts[0].submission_id), Number(first[0].id));
  const all = await blogSubmissions(ctx.db);
  assert.equal(all.filter((s) => s.idempotency_key === open.idempotency_key).length, 1, 'no second submission for the original key');
  assert.equal(all.length, 2);
  assert.equal(ctx.calls.filter((args) => args[0] === 'submit' && args.includes(open.idempotency_key)).length, 1, 'resume used lookup, not a second submit');
  assert.equal(ctx.generated.filter((title) => title === 'Brunch Spots').length, 1);
});

test('E2E (c): gate score 7 → terminal outcome; the next run uses a new ordinal with a distinct intent', { skip, timeout: 300_000 }, async (t) => {
  const ctx = await stack(t);
  await addQueue(ctx.db, ['Brunch Spots'], 'c1');
  ctx.gateScripts = [SCORE7, SCORE7, SCORE7, SCORE7];
  assert.throws(() => blog(ctx, '202609301100-e2ec0001'), /cadence content deficit|weekly content missed/);
  const [rejected] = await ctx.attempts('content');
  const [submission] = await blogSubmissions(ctx.db);
  assert.equal(submission.state, 'blocked', 'score 7 with an unrepairable finding is a terminal gate block');
  assert.equal(rejected.outcome, submission.state, 'attempt outcome mirrors the terminal gate state');
  assert.equal(ctx.count().contentCount, 0, 'score 7 never counts');
  await addQueue(ctx.db, ['Bars'], 'c2');
  ctx.gateScripts = [];
  assert.throws(() => blog(ctx, '202610021100-e2ec0002'), /cadence content deficit|weekly content missed/, 'one counted post is still below the 2-post goal');
  const attempts = (await ctx.attempts('content')).filter((a) => a.slot_number === 1);
  assert.deepEqual(attempts.map((a) => [a.ordinal, a.outcome]), [[1, rejected.outcome], [2, 'consumed']]);
  assert.notEqual(attempts[1].idempotency_key, attempts[0].idempotency_key);
  assert.notEqual(attempts[1].intent_fingerprint, attempts[0].intent_fingerprint);
  assert.deepEqual(ctx.generated, ['Brunch Spots', 'Bars']);
  assert.equal(ctx.count().contentCount, 1);
});

// v2 entry contract: hold writes no post; publish appends one post with roundupCoverage.
function roundupWriter({ hold = false, units = null } = {}) {
  return ({ out, now, root }) => {
    const date = now.slice(0, 10);
    const fixture = buildFixture({ now, units: units ?? [unit(`a${date}`, { date }), unit(`b${date}`, { verdict: 'adjacent', date }), unit(`c${date}`, { verdict: 'adjacent', date })] });
    const result = hold ? { ...fixture.result, decision: 'hold', published: false, units: 2, coreUnits: 1, coreAnchorUnits: 1, reasons: ['below-minimum'] } : fixture.result;
    fs.writeFileSync(path.join(out, 'pack.json'), JSON.stringify(fixture.pack));
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result));
    if (hold) return;
    const postsFile = path.join(root, 'data', 'posts.json');
    fs.writeFileSync(postsFile, JSON.stringify([...readJson(postsFile), fixture.post]));
  };
}

test('E2E (d): roundup zero → hold with no attempt row; items → one roundup submission; second run same week → no duplicate', { skip, timeout: 300_000 }, async (t) => {
  const ctx = await stack(t);
  ctx.roundupWriter = roundupWriter({ hold: true });
  assert.equal(roundup(ctx, '202609301100-e2ed0001').reason, 'roundup-hold');
  assert.equal((await ctx.attempts('roundup')).length, 0, 'zero run records no attempt');
  assert.equal((await ctx.db.query('select count(*)::int as n from content.cadence_alerts where week_start_utc=$1', [weekStartUtc(new Date())])).rows[0].n, 0, 'a zero hold never raises a missed alert for its own week');
  ctx.roundupWriter = roundupWriter();
  const published = roundup(ctx, '202609301105-e2ed0002');
  assert.equal(published.success, true);
  const [attempt] = await ctx.attempts('roundup');
  assert.equal(attempt.outcome, 'consumed');
  const rows = (await ctx.db.query("select id,idempotency_key,state from content.submissions where kind='roundup'")).rows;
  assert.deepEqual(rows.map((r) => [r.idempotency_key, r.state]), [[attempt.idempotency_key, 'published']]);
  assert.equal(ctx.count().roundupCount, 1);
  const context = (await ctx.db.query("select context from content.submissions where kind='roundup'")).rows[0].context;
  assert.equal(context.pipeline, 'structured-v2');
  const slug = (await ctx.db.query('select key from content.submission_items where submission_id=$1', [rows[0].id])).rows[0].key;
  ctx.cliJson(['export', '--root', '.', '--target', 'test']);
  const exported = readJson(path.join(ctx.repo, 'data', 'posts.json')).find((post) => post.slug === slug);
  assert.deepEqual(exported.roundupCoverage, context.roundupCoverage, 'the live export carries the verified coverage');
  ctx.roundupWriter = () => assert.fail('writer must not run once the week has its roundup');
  assert.deepEqual(roundup(ctx, '202609301110-e2ed0003'), { cadenceMet: true, noChanges: true });
  assert.equal((await ctx.db.query("select count(*)::int as n from content.submissions where kind='roundup'")).rows[0].n, 1, 'no duplicate roundup');
});

test('E2E (e): the next week\'s first run records WEEKLY_CONTENT_MISSED + WEEKLY_NEWS_MISSED once for a 1+0 week and delivers them', { skip, timeout: 300_000 }, async (t) => {
  const ctx = await stack(t);
  await addQueue(ctx.db, ['Brunch Spots'], 'e');
  const week = weekStartUtc(new Date());
  assert.throws(() => blog(ctx, '202609301100-e2ee0001'), /cadence content deficit|weekly content missed/);
  assert.equal(ctx.count().contentCount, 1);
  const alertsFor = async () => (await ctx.db.query('select alert_kind,counts,delivered_at,delivery_attempts from content.cadence_alerts where week_start_utc=$1 order by alert_kind', [week])).rows;
  assert.deepEqual(await alertsFor(), [], 'no alert while the week is still open');
  ctx.shiftMs = 7 * 86400000;
  assert.throws(() => blog(ctx, '202610071100-e2ee0002'), /cadence content deficit|weekly content missed/);
  const first = await alertsFor();
  assert.deepEqual(first.map((row) => [row.alert_kind, row.counts]), [['WEEKLY_CONTENT_MISSED', { content: 1, roundup: 0 }], ['WEEKLY_NEWS_MISSED', { content: 1, roundup: 0 }]]);
  assert.ok(first.every((row) => row.delivered_at && row.delivery_attempts === 1), 'delivered to the webhook stand-in');
  ctx.roundupWriter = roundupWriter({ hold: true });
  assert.equal(roundup(ctx, '202610071105-e2ee0003').reason, 'roundup-hold', 'roundup run also evaluates the prior week');
  const again = await alertsFor();
  assert.equal(again.length, 2, 'idempotent per target/week/type');
  assert.ok(again.every((row) => row.delivery_attempts === 1), 'no re-delivery once acknowledged');
});

test('E2E (f): Instagram units re-verify only from the source-only helper file; a private post refuses the edition', { skip, timeout: 300_000 }, async (t) => {
  const ctx = await stack(t);
  const withIg = () => {
    const date = new Date().toISOString().slice(0, 10);
    return roundupWriter({ units: [unit(`a${date}`, { date }), unit(`b${date}`, { verdict: 'adjacent', date }), igUnit(`ig${date}`, date)] });
  };
  ctx.igStatus = 'private';
  ctx.roundupWriter = withIg();
  assert.throws(() => roundup(ctx, '202609301100-e2ef0001'), /roundup submit refused/);
  const [refused] = await ctx.attempts('roundup');
  assert.equal(refused.outcome, 'failed-before-submit');
  const helper = ctx.sources.find((entry) => entry.script === 'scripts/news-pilot/ig-refetch.mjs');
  const submit = ctx.calls.find((args) => args[0] === 'submit');
  assert.equal(submit[submit.indexOf('--ig-refetch') + 1], helper.args[helper.args.indexOf('--out') + 1]);
  ctx.igStatus = 'ok';
  ctx.roundupWriter = withIg();
  assert.equal(roundup(ctx, '202609301105-e2ef0002').success, true, 'the unchanged Instagram unit is accepted');
  const context = (await ctx.db.query("select context from content.submissions where kind='roundup' and state='published'")).rows[0].context;
  assert.deepEqual(context.instagram, { refetch: 'ok' });
});

test('E2E (g): a published prior-week roundup whose smoke lands next Monday is reconciled with its ORIGINAL key after VM state loss', { skip, timeout: 300_000 }, async (t) => {
  const ctx = await stack(t);
  const week = weekStartUtc(new Date());
  const nextWeek = weekStartUtc(new Date(Date.parse(`${week}T00:00:00Z`) + 7 * 86400000));
  ctx.roundupWriter = roundupWriter();
  // Crash right after gate/deploy/smoke, before the runner records any outcome.
  ctx.crash = (args) => args[0] === 'cadence' && args[1] === 'outcome';
  assert.throws(() => roundup(ctx, '202609301100-e2eg0001'), /simulated runner crash/);
  const [open] = await ctx.attempts('roundup');
  assert.equal(open.outcome, null);
  // The smoke receipt landed after the week ended (Sunday publish, Monday smoke).
  await ctx.db.query('update content.submissions set smoke_passed_at=$2 where id=$1', [open.submission_id, `${nextWeek}T01:00:00Z`]);
  fs.rmSync(ctx.stateRoot, { recursive: true, force: true });
  fs.mkdirSync(ctx.stateRoot, { recursive: true });
  ctx.shiftMs = Date.parse(`${nextWeek}T11:00:00Z`) - Date.now();
  ctx.roundupWriter = roundupWriter({ hold: true });
  const submitsBefore = ctx.calls.filter((args) => args[0] === 'submit').length;
  assert.equal(roundup(ctx, '202610051100-e2eg0002').reason, 'roundup-hold', 'the new week then runs its own pipeline');
  const settled = (await ctx.attempts('roundup')).find((a) => a.idempotency_key === open.idempotency_key);
  assert.equal(settled.outcome, 'late-smoked');
  assert.equal(ctx.calls.filter((args) => args[0] === 'submit').length, submitsBefore, 'nothing submitted for the old week');
  const missed = (await ctx.db.query("select alert_kind from content.cadence_alerts where week_start_utc=$1 and alert_kind='WEEKLY_NEWS_MISSED'", [week])).rows;
  assert.equal(missed.length, 1, 'the old week stays missed');
  const count = ctx.cliJson(['cadence', 'count', '--week-start', nextWeek, '--target', 'test']);
  assert.equal(count.roundupCount, 0, 'the old-week slug never counts for the new week');
  assert.deepEqual(ctx.cliJson(['cadence', 'unresolved', '--lane', 'roundup', '--week-start', nextWeek, '--target', 'test']), []);
});
