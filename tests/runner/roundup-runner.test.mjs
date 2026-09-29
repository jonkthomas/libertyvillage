// weekly-roundup runner wiring against the in-memory cadence CLI fake. The fake
// writer emits the confirmed roundup-run.mjs contract: result.json {isoWeek, slug,
// now, packDigest, decision, published, census} + pack.json {items}, and a post
// appended to data/posts.json only when items exist.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROUNDUP_PUBLICATION, runWeeklyRoundup } from '../../ops/exedev-runner/runner.mjs';
import { WED, attemptsOf, createWorld, submitCalls } from './fake-cadence.mjs';
import { roundupPackDigest } from '../../scripts/news-pilot/roundup-evidence.mjs';

const launcher = fs.readFileSync(new URL('../../ops/exedev-runner/launcher.sh', import.meta.url), 'utf8');
const SLUG = 'liberty-village-news-week-2026-w40';
// Historical publish-path contract remains exercised with a test-only injected
// dependency. The installed runner and its trusted CLI cannot activate it.
const run = (world, target = 'staging', slot = '202609301100-roundupa') => runWeeklyRoundup({ target, slot, request: {}, deps: { ...world.deps, roundupPublicationMode: 'legacy-fixture' } });
const censusRun = (world, slot = '202609301100-census') => runWeeklyRoundup({ target: 'staging', slot, request: {}, deps: world.deps });
const withWorld = (t) => { const world = createWorld({ now: WED }); t.after(() => world.cleanup()); return world; };
const writeJson = (file, value) => fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
const item = (id) => ({ id, title: `Liberty Village update ${id}`, sources: [{ canonicalUrl: `https://example.org/${id}` }], claims: [] });

// Build a writer; `mutate` receives {result, pack, posts} before writing.
function writer({ items = [item('a'), item('b')], mutate = () => {}, skip = [] } = {}) {
  return ({ out, root, now, world, dryRun = false }) => {
    const pack = { items };
    const zero = items.length === 0;
    const result = { isoWeek: '2026-W40', slug: SLUG, now, packDigest: roundupPackDigest(pack), decision: zero ? 'hold' : 'publish', published: zero || dryRun ? 0 : 1, census: { candidates: 5, eligible: items.length, refused: 5 - items.length, note: 'text is never logged' } };
    const posts = [...world.posts];
    if (!zero && !dryRun) posts.push({ slug: SLUG, title: 'Liberty Village news roundup', category: 'news' });
    const bag = { result, pack, posts };
    mutate(bag);
    if (!skip.includes('result')) writeJson(path.join(out, 'result.json'), bag.result);
    if (!skip.includes('pack')) writeJson(path.join(out, 'pack.json'), bag.pack);
    if (!dryRun) writeJson(path.join(root, 'data', 'posts.json'), bag.posts);
  };
}

for (const [name, passage] of [
  ['control', 'Liberty Village Community Association reported the alpha event at Hanna Avenue in Liberty Village.'],
  ['High Park', 'Liberty Village Community Association reported the alpha event at High Park in Toronto.'],
  ['Parkdale', 'Liberty Village Community Association reported the alpha event in Liberty Village-adjacent Parkdale.'],
]) test(`census-only roundup never submits a ${name} free-text candidate`, (t) => {
  const world = withWorld(t);
  assert.equal(ROUNDUP_PUBLICATION.mode, 'census-only');
  world.roundupPlan = [writer({ items: [{ ...item(name), title: passage }] })];
  const postsFile = path.join(world.repo, 'data', 'posts.json');
  world.deps.exportSnapshot();
  const before = fs.readFileSync(postsFile, 'utf8');
  assert.deepEqual(censusRun(world), { noChanges: true, reason: 'roundup-publication-disabled',
    census: { candidates: 5, eligible: 1, refused: 4 } });
  assert.equal(fs.readFileSync(postsFile, 'utf8'), before, 'posts bytes unchanged');
  assert.equal(attemptsOf(world, 'roundup').length, 0);
  assert.equal(submitCalls(world).length, 0);
  assert.equal(world.calls.some((call) => ['reserve', 'attempt', 'attach', 'gate'].includes(call[0])), false);
  assert.ok(world.sources.find((entry) => entry.script === 'scripts/news-pilot/run.mjs').args.includes('--dry-run'));
  assert.ok(world.sources.find((entry) => entry.script === 'scripts/news-pilot/roundup-run.mjs').args.includes('--dry-run'));
  assert.deepEqual(world.logs.find((entry) => entry.event === 'roundup-publication-held').census,
    { candidates: 5, eligible: 1, refused: 4 });
});

