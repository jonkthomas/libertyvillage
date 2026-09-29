// weekly-blog cadence wiring against the in-memory cadence CLI fake. Real trusted
// helpers (topic-queue, blog-source-pack, cadence.weekStartUtc) are used; only the
// DB, generator and gate are faked.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { CADENCE, dayPolicy, runWeeklyBlog } from '../../ops/exedev-runner/runner.mjs';
import { BUSINESSES, FRI, SUN, TOPICS, WED, attemptsOf, createWorld, submitCalls } from './fake-cadence.mjs';

const run = (world, request = {}) => runWeeklyBlog({ target: 'staging', slot: '202609301100-testslot', request, deps: world.deps });
const withWorld = (t, options) => { const world = createWorld(options); t.after(() => world.cleanup()); return world; };
const events = (world, name) => world.logs.filter((entry) => entry.event === name);

test('day policy: Wed primary, Fri recovery, Sun final with reserves only on Sunday', () => {
  assert.deepEqual(dayPolicy(WED), { phase: 'primary', reserveAllowed: false });
  assert.deepEqual(dayPolicy(FRI), { phase: 'recovery', reserveAllowed: false });
  assert.deepEqual(dayPolicy(SUN), { phase: 'final', reserveAllowed: true });
});

test('two current-live content posts: no reservation, no generator spend', (t) => {
  const world = withWorld(t);
  for (const id of [1, 2]) {
    world.submissions.set(id, { id, kind: 'blog', key: `k${id}`, state: 'published', smokedAt: WED.toISOString(), slug: `p${id}` });
    world.live.add(id);
  }
  assert.deepEqual(run(world), { cadenceMet: true, noChanges: true, contentCount: 2 });
  assert.equal(world.generated.length, 0);
  assert.equal(world.calls.some((args) => args[1] === 'reserve'), false);
});

test('Wednesday fills slots 1 and 2 with distinct grounded intents; ungroundable pet premise never reaches the model', (t) => {
  const world = withWorld(t, { queue: [TOPICS.pet, TOPICS.happy, TOPICS.coffee] });
  const result = run(world);
  assert.equal(result.cadenceMet, true);
  assert.deepEqual(world.generated.map((entry) => entry.title), ['Liberty Village Happy Hour', 'Coffee Shops'], 'pet premise skipped before generator spend');
  const attempts = attemptsOf(world);
  assert.deepEqual(attempts.map((a) => [a.slot_number, a.ordinal, a.outcome]), [[1, 1, 'consumed'], [2, 1, 'consumed']]);
  assert.notEqual(attempts[0].intent_fingerprint, attempts[1].intent_fingerprint);
  assert.ok(events(world, 'intent-skipped').some((entry) => entry.reason === 'unsupported operational premise'));
  // Submit carries the attempt key and the TRUSTED pack, never the scratch sidecar.
  for (const [index, args] of submitCalls(world).entries()) {
    assert.equal(args[args.indexOf('--idempotency-key') + 1], attempts[index].idempotency_key);
    const packPath = args[args.indexOf('--source-pack') + 1];
    assert.ok(packPath.startsWith(world.stateRoot), 'pack file lives in trusted state, not scratch');
    assert.equal(JSON.parse(fs.readFileSync(packPath, 'utf8')).fingerprint, attempts[index].source_pack_digest);
  }
  assert.equal(fs.readdirSync(path.join(world.repo, 'tasks', 'auto-blog-runs')).filter((name) => name.endsWith('-source-pack.json')).length, 0, 'consumed sidecars removed');
});

test('restart after pending publication resumes the ORIGINAL idempotency key; no second draft', (t) => {
  const world = withWorld(t, { queue: [TOPICS.happy, TOPICS.coffee] });
  world.gatePlan = ['pending'];
  world.deployCode = 3;
  assert.throws(() => run(world), /publish or propagation pending/);
  const [first] = attemptsOf(world);
  assert.equal(first.outcome, 'published', 'attempt stays open');
  assert.deepEqual(attemptsOf(world).map((a) => [a.slot_number, a.outcome]), [[1, 'published'], [2, 'consumed']], 'slot 2 is independent; pending slot 1 is not replaced');
  world.deployCode = 0;
  const result = run(world);
  assert.equal(result.cadenceMet, true);
  const attempts = attemptsOf(world);
  assert.equal(attempts[0].idempotency_key, first.idempotency_key);
  assert.equal(attempts[0].outcome, 'consumed');
  assert.equal(attempts.filter((a) => a.slot_number === 1).length, 1, 'no new ordinal for the resumed slot');
  assert.ok(events(world, 'resume').length >= 1);
  assert.equal(world.generated.filter((entry) => entry.title === 'Liberty Village Happy Hour').length, 1, 'resumed topic is never regenerated');
});

