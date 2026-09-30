// weekly-roundup v2 runner wiring (docs/specs/weekly-roundup-v2.md §10, A5)
// against the in-memory cadence CLI fake. The fake writer emits the v2 entry
// contract: result.json {pipeline:'structured-v2', isoWeek, slug, now, packDigest,
// verifyDigest, decision, units, coreUnits, coreAnchorUnits, published, census} +
// pack.json {isoWeek, now, units, stillInEffect, signals, forms}, appending one
// post (with roundupCoverage) only for a publish decision without --dry-run.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runWeeklyBlog, runWeeklyRoundup } from '../../ops/exedev-runner/runner.mjs';
import { SUN, WED, attemptsOf, createWorld, submitCalls } from './fake-cadence.mjs';
import { roundupPackDigest } from '../../scripts/news-pilot/roundup-evidence.mjs';
import { buildFixture, igUnit, unit } from '../content/fixtures/roundup-v2.mjs';

const launcher = fs.readFileSync(new URL('../../ops/exedev-runner/launcher.sh', import.meta.url), 'utf8');
const SLUG = 'liberty-village-news-week-2026-w40';
const MON = new Date('2026-10-05T11:00:00.000Z');
const run = (world, target = 'staging', slot = '202609301100-roundupa') => runWeeklyRoundup({ target, slot, request: {}, deps: world.deps });
const censusRun = (world, slot = '202609301100-census') => runWeeklyRoundup({ target: 'staging', slot, request: {}, deps: { ...world.deps, roundupPublicationMode: 'census-only' } });
const withWorld = (t, now = WED) => { const world = createWorld({ now }); t.after(() => world.cleanup()); return world; };
const writeJson = (file, value) => fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
const defaultUnits = (date = '2026-10-01') => [unit('a', { date }), unit('b', { verdict: 'adjacent', date }), unit('c', { verdict: 'adjacent', date })];

// Build a v2 writer; `mutate` receives {result, pack, posts} before writing.
function writer({ units = null, hold = null, mutate = () => {}, skip = [] } = {}) {
  return ({ out, root, now, world, dryRun = false }) => {
    const fixture = buildFixture({ now, units: units ?? defaultUnits(now.slice(0, 10)) });
    const result = { ...fixture.result };
    if (hold) Object.assign(result, { decision: 'hold', published: false, units: hold.units, coreUnits: hold.coreUnits ?? 0, coreAnchorUnits: hold.coreAnchorUnits ?? 0,
      reasons: hold.reasons, census: { signals: 9, admitted: hold.units, note: 'text is never logged', byReason: { 'weak-source': 3 } } });
    if (dryRun) result.published = false;
    const posts = [...world.posts];
    if (!hold && !dryRun) posts.push(fixture.post);
    const bag = { result, pack: fixture.pack, posts, fixture };
    mutate(bag);
    if (!skip.includes('result')) writeJson(path.join(out, 'result.json'), bag.result);
    if (!skip.includes('pack')) writeJson(path.join(out, 'pack.json'), bag.pack);
    if (!dryRun) writeJson(path.join(root, 'data', 'posts.json'), bag.posts);
  };
}
const holdWriter = (units = 2) => writer({ hold: { units, coreUnits: 1, coreAnchorUnits: 1, reasons: ['below-minimum'] } });
const v2Calls = (world) => world.sources.filter((entry) => entry.script === 'scripts/news-pilot/roundup-v2-run.mjs');

test('the runner takes the per-target mode from the pinned roundup-mode module (staging structured-v2)', (t) => {
  const world = withWorld(t);
  assert.equal(world.deps.modules.roundupPublication.staging, 'structured-v2');
  assert.equal(world.deps.modules.roundupPublication.production, 'census-only');
  world.roundupPlan = [writer()];
  assert.equal(run(world).success, true);
  assert.throws(() => runWeeklyRoundup({ target: 'staging', slot: '202609301100-roundupz', request: {}, deps: { ...world.deps, roundupPublicationMode: 'legacy-fixture' } }), /roundup publication disabled/);
  assert.throws(() => runWeeklyRoundup({ target: 'staging', slot: '202609301100-roundupy', request: { dryRun: true }, deps: world.deps }), /weekly-roundup options unsupported/);
});