test('census-only roundup fails closed if a writer reports publication despite --dry-run', (t) => {
  const world = withWorld(t);
  world.roundupPlan = [writer({ mutate: (bag) => { bag.result.published = 1; } })];
  assert.throws(() => censusRun(world), /roundup census invalid/);
  assert.equal(submitCalls(world).length, 0);
  assert.equal(attemptsOf(world, 'roundup').length, 0);
});

test('production target is refused for weekly-roundup in the runner and both launcher paths', (t) => {
  const world = withWorld(t);
  assert.throws(() => run(world, 'production'), /weekly-roundup is staging-only/);
  assert.equal(world.calls.length, 0, 'refused before any DB call');
  assert.match(launcher, /case "\$job" in [^)]*\|weekly-roundup\) ;; \*\) exit 2;; esac/);
  assert.match(launcher, /case "\$job" in [^)]*\|weekly-roundup\) ;; \*\) usage;; esac/);
  assert.match(launcher, /\[\[ "\$job" != weekly-roundup \|\| "\$target" == staging \]\] \|\| \{ echo 'weekly-roundup is staging-only' >&2; exit 2; \}/);
  assert.match(launcher, /if \[\[ "\$job" == weekly-roundup && "\$target" != staging \]\]; then echo 'weekly-roundup is staging-only' >&2; exit 2; fi/);
  const generatorJobs = launcher.match(/if job not in \(([^)]*)\)/)[1];
  assert.doesNotMatch(generatorJobs, /roundup/, 'generator allowlist unchanged');
});

test('zero eligible items: non-terminal hold (no attempt, no submit, no alert), then a same-week run with items submits', (t) => {
  const world = withWorld(t);
  world.roundupPlan = [writer({ items: [] })];
  assert.deepEqual(run(world), { noChanges: true, reason: 'zero-eligible-hold' });
  assert.equal(attemptsOf(world, 'roundup').length, 0, 'no attempt row for a zero run');
  assert.equal(submitCalls(world).length, 0);
  assert.equal([...world.alerts.values()].filter((alert) => alert.week === '2026-09-28').length, 0, 'zero hold never raises a missed alert for its own week');
  assert.deepEqual(world.deadlineCalls.map((call) => call.week), ['2026-09-21'], 'current week is never deadline-evaluated by the runner');
  const hold = world.logs.find((entry) => entry.event === 'roundup-zero-hold');
  assert.deepEqual(hold.census, { candidates: 5, eligible: 0, refused: 5 }, 'census counts only');
  assert.equal([...world.slots.values()].find((slot) => slot.lane === 'roundup').token, null, 'slot released for a later run');

  world.roundupPlan = [writer()];
  const result = run(world, 'staging', '202610021100-roundupb');
  assert.equal(result.success, true);
  const [attempt] = attemptsOf(world, 'roundup');
  assert.equal(attempt.outcome, 'consumed');
  assert.equal(attempt.topic_key, SLUG);
  assert.equal(attempt.intent_fingerprint, roundupPackDigest({ items: [item('a'), item('b')] }));
  assert.equal(attempt.source_pack_digest, attempt.intent_fingerprint);
  const [submit] = submitCalls(world);
  assert.deepEqual([submit[submit.indexOf('--kind') + 1], submit[submit.indexOf('--idempotency-key') + 1]], ['roundup', attempt.idempotency_key]);
  assert.ok(submit[submit.indexOf('--roundup-out') + 1].startsWith(world.stateRoot));
  const writerCall = world.sources.find((entry) => entry.script === 'scripts/news-pilot/roundup-run.mjs');
  assert.ok(writerCall.args.includes(`--now=${WED.toISOString()}`), 'writer gets the injected clock');
  assert.ok(writerCall.args.includes(`--root=${world.repo}`));
});