test('crash before submit retries the SAME key and intent on the next run', (t) => {
  const world = withWorld(t, { queue: [TOPICS.happy, TOPICS.coffee] });
  world.submitPlan = ['network'];
  assert.throws(() => run(world), (error) => error.cliFailure?.reason === 'cli-network');
  const [open] = attemptsOf(world);
  assert.equal(open.outcome, null);
  assert.equal(open.submission_id, null);
  const result = run(world);
  assert.equal(result.cadenceMet, true);
  const slot1 = attemptsOf(world).filter((a) => a.slot_number === 1);
  assert.equal(slot1.length, 1, 'no next ordinal after crash-before-submit');
  assert.equal(slot1[0].idempotency_key, open.idempotency_key);
  const submits = submitCalls(world).map((args) => args[args.indexOf('--idempotency-key') + 1]);
  assert.deepEqual(submits.slice(0, 2), [open.idempotency_key, open.idempotency_key]);
  assert.deepEqual(world.generated.map((entry) => entry.title).slice(0, 2), ['Liberty Village Happy Hour', 'Liberty Village Happy Hour']);
});

test('gate reject (exit 2) records rejected and the NEXT distinct intent gets a new ordinal and key', (t) => {
  const world = withWorld(t, { queue: [TOPICS.happy, TOPICS.coffee, TOPICS.fitness] });
  world.gatePlan = ['reject'];
  run(world);
  const slot1 = attemptsOf(world).filter((a) => a.slot_number === 1);
  assert.deepEqual(slot1.map((a) => [a.ordinal, a.outcome]), [[1, 'rejected'], [2, 'consumed']]);
  assert.notEqual(slot1[0].idempotency_key, slot1[1].idempotency_key);
  assert.notEqual(slot1[0].intent_fingerprint, slot1[1].intent_fingerprint);
  assert.deepEqual(world.generated.map((entry) => entry.title), ['Liberty Village Happy Hour', 'Coffee Shops', 'Fitness Classes']);
});

test('generator no-post records failed-before-submit and advances to a distinct intent, never the same topic', (t) => {
  const world = withWorld(t, { queue: [TOPICS.happy, TOPICS.coffee, TOPICS.fitness] });
  world.generatorPlan = ['no-post'];
  run(world);
  const slot1 = attemptsOf(world).filter((a) => a.slot_number === 1);
  assert.deepEqual(slot1.map((a) => a.outcome), ['failed-before-submit', 'consumed']);
  assert.equal(world.generated.filter((entry) => entry.title === 'Liberty Village Happy Hour').length, 1);
  assert.equal(submitCalls(world).length, 2, 'no submit for the no-post attempt');
  assert.ok(events(world, 'cadence-attempt-failed').some((entry) => entry.reason === 'no-post'));
});

for (const plan of ['mismatch', 'tampered', 'symlink', 'no-sidecar']) {
  test(`malicious scratch sidecar (${plan}) never reaches submit`, (t) => {
    const world = withWorld(t, { queue: [TOPICS.happy, TOPICS.coffee, TOPICS.fitness] });
    world.generatorPlan = [plan];
    run(world);
    const slot1 = attemptsOf(world).filter((a) => a.slot_number === 1);
    assert.equal(slot1[0].outcome, 'failed-before-submit');
    assert.equal(slot1[0].submission_id, null);
    assert.equal(submitCalls(world).some((args) => args[args.indexOf('--idempotency-key') + 1] === slot1[0].idempotency_key), false);
    assert.ok(events(world, 'cadence-attempt-failed').some((entry) => entry.reason.startsWith('sidecar-')));
  });
}

test('reservation held by another runner: slot skipped, no attempt there, no replacement slot', (t) => {
  const world = withWorld(t, { queue: [TOPICS.happy, TOPICS.coffee] });
  world.heldByOther.add('2026-09-28|content|1');
  const result = run(world);
  assert.equal(result.cadenceMet, false);
  assert.deepEqual(attemptsOf(world).map((a) => a.slot_number), [2]);
  assert.equal(world.calls.some((args) => args[1] === 'reserve' && args.includes('3')), false, 'held slot counts as in flight');
  assert.deepEqual(events(world, 'cadence-slot-held').map((entry) => entry.holder), ['other']);
});

