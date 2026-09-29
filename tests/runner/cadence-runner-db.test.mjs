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
import { command, parseJson, runWeeklyBlog, runWeeklyRoundup } from '../../ops/exedev-runner/runner.mjs';
import { hasTestDb, publishDirect, seededDb } from '../content/fixtures/content-db.mjs';
import { topicKey } from '../../scripts/automation/topic-queue.mjs';
import { buildSourcePack, canonicalJson } from '../../scripts/automation/blog-source-pack.mjs';
import { weekStartUtc } from '../../scripts/content/cadence.mjs';
import { planRoundup, buildRoundupPost, isoWeekOf } from '../../scripts/news-pilot/roundup.mjs';
import { roundupPackDigest } from '../../scripts/news-pilot/roundup-evidence.mjs';
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
    db: handle.db, repo, stateRoot, origin, calls: [], gateScripts: [], defaultScript: PASS, crash: null, generated: [], shiftMs: 0,
    scriptFile(script) { const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lv-e2e-script-')), 'script.json'); fs.writeFileSync(file, JSON.stringify(script)); return file; },
  };
  const cli = (args, allowExit = []) => {
    ctx.calls.push(args);
    if (ctx.crash && ctx.crash(args)) { ctx.crash = null; throw new Error('simulated runner crash'); }
    const full = args[0] === 'gate' ? [...args, '--script', ctx.scriptFile(ctx.gateScripts.shift() ?? ctx.defaultScript)] : args;
    // The synthetic example.org source has no live public page. Only this test's
    // roundup submit runs through a local-DB fixture with an injected refetch;
    // the real submitContent validator and every other CLI command run unchanged.
    if (args[0] === 'submit' && args.includes('roundup'))
      return command(process.execPath, [path.join(ROOT, 'tests/runner/roundup-submit-fixture.mjs'), ...args.slice(1)], { cwd: repo, env, allowExit });
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
      const arg = (name) => args.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
      fs.mkdirSync(arg('out'), { recursive: true });
      if (script === 'scripts/news-pilot/run.mjs') { fs.writeFileSync(path.join(arg('out'), 'candidates.json'), JSON.stringify({ meta: { sourcesOk: 1 } })); return { code: 0 }; }
      ctx.roundupWriter({ out: arg('out'), now: arg('now'), root: arg('root') });
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
const roundup = (ctx, slot) => runWeeklyRoundup({ target: 'test', slot, request: {}, deps: ctx.deps });
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

function roundupWriter(items) {
  return ({ out, now, root }) => {
    const isoWeek = isoWeekOf(now).isoWeek;
    const pack = { items };
    const result = { isoWeek, slug: `liberty-village-news-week-${isoWeek.slice(0, 4)}-w${isoWeek.slice(6)}`, now, packDigest: roundupPackDigest(pack), decision: items.length ? 'publish' : 'hold', published: items.length ? 1 : 0, census: { candidates: 3, eligible: items.length } };
    fs.writeFileSync(path.join(out, 'pack.json'), JSON.stringify(pack));
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result));
    if (!items.length) return;
    const plan = planRoundup({ isoWeek, now, items }, { nowMs: Date.parse(now) });
    const post = buildRoundupPost(plan, { image: '/images/og/og-home.jpg', root: ROOT });
    const postsFile = path.join(root, 'data', 'posts.json');
    fs.writeFileSync(postsFile, JSON.stringify([...readJson(postsFile), post]));
  };
}

function newsItem(id, now) {
  const weekStart = Date.parse(`${weekStartUtc(now)}T00:00:00.000Z`);
  const announced = new Date(Math.max(weekStart + 60_000, now.getTime() - 2 * 3600_000));
  const extracted = new Date(Math.min(now.getTime() - 1000, announced.getTime() + 30_000)).toISOString();
  const url = `https://example.org/weekly/${id}`;
  const localDate = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Toronto', month: 'long', day: 'numeric', year: 'numeric' }).format(announced);
  const localTime = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Toronto', hour: 'numeric', minute: '2-digit', hour12: true }).format(announced);
  const dateSpan = `${localDate} at ${localTime}`;
  return {
    id, title: `Liberty Village update ${id}`, location: 'Liberty Village', actor: 'Liberty Village community group', category: 'community',
    summary: 'A local event at Hanna Avenue was announced.', announcedAt: announced.toISOString(), announcedAtVerified: true,
    announcedAtSourceUrl: url, announcedAtSpan: dateSpan, riskFlags: [], fingerprint: id,
    sources: [{ canonicalUrl: url, publisher: 'Example', publisherDomain: 'example.org', sourceTier: 'official',
      excerpt: `${dateSpan}: Liberty Village community group announced a new local event at Hanna Avenue.`,
      extractionSubstantive: true, extractedAt: extracted, fetchOk: true, urlUsable: true }],
    claims: [{ text: `The group announced a local event on ${localDate}.`, sourceUrl: url, span: 'announced a new local event' }],
  };
}

test('E2E (d): roundup zero → hold with no attempt row; items → one roundup submission; second run same week → no duplicate', { skip, timeout: 300_000 }, async (t) => {
  const ctx = await stack(t);
  ctx.roundupWriter = roundupWriter([]);
  assert.deepEqual(roundup(ctx, '202609301100-e2ed0001'), { noChanges: true, reason: 'zero-eligible-hold' });
  assert.equal((await ctx.attempts('roundup')).length, 0, 'zero run records no attempt');
  assert.equal((await ctx.db.query('select count(*)::int as n from content.cadence_alerts where week_start_utc=$1', [weekStartUtc(new Date())])).rows[0].n, 0, 'a zero hold never raises a missed alert for its own week');
  const now = new Date();
  ctx.roundupWriter = roundupWriter([newsItem('one', now), newsItem('two', now)]);
  const published = roundup(ctx, '202609301105-e2ed0002');
  assert.equal(published.success, true);
  const [attempt] = await ctx.attempts('roundup');
  assert.equal(attempt.outcome, 'consumed');
  const rows = (await ctx.db.query("select id,idempotency_key,state from content.submissions where kind='roundup'")).rows;
  assert.deepEqual(rows.map((r) => [r.idempotency_key, r.state]), [[attempt.idempotency_key, 'published']]);
  assert.equal(ctx.count().roundupCount, 1);
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
  ctx.roundupWriter = roundupWriter([]);
  assert.deepEqual(roundup(ctx, '202610071105-e2ee0003'), { noChanges: true, reason: 'zero-eligible-hold' }, 'roundup run also evaluates the prior week');
  const again = await alertsFor();
  assert.equal(again.length, 2, 'idempotent per target/week/type');
  assert.ok(again.every((row) => row.delivery_attempts === 1), 'no re-delivery once acknowledged');
});