test('census-only runs the v2 pipeline dry: no reservation, attempt, submit or reconciliation; posts bytes unchanged', (t) => {
  const world = withWorld(t);
  world.roundupPlan = [writer()];
  const postsFile = path.join(world.repo, 'data', 'posts.json');
  world.deps.exportSnapshot();
  const before = fs.readFileSync(postsFile, 'utf8');
  const result = censusRun(world);
  assert.equal(result.reason, 'roundup-publication-disabled');
  assert.deepEqual(result.census, { signals: 3, admitted: 3, units: 3, coreUnits: 1, coreAnchorUnits: 1 });
  assert.equal(fs.readFileSync(postsFile, 'utf8'), before, 'posts bytes unchanged');
  assert.equal(attemptsOf(world, 'roundup').length, 0);
  assert.equal(submitCalls(world).length, 0);
  assert.equal(world.calls.some((call) => ['reserve', 'attempt', 'attach', 'gate', 'unresolved'].includes(call[1] ?? call[0]) || call[0] === 'gate'), false);
  const [collect, runCall] = v2Calls(world);
  assert.ok(collect.args.includes('--collect'));
  assert.ok(runCall.args.includes('--dry-run'));
});

test('model technical failure alerts instead of a normal cadence HOLD, including census-only', (t) => {
  const world = withWorld(t);
  const technical = writer({ hold: { units: 0, reasons: ['below-minimum'] }, mutate: ({ result }) => {
    result.decision = 'technical-failure';
    result.technicalFailure = true;
    result.reasons = ['reason-model-failed'];
  } });
  world.roundupPlan = [technical];
  assert.throws(() => run(world), /roundup model technical failure/);
  assert.equal(submitCalls(world).length, 0);
  const census = withWorld(t);
  census.roundupPlan = [technical];
  assert.throws(() => censusRun(census), /roundup model technical failure/);
});

test('census-only fails closed if a writer reports publication despite --dry-run', (t) => {
  const world = withWorld(t);
  world.roundupPlan = [writer({ mutate: (bag) => { bag.result.published = true; } })];
  assert.throws(() => censusRun(world), /roundup census invalid/);
  assert.equal(submitCalls(world).length, 0);
});

test('production target is refused for weekly-roundup in the runner and both launcher paths', (t) => {
  const world = withWorld(t);
  assert.throws(() => run(world, 'production'), /weekly-roundup is staging-only/);
  assert.equal(world.calls.length, 0, 'refused before any DB call');
  assert.match(launcher, /case "\$job" in [^)]*\|weekly-roundup\) ;; \*\) exit 2;; esac/);
  assert.match(launcher, /\[\[ "\$job" != weekly-roundup \|\| "\$target" == staging \]\] \|\| \{ echo 'weekly-roundup is staging-only' >&2; exit 2; \}/);
  assert.match(launcher, /if \[\[ "\$job" == weekly-roundup && "\$target" != staging \]\]; then echo 'weekly-roundup is staging-only' >&2; exit 2; fi/);
  const generatorJobs = launcher.match(/if job not in \(([^)]*)\)/)[1];
  assert.doesNotMatch(generatorJobs, /roundup/, 'generator allowlist unchanged');
});