test('Sunday reserve intents: never Wednesday, only when normal intents are exhausted on Sunday', (t) => {
  const wednesday = withWorld(t, { queue: [TOPICS.pet, TOPICS.reserve] });
  assert.throws(() => run(wednesday), /cadence content deficit/);
  assert.equal(wednesday.generated.length, 0, 'no reserve and no ungroundable spend on Wednesday');
  assert.equal(attemptsOf(wednesday).length, 0);

  const sunday = withWorld(t, { now: SUN, queue: [TOPICS.pet, TOPICS.reserve] });
  assert.throws(() => run(sunday), /weekly content missed/, 'one reserve post is still a miss for the 2-post goal');
  const attempts = attemptsOf(sunday);
  assert.deepEqual(attempts.map((a) => [a.slot_number, a.topic_key, a.outcome]), [[1, 'reserve:k-reserve', 'consumed']]);
  assert.equal(sunday.generated.length, 1);
  assert.ok(events(sunday, 'weekly-content-miss').length === 1);
  assert.equal(sunday.deadlineCalls, 1, 'deadline evaluated (no-op before Monday)');
});

test('reserve intents are capped at two per week and need 3 records / 6 facts', (t) => {
  const world = withWorld(t, { now: SUN, queue: [TOPICS.reserve, { ...TOPICS.reserve, key: 'k-reserve-2', title: 'Cafes and Gyms Bars' }, { ...TOPICS.reserve, key: 'k-reserve-3', title: 'Gyms Bars and Cafes Nearby' }] });
  world.gatePlan = ['reject', 'reject', 'reject'];
  assert.throws(() => run(world), /weekly content missed/);
  assert.equal(attemptsOf(world).filter((a) => a.topic_key.startsWith('reserve:')).length, CADENCE.reservePerWeek);
  const thin = withWorld(t, { now: SUN, queue: [{ ...TOPICS.reserve, key: 'k-thin', title: 'Bars Nearby' }] });
  assert.throws(() => run(thin), /weekly content missed/);
  assert.equal(thin.generated.length, 0, 'two bar records cannot satisfy the 3-record reserve floor');
});

test('a fake smoke receipt in scratch never counts: only the trusted gate/DB smoke does', (t) => {
  const world = withWorld(t, { queue: [TOPICS.happy] });
  world.generatorPlan = ['fake-smoke'];
  world.gatePlan = ['reject'];
  assert.throws(() => run(world), /cadence content deficit/);
  assert.equal(attemptsOf(world)[0].outcome, 'rejected');
  assert.equal(world.live.size, 0);
  assert.equal(JSON.parse(world.cli(['cadence', 'count', '--week-start', '2026-09-28', '--target', 'staging']).stdout).contentCount, 0);
});

test('bounded spend: at most three normal intents per slot and four generations per run', (t) => {
  const many = ['a', 'b', 'c', 'd', 'e', 'f'].map((suffix, index) => ({ ...[TOPICS.happy, TOPICS.coffee, TOPICS.fitness][index % 3], key: `k-${suffix}`, title: `${['Happy Hour Deals', 'Coffee Roasters', 'Fitness Studios'][index % 3]} ${suffix.toUpperCase()}` }));
  const world = withWorld(t, { queue: many });
  world.gatePlan = Array(10).fill('reject');
  assert.throws(() => run(world), /cadence content deficit/);
  assert.ok(world.generated.length <= CADENCE.generationsPerRun);
  assert.ok(attemptsOf(world).filter((a) => a.slot_number === 1).length <= CADENCE.normalPerSlot);
});

test('consumed DB fingerprints from earlier weeks exclude a repeat intent (no local topic-state)', (t) => {
  const world = withWorld(t, { queue: [TOPICS.happy, TOPICS.coffee, TOPICS.fitness] });
  world.attempts.push({ target: 'staging', week_start_utc: '2026-09-21', lane: 'content', slot_number: 1, ordinal: 1, intent_fingerprint: 'happy hour', topic_key: 'k-happy', idempotency_key: 'cadence:old', source_pack_digest: 'x', submission_id: 9, outcome: 'consumed' });
  run(world);
  assert.deepEqual(world.generated.map((entry) => entry.title), ['Coffee Shops', 'Fitness Classes']);
  assert.equal(fs.existsSync(path.join(world.stateRoot, 'topic-state.json')), false);
});

test('Sunday with the goal already met is a no-op', (t) => {
  const world = withWorld(t, { now: SUN });
  for (const id of [1, 2]) { world.submissions.set(id, { id, kind: 'blog', key: `k${id}`, state: 'published', smokedAt: WED.toISOString(), slug: `p${id}` }); world.live.add(id); }
  assert.equal(run(world).cadenceMet, true);
  assert.equal(world.deadlineCalls, 0);
  assert.equal(BUSINESSES.length, 6);
});