test('second roundup run in the same week is a no-op; a pending one resumes the same key without a second candidate', (t) => {
  const world = withWorld(t);
  world.roundupPlan = [writer()];
  world.gatePlan = ['pending'];
  world.deployCode = 3;
  assert.throws(() => run(world), /publish or propagation pending/);
  const [open] = attemptsOf(world, 'roundup');
  assert.equal(open.outcome, 'published');
  world.deployCode = 0;
  assert.equal(run(world, 'staging', '202610021100-roundupc').success, true);
  assert.equal(world.sources.filter((entry) => entry.script === 'scripts/news-pilot/roundup-run.mjs').length, 1, 'no second writer run');
  assert.equal(submitCalls(world).length, 1);
  assert.equal(attemptsOf(world, 'roundup').length, 1);
  assert.equal(attemptsOf(world, 'roundup')[0].idempotency_key, open.idempotency_key);
  assert.deepEqual(run(world, 'staging', '202610041600-roundupd'), { cadenceMet: true, noChanges: true });
  assert.equal(submitCalls(world).length, 1);
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
  'malformed pack.json': writer({ mutate: (bag) => { bag.pack = { items: 'x' }; } }),
  'packDigest mismatch': writer({ mutate: (bag) => { bag.result.packDigest = 'e'.repeat(64); } }),
  'slug mismatch': writer({ mutate: (bag) => { bag.result.slug = 'liberty-village-news-week-2026-w41'; bag.posts.at(-1).slug = bag.result.slug; } }),
  'ISO week mismatch': writer({ mutate: (bag) => { bag.result.isoWeek = '2026-W41'; } }),
  'more than one new post': writer({ mutate: (bag) => { bag.posts.push({ slug: 'second-new-post', title: 'Second', category: 'news' }); } }),
  'post not category news': writer({ mutate: (bag) => { bag.posts.at(-1).category = 'lifestyle'; } }),
  'inconsistent zero: published 0 with a new post': writer({ mutate: (bag) => { bag.result.published = 0; bag.result.decision = 'hold'; bag.pack.items = []; bag.result.packDigest = roundupPackDigest(bag.pack); } }),
  'published without a post': writer({ mutate: (bag) => { bag.posts.pop(); } }),
  'items empty but published': writer({ mutate: (bag) => { bag.pack.items = []; bag.result.packDigest = roundupPackDigest(bag.pack); } }),
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
  assert.equal(world.sources.filter((entry) => entry.script === 'scripts/news-pilot/roundup-run.mjs').length, 1, 'no second writer run');
  const keys = submitCalls(world).map((args) => args[args.indexOf('--idempotency-key') + 1]);
  assert.deepEqual(keys, [open.idempotency_key, open.idempotency_key]);
});

test('F1 roundup smoked but not current-live is an honest failure, not success', (t) => {
  const world = withWorld(t);
  world.roundupPlan = [writer()];
  world.gatePlan = ['not-live'];
  assert.throws(() => run(world), /smoked but not counted for week/);
  assert.equal(attemptsOf(world, 'roundup')[0].outcome, 'smoked');
});

test('F1 a consumed roundup slot whose item is no longer live fails for operator review instead of noChanges', (t) => {
  const world = withWorld(t);
  world.roundupPlan = [writer()];
  assert.equal(run(world).success, true);
  world.live.clear();
  assert.throws(() => run(world, 'staging', '202610021100-roundupf'), /roundup consumed but no longer live/);
  assert.equal(submitCalls(world).length, 1, 'no second candidate');
});

test('F4 weekly-roundup also evaluates the prior week and records both missed alerts once', (t) => {
  const world = withWorld(t);
  world.roundupPlan = [writer({ items: [] }), writer({ items: [] })];
  run(world);
  run(world, 'staging', '202610021100-roundupg');
  assert.deepEqual([...world.alerts.values()].map((alert) => alert.kind), ['WEEKLY_CONTENT_MISSED', 'WEEKLY_NEWS_MISSED']);
  assert.equal(world.deadlineCalls.length, 2);
});