test('a §7 hold is non-terminal: no attempt, bounded census, slot released; a later slot re-collects and submits', (t) => {
  const world = withWorld(t);
  world.roundupPlan = [holdWriter()];
  const held = run(world);
  assert.deepEqual(held, { noChanges: true, reason: 'roundup-hold', week: '2026-09-28',
    census: { signals: 9, admitted: 2, units: 2, coreUnits: 1, coreAnchorUnits: 1, byReason: { 'weak-source': 3, 'below-minimum': 1 } } });
  assert.equal(attemptsOf(world, 'roundup').length, 0, 'no attempt row for a hold');
  assert.equal(submitCalls(world).length, 0);
  assert.equal([...world.alerts.values()].filter((alert) => alert.week === '2026-09-28').length, 0, 'a hold never raises its own week\'s missed alert');
  assert.equal([...world.slots.values()].find((slot) => slot.lane === 'roundup').token, null, 'slot released');

  world.roundupPlan = [writer()];
  const result = run(world, 'staging', '202610021100-roundupb');
  assert.equal(result.success, true);
  assert.equal(v2Calls(world).filter((entry) => entry.args.includes('--collect')).length, 2, 'the later slot re-collects');
  const [attempt] = attemptsOf(world, 'roundup');
  assert.equal(attempt.outcome, 'consumed');
  assert.equal(attempt.topic_key, SLUG);
  assert.equal(attempt.source_pack_digest, attempt.intent_fingerprint);
  const [submit] = submitCalls(world);
  assert.deepEqual([submit[submit.indexOf('--kind') + 1], submit[submit.indexOf('--idempotency-key') + 1]], ['roundup', attempt.idempotency_key]);
  const outDir = submit[submit.indexOf('--roundup-out') + 1];
  assert.ok(outDir.startsWith(path.join(world.stateRoot, 'roundup-attempts')), 'submits from the retained attempt dir');
  assert.equal(roundupPackDigest(JSON.parse(fs.readFileSync(path.join(outDir, 'pack.json'), 'utf8'))), attempt.source_pack_digest);
  assert.equal(submit.includes('--ig-refetch'), false, 'no Instagram helper for a pack without Instagram');
  const runCall = v2Calls(world).at(-1);
  assert.equal(runCall.args[runCall.args.indexOf('--now') + 1], WED.toISOString(), 'T_plan is the injected clock');
  assert.equal(runCall.args[runCall.args.indexOf('--root') + 1], world.repo);
  assert.equal(runCall.args.includes('--dry-run'), false);
});

test('a pack citing Instagram runs the source-only ig-refetch helper into the attempt dir before submit, even if it fails', (t) => {
  const world = withWorld(t);
  world.roundupPlan = [writer({ units: [...defaultUnits('2026-10-01'), igUnit('ig', '2026-10-03')] })];
  world.igPlan = ['fail'];
  assert.equal(run(world).success, true, 'the fake submit accepts; the real submit would refuse the IG unit');
  const helper = world.sources.find((entry) => entry.script === 'scripts/news-pilot/ig-refetch.mjs');
  const [submit] = submitCalls(world);
  const dir = submit[submit.indexOf('--roundup-out') + 1];
  assert.deepEqual(helper.args, ['--pack', path.join(dir, 'pack.json'), '--out', path.join(dir, 'ig-refetch.json')]);
  assert.equal(submit[submit.indexOf('--ig-refetch') + 1], path.join(dir, 'ig-refetch.json'));
  assert.ok(world.logs.some((entry) => entry.event === 'roundup-ig-refetch-failed'));
});

test('the retained attempt dir keeps the snapshots the pack cites', (t) => {
  const world = withWorld(t);
  const units = defaultUnits('2026-10-01');
  const cited = units[0].evidence[0].snapshotSha256;
  world.snapshotDigests = [cited, 'f'.repeat(64)];
  world.roundupPlan = [writer({ units })];
  assert.equal(run(world).success, true);
  const [submit] = submitCalls(world);
  const dir = submit[submit.indexOf('--roundup-out') + 1];
  assert.deepEqual(fs.readdirSync(path.join(dir, 'snapshots', 'rv2-venue')), [`${cited}.html`]);
});

