import test from 'node:test';
import assert from 'node:assert/strict';
import { CADENCE, runWeeklyBlog, runOctoberBackfill } from '../../ops/exedev-runner/runner.mjs';
import { createWorld, attemptsOf, TOPICS, FRI, topic, submitCalls } from './fake-cadence.mjs';

const queue = () => [TOPICS.happy, TOPICS.coffee, TOPICS.fitness,
  topic('k-bakery', 'Bakery in Liberty Village'), topic('k-salon', 'Salon in Liberty Village')];
const worldFor = (t, options = {}) => {
  const world = createWorld({ now: FRI, queue: queue(), ...options });
  t.after(() => world.cleanup());
  return world;
};
const weekly = (world) => runWeeklyBlog({ target: 'staging', slot: 'local-refusal-continue', deps: world.deps });
const backfill = (world) => runOctoberBackfill({ target: 'staging', slot: 'local-refusal-backfill', deps: world.deps });

test('weekly slot 2 refusal continues after a declined evidence claim on an on-demand run', (t) => {
  const world = worldFor(t, { now: new Date('2026-10-24T02:03:00Z') });
  world.generatorPlan = ['ok', 'refusal', 'ok'];
  const cli = world.deps.cli;
  world.deps.cli = (args, ...rest) => args[0] === 'cadence' && args[1] === 'evidence-claim'
    ? { code: 0, stdout: JSON.stringify({ claimed: false }) } : cli(args, ...rest);
  assert.equal(weekly(world).cadenceMet, true);
  assert.equal(world.generated.length, 3);
  assert.deepEqual(attemptsOf(world).map((a) => [a.slot_number, a.ordinal, a.outcome]), [
    [1, 1, 'consumed'], [2, 1, 'failed-before-submit'], [2, 2, 'consumed'],
  ]);
  assert.equal(world.live.size, 2);
});

test('weekly slot 2 refusal continues when the evidence pass closes without discovery', (t) => {
  const world = worldFor(t);
  world.generatorPlan = ['ok', 'refusal', 'ok'];
  world.deps.discoverEvidence = () => ({ state: 'empty' });
  assert.equal(weekly(world).cadenceMet, true);
  assert.equal(world.generated.length, 3);
  assert.equal(world.live.size, 2);
  assert.ok([...world.evidence.values()].every((item) => item.state === 'closed'));
});

test('weekly refusals continue to candidate 3 and charge every generation to the run budget', (t) => {
  const world = worldFor(t);
  world.generatorPlan = ['refusal', 'refusal', 'ok'];
  assert.equal(weekly(world).cadenceMet, true);
  assert.deepEqual(world.generated.map((item) => item.title), queue().slice(0, 4).map((item) => item.title));
  assert.ok(world.generated.length <= CADENCE.generationsPerRun);
  assert.deepEqual(attemptsOf(world).map((a) => [a.slot_number, a.ordinal, a.outcome]), [
    [1, 1, 'failed-before-submit'], [1, 2, 'failed-before-submit'], [1, 3, 'consumed'], [2, 1, 'consumed'],
  ]);
  assert.equal(submitCalls(world).length, 2, 'only grounded candidates 3 and 4 are submitted');
  assert.equal(world.live.size, 2);
  assert.equal(world.evidence.size, 1, 'no second evidence entitlement after the first closes');
});

test('weekly all-refuse exhausts the run budget and the three-normal-attempt slot cap', (t) => {
  const world = worldFor(t);
  world.generatorPlan = Array(queue().length).fill('refusal');
  assert.throws(() => weekly(world), /cadence content deficit/);
  assert.equal(world.generated.length, CADENCE.generationsPerRun);
  assert.deepEqual(attemptsOf(world).map((a) => [a.slot_number, a.ordinal]), [[1, 1], [1, 2], [1, 3], [2, 1]]);
  assert.ok(attemptsOf(world).every((a) => a.outcome === 'failed-before-submit'));
  assert.equal(submitCalls(world).length, 0);
  assert.equal(world.evidence.size, 1);
  assert.ok(world.logs.some((entry) => entry.event === 'cadence-slot-exhausted' && entry.budget === 0), 'refusals decrement the shared budget to zero');
});

test('weekly pre-submit pack refusal continues after the evidence pass closes', (t) => {
  const world = worldFor(t, { queue: queue().slice(0, 3) });
  world.generatorPlan = ['refusal', 'unrelated', 'ok'];
  assert.throws(() => weekly(world), /cadence content deficit/);
  assert.equal(world.generated.length, 3);
  assert.deepEqual(attemptsOf(world).map((a) => a.outcome), ['failed-before-submit', 'failed-before-submit', 'consumed']);
  assert.ok(world.logs.some((entry) => entry.event === 'cadence-attempt-failed' && entry.reason === 'draft-unbound'));
  assert.equal(submitCalls(world).length, 1);
});

test('backfill grounded refusal ends the run; the next day can publish the same label', (t) => {
  const world = worldFor(t, { now: new Date('2026-10-23T15:37:00Z') });
  world.generatorPlan = ['refusal', 'ok'];
  world.deps.discoverEvidence = () => assert.fail('backfill must not enter weekly evidence discovery');
  assert.throws(() => backfill(world), /backfill publication incomplete/);
  assert.equal(world.generated.length, 1, 'a refusal ends the daily run before another candidate');
  assert.deepEqual(attemptsOf(world).map((a) => [a.slot_number, a.ordinal, a.outcome]), [
    [101, 1, 'failed-before-submit'],
  ]);
  assert.equal(submitCalls(world).length, 0);
  assert.equal(world.logs.some((entry) => entry.event === 'october-backfill-exhausted'), false);
  assert.equal(world.evidence.size, 0);

  world.now = new Date('2026-10-24T15:37:00Z');
  assert.equal(backfill(world).reason, 'october-backfill-published');
  assert.deepEqual(attemptsOf(world).map((a) => [a.slot_number, a.ordinal, a.outcome]), [
    [101, 1, 'failed-before-submit'], [101, 2, 'late-smoked'],
  ]);
  assert.equal(world.generated.length, 2, 'the historical label survived the transient refusal');
  assert.equal(world.evidence.size, 0, 'backfill has no evidence-retry path');
  assert.equal(backfill(world).reason, 'october-backfill-wait');
  assert.equal(world.generated.length, 2, 'same UTC date cannot generate a second post');
});

test('backfill all-refuse spends one attempt per daily run without exhausting the label', (t) => {
  const world = worldFor(t, { now: new Date('2026-10-23T15:37:00Z') });
  world.generatorPlan = Array(queue().length).fill('refusal');
  for (const [index, day] of ['2026-10-23', '2026-10-24'].entries()) {
    world.now = new Date(`${day}T15:37:00Z`);
    assert.throws(() => backfill(world), /backfill publication incomplete/);
    assert.equal(world.generated.length, index + 1, 'only one generation spent per scheduled day');
    assert.ok(attemptsOf(world).every((a) => a.slot_number === 101 && a.outcome === 'failed-before-submit'));
    assert.equal(world.logs.some((entry) => entry.event === 'october-backfill-exhausted'), false);
  }
  assert.deepEqual(attemptsOf(world).map((a) => [a.slot_number, a.ordinal]), [[101, 1], [101, 2]]);
  assert.equal(world.evidence.size, 0);
  assert.equal(submitCalls(world).length, 0);
});