test('second run in the same week is a no-op; a pending one resumes the same key without a second candidate', (t) => {
  const world = withWorld(t);
  world.roundupPlan = [writer()];
  world.gatePlan = ['pending'];
  world.deployCode = 3;
  assert.throws(() => run(world), /publish or propagation pending/);
  const [open] = attemptsOf(world, 'roundup');
  assert.equal(open.outcome, 'published');
  world.deployCode = 0;
  assert.equal(run(world, 'staging', '202610021100-roundupc').success, true);
  assert.equal(v2Calls(world).length, 2, 'no second pipeline run');
  assert.equal(submitCalls(world).length, 1);
  assert.equal(attemptsOf(world, 'roundup')[0].idempotency_key, open.idempotency_key);
  assert.deepEqual(run(world, 'staging', '202610041600-roundupd'), { cadenceMet: true, noChanges: true });
});

test('losers of the week roundup slot never draft a second candidate', (t) => {
  const world = withWorld(t);
  world.heldByOther.add('2026-09-28|roundup');
  assert.deepEqual(run(world), { noChanges: true, reason: 'roundup-slot-held' });
  assert.equal(world.sources.length, 0);
});

const refusals = {
  'missing pack.json': writer({ skip: ['pack'] }),
  'missing result.json': writer({ skip: ['result'] }),
  'malformed result.json': writer({ mutate: (bag) => { bag.result = '{not json'; } }),
  'malformed pack.json': writer({ mutate: (bag) => { bag.pack = { units: 'x' }; } }),
  'pipeline missing': writer({ mutate: (bag) => { delete bag.result.pipeline; } }),
  'published not boolean': writer({ mutate: (bag) => { bag.result.published = 1; } }),
  'units below 3': writer({ mutate: (bag) => { bag.result.units = 2; } }),
  'no core anchor': writer({ mutate: (bag) => { bag.result.coreAnchorUnits = 0; } }),
  'verifyDigest missing': writer({ mutate: (bag) => { delete bag.result.verifyDigest; } }),
  'verifyDigest invalid': writer({ mutate: (bag) => { bag.result.verifyDigest = 'x'.repeat(64); } }),
  'roundupCoverage missing': writer({ mutate: (bag) => { delete bag.posts.at(-1).roundupCoverage; } }),
  'roundupCoverage malformed': writer({ mutate: (bag) => { bag.posts.at(-1).roundupCoverage = { ...bag.posts.at(-1).roundupCoverage, isoWeek: '2026-W41' }; } }),
  'pack units disagree with result': writer({ mutate: (bag) => { bag.result.units = 4; } }),
  'packDigest mismatch': writer({ mutate: (bag) => { bag.result.packDigest = 'e'.repeat(64); } }),
  'slug mismatch': writer({ mutate: (bag) => { bag.result.slug = 'liberty-village-news-week-2026-w41'; bag.posts.at(-1).slug = bag.result.slug; } }),
  'ISO week mismatch': writer({ mutate: (bag) => { bag.result.isoWeek = '2026-W41'; } }),
  'more than one new post': writer({ mutate: (bag) => { bag.posts.push({ slug: 'second-new-post', title: 'Second', category: 'news' }); } }),
  'post not category news': writer({ mutate: (bag) => { bag.posts.at(-1).category = 'lifestyle'; } }),
  'hold with a new post': writer({ mutate: (bag) => { bag.result.decision = 'hold'; bag.result.published = false; } }),
  'published without a post': writer({ mutate: (bag) => { bag.posts.pop(); } }),
  'existing post removed': writer({ mutate: (bag) => { bag.posts.shift(); } }),
};
for (const [name, plan] of Object.entries(refusals)) {
  test(`roundup refusal: ${name} → no attempt, no submit`, (t) => {
    const world = withWorld(t);
    world.roundupPlan = [plan];
    assert.throws(() => run(world), /roundup artifact (?:invalid|inconsistent)/);
    assert.equal(attemptsOf(world, 'roundup').length, 0);
    assert.equal(submitCalls(world).length, 0);
    assert.equal([...world.slots.values()].find((slot) => slot.lane === 'roundup').token, null, 'slot released');
  });
}

test('roundup crash before submit resubmits the SAME key from retained artifacts', (t) => {
  const world = withWorld(t);
  world.roundupPlan = [writer()];
  world.submitPlan = ['network'];
  assert.throws(() => run(world), (error) => error.cliFailure?.reason === 'cli-network');
  const [open] = attemptsOf(world, 'roundup');
  assert.equal(open.submission_id, null);
  assert.equal(run(world, 'staging', '202610021100-roundupe').success, true);
  assert.equal(attemptsOf(world, 'roundup').length, 1);
  assert.equal(v2Calls(world).length, 2, 'no second pipeline run');
  const keys = submitCalls(world).map((args) => args[args.indexOf('--idempotency-key') + 1]);
  assert.deepEqual(keys, [open.idempotency_key, open.idempotency_key]);
});

test('F1 roundup smoked but not current-live is an honest failure; a consumed-but-unpublished slot needs operator review', (t) => {
  const world = withWorld(t);
  world.roundupPlan = [writer()];
  world.gatePlan = ['not-live'];
  assert.throws(() => run(world), /smoked but not counted for week/);
  assert.equal(attemptsOf(world, 'roundup')[0].outcome, 'smoked');
  const other = withWorld(t);
  other.roundupPlan = [writer()];
  assert.equal(run(other).success, true);
  other.live.clear();
  assert.throws(() => run(other, 'staging', '202610021100-roundupf'), /roundup consumed but no longer live/);
});

test('F4 weekly-roundup also evaluates the prior week and records both missed alerts once', (t) => {
  const world = withWorld(t);
  world.roundupPlan = [holdWriter(), holdWriter()];
  run(world);
  run(world, 'staging', '202610021100-roundupg');
  assert.deepEqual([...world.alerts.values()].map((alert) => alert.kind), ['WEEKLY_CONTENT_MISSED', 'WEEKLY_NEWS_MISSED']);
});

// ---------------------------------------------------------------------------
// Prior-week roundup reconciliation (§10.3.1).
// ---------------------------------------------------------------------------
function sundayPending(t) {
  const world = withWorld(t, SUN);
  world.cadenceStartWeek = '2026-09-28';
  world.roundupPlan = [writer()];
  world.gatePlan = ['pending'];
  world.deployCode = 3;
  assert.throws(() => run(world, 'staging', '202610041600-roundupw40'), /publish or propagation pending/);
  const [w40] = attemptsOf(world, 'roundup');
  assert.equal(w40.outcome, 'published');
  world.now = MON;
  world.deployCode = 0;
  return { world, w40 };
}

test('Sunday pending → Monday: the W40 attempt resumes its ORIGINAL key, becomes late-smoked, W40 stays missed, then W41 drafts its own edition', (t) => {
  const { world, w40 } = sundayPending(t);
  world.roundupPlan = [writer()];
  const result = run(world, 'staging', '202610051100-roundupw41');
  assert.equal(result.success, true);
  const w40After = world.attempts.find((a) => a.idempotency_key === w40.idempotency_key);
  assert.equal(w40After.outcome, 'late-smoked');
  assert.equal(submitCalls(world).filter((args) => args.includes(w40.idempotency_key)).length, 1, 'never re-submitted');
  assert.ok(world.alerts.has('2026-09-28|WEEKLY_NEWS_MISSED'), 'the W40 missed intent exists');
  const w41 = attemptsOf(world, 'roundup').find((a) => a.week_start_utc === '2026-10-05');
  assert.equal(w41.outcome, 'consumed');
  assert.equal(w41.topic_key, 'liberty-village-news-week-2026-w41');
  const reconcile = world.calls.findIndex((call) => call[1] === 'unresolved');
  const count = world.calls.findIndex((call) => call[1] === 'count' && call.includes('2026-10-05'));
  assert.ok(reconcile > -1 && reconcile < count, 'reconciled before the current-week count');
  assert.deepEqual(world.calls[reconcile].slice(-2), ['--lane', 'roundup']);
});

test('the same Monday reconciliation after deleting the VM state root gives the same outcome', (t) => {
  const { world, w40 } = sundayPending(t);
  fs.rmSync(world.stateRoot, { recursive: true, force: true });
  fs.mkdirSync(world.stateRoot, { recursive: true });
  world.roundupPlan = [writer()];
  assert.equal(run(world, 'staging', '202610051100-roundupw41b').success, true);
  assert.equal(world.attempts.find((a) => a.idempotency_key === w40.idempotency_key).outcome, 'late-smoked');
});

test('current week already met: the W40 attempt is still reconciled before the early return', (t) => {
  const { world, w40 } = sundayPending(t);
  const id = world.nextId++;
  world.submissions.set(id, { id, kind: 'roundup', key: 'other-w41', state: 'published', smokedAt: MON.toISOString(), slug: 'liberty-village-news-week-2026-w41' });
  world.live.add(id);
  assert.deepEqual(run(world, 'staging', '202610051100-roundupmet'), { cadenceMet: true, noChanges: true });
  assert.equal(world.attempts.find((a) => a.idempotency_key === w40.idempotency_key).outcome, 'late-smoked');
  assert.equal(v2Calls(world).length, 2, 'no W41 pipeline run');
});

test('a prior attempt still pending after resume stops the run before any W41 draft', (t) => {
  const { world } = sundayPending(t);
  world.deployCode = 3;
  assert.throws(() => run(world, 'staging', '202610051100-roundupp'), /prior roundup publication pending/);
  assert.equal(v2Calls(world).length, 2, 'nothing drafted for W41');
});

test('a prior attempt with no submission is failed-before-submit; nothing is submitted for the old week', (t) => {
  const world = withWorld(t, SUN);
  world.roundupPlan = [writer()];
  world.submitPlan = ['network'];
  assert.throws(() => run(world, 'staging', '202610041600-roundupns'), (error) => error.cliFailure?.reason === 'cli-network');
  const [w40] = attemptsOf(world, 'roundup');
  world.now = MON;
  world.roundupPlan = [writer()];
  assert.equal(run(world, 'staging', '202610051100-roundupns2').success, true);
  assert.equal(world.attempts.find((a) => a.idempotency_key === w40.idempotency_key).outcome, 'failed-before-submit');
  assert.equal(submitCalls(world).filter((args) => args.includes(w40.idempotency_key)).length, 1, 'only the original crashed submit');
});

test('a late roundup whose old slug is not current-live holds its original key with stuckSubmissionId', (t) => {
  const { world, w40 } = sundayPending(t);
  world.deployNotLive = true;
  assert.throws(() => run(world, 'staging', '202610051100-roundupstuck'), (error) => error.message === 'prior roundup smoke not current-live'
    && error.stuckSubmissionId === world.attempts.find((a) => a.idempotency_key === w40.idempotency_key).submission_id);
  assert.equal(world.attempts.find((a) => a.idempotency_key === w40.idempotency_key).outcome, 'smoked', 'original key held open');
  assert.ok(world.calls.some((call) => call[1] === 'current-live'));
});

test('more than two unresolved prior roundup attempts throws the backlog error', (t) => {
  const world = withWorld(t, MON);
  for (const [n, week] of ['2026-09-14', '2026-09-21', '2026-09-28'].entries()) {
    world.attempts.push({ target: 'staging', week_start_utc: week, lane: 'roundup', slot_number: 1, ordinal: 1, intent_fingerprint: `f${n}`, topic_key: 't',
      idempotency_key: `cadence:${n}`, source_pack_digest: `f${n}`, submission_id: null, outcome: null });
  }
  assert.throws(() => run(world, 'staging', '202610051100-backlog'), /prior roundup backlog exceeds recovery budget/);
  assert.equal(v2Calls(world).length, 0);
});

test('the blog lane reads unresolved attempts with --lane content', (t) => {
  const world = withWorld(t);
  try { runWeeklyBlog({ target: 'staging', slot: '202609301100-bloglane', request: {}, deps: world.deps }); } catch { /* cadence outcome irrelevant here */ }
  const call = world.calls.find((args) => args[1] === 'unresolved');
  assert.deepEqual(call.slice(-2), ['--lane', 'content']);
});
