// weekly-blog cadence wiring against the in-memory cadence CLI fake. Real trusted
// helpers (topic-queue, blog-source-pack, cadence.weekStartUtc) are used; only the
// DB, generator and gate are faked.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CADENCE, claimWeeklyInventoryDiscovery, dayPolicy, reservePack, runWeeklyBlog, parseGeneratorDiagnostic, parseDiscoveryOutcome, readGeneratorRelay, runScopedEvidenceSource, gateEvidenceSubmission, command } from '../../ops/exedev-runner/runner.mjs';
import { BUSINESSES, FRI, SUN, TOPICS, WED, attemptsOf, createWorld, modules, submitCalls, topic } from './fake-cadence.mjs';

const run = (world, request = {}) => runWeeklyBlog({ target: 'staging', slot: '202609301100-testslot', request, deps: world.deps });
const withWorld = (t, options) => { const world = createWorld(options); t.after(() => world.cleanup()); return world; };
const events = (world, name) => world.logs.filter((entry) => entry.event === name);

test('only one bounded helper diagnostic can authorize a refusal', () => {
  assert.deepEqual(parseGeneratorDiagnostic('{"postWritten":false,"stopReason":"insufficient-sources"}\n'), { postWritten: false, stopReason: 'insufficient-sources' });
  assert.deepEqual(readGeneratorRelay({ code: 1, stdout: '{"postWritten":false,"stopReason":"insufficient-sources"}\n' }).stopReason, 'insufficient-sources');
  const helperExit = command(process.execPath, ['-e', 'process.stdout.write(JSON.stringify({postWritten:false,stopReason:"unsupported-grounding"})+"\\n");process.exitCode=1'], { allowExit: [1] });
  assert.equal(helperExit.code, 1);
  assert.equal(readGeneratorRelay(helperExit).stopReason, 'unsupported-grounding');
  assert.deepEqual(readGeneratorRelay({ code: 0, stdout: '{"postWritten":true,"stopReason":"post-written"}\n' }).postWritten, true);
  assert.throws(() => readGeneratorRelay({ code: 0, stdout: '{"postWritten":false,"stopReason":"insufficient-sources"}\n' }), /unavailable/);
  assert.throws(() => readGeneratorRelay({ code: 1, stdout: '{"postWritten":false,"stopReason":"absent"}\n' }), /unavailable/);
  assert.throws(() => readGeneratorRelay({ code: 1, stdout: '{"postWritten":false,"stopReason":"sdk-error"}\n' }), /technical failure/);
  for (const value of ['', '{}\n', '{"postWritten":false,"stopReason":"sdk-error"}\nextra',
    '{"postWritten":false,"stopReason":"insufficient-sources","extra":1}\n',
    '{"postWritten":false,"stopReason":"insufficient-sources"}']) assert.equal(parseGeneratorDiagnostic(value), null);
  assert.deepEqual(parseDiscoveryOutcome('{"outcome":"empty","category":"bars","mapsRequests":1}\n', 'bars').outcome, 'empty');
  assert.throws(() => parseDiscoveryOutcome('{"outcome":"empty","category":"bars","mapsRequests":2}\n', 'bars'));
  assert.throws(() => runScopedEvidenceSource('bars', null, (_binary, args, options) => {
    assert.deepEqual(args, ['scripts/discover-businesses.mjs', '--category=bars', '--max=3']);
    assert.equal(options.env.CONTENT_DATABASE_URL, undefined);
    return command(process.execPath, ['-e', 'process.stdout.write(JSON.stringify({outcome:"maps-unavailable",category:"bars",mapsRequests:1})+"\\n");process.exitCode=3'], { allowExit: options.allowExit });
  }), /Maps discovery unavailable/);
});

test('business discovery terminal error closes evidence, but operational exit 1 stays pending', () => {
  const id = 42;
  const actor = 'runner:weekly-blog-evidence#test';
  const calls = [];
  const terminal = (args, allowExit) => {
    calls.push(args[0]);
    if (args[0] === 'gate') {
      assert.deepEqual(allowExit, [1, 2, 3]);
      return { code: 1, stdout: JSON.stringify({ submissionId: id, state: 'error', decision: 'error', notified: true }) };
    }
    if (args[0] === 'show') return { code: 0, stdout: JSON.stringify({ submission: { state: 'error' } }) };
    throw new Error(`unexpected ${args[0]}`);
  };
  assert.deepEqual(gateEvidenceSubmission(id, 'staging', actor, terminal), { state: 'empty' });
  assert.deepEqual(calls, ['gate', 'show'], 'only a durable, notified terminal receipt may end the entitlement');
  for (const invalid of [
    { submissionId: id, state: 'error', decision: 'error', notified: false },
    { submissionId: id + 1, state: 'error', decision: 'error', notified: true },
    { submissionId: id, state: 'error', decision: 'error', notified: true, error: 'transport failure' },
  ]) {
    const operational = () => ({ code: 1, stdout: JSON.stringify(invalid) });
    assert.throws(() => gateEvidenceSubmission(id, 'staging', actor, operational), /content gate failed/);
  }
  assert.deepEqual(gateEvidenceSubmission(id, 'staging', actor, (args) => args[0] === 'gate'
    ? { code: 2, stdout: '{}' }
    : { code: 0, stdout: JSON.stringify({ submission: { state: 'compensated' } }) }), { state: 'empty' });
});

const bar = (slug) => ({ slug, name: slug, category: 'bars', description: 'A neighbourhood bar with a daily happy hour.', address: '10 Liberty Street, Toronto', hours: 'Mon-Sun 9am-9pm', phone: '416-555-0000', website: `https://${slug}.example` });

test('grounded refusal spends one entitlement, releases old lease, retries same topic in unused slot with new digest', (t) => {
  const world = withWorld(t, { queue: [TOPICS.happy], businesses: [bar('bar-a'), bar('bar-b')] });
  world.generatorPlan = ['refusal', 'ok'];
  let discoveryCalls = 0;
  world.deps.discoverEvidence = (_evidence, category) => {
    discoveryCalls++;
    assert.equal(category, 'bars');
    assert.equal([...world.slots.values()].every((slot) => slot.token == null), true);
    world.businesses.push(bar('bar-c'));
    return { state: 'smoked', verifiedSlugs: ['bar-c'] };
  };
  assert.throws(() => run(world), /cadence content deficit/);
  const attempts = attemptsOf(world).filter((a) => a.intent_fingerprint === attemptsOf(world)[0].intent_fingerprint);
  assert.equal(discoveryCalls, 1);
  assert.deepEqual(attempts.map((a) => [a.slot_number, a.outcome]), [[1, 'failed-before-submit'], [2, 'consumed']]);
  assert.notEqual(attempts[0].idempotency_key, attempts[1].idempotency_key);
  assert.notEqual(attempts[0].source_pack_digest, attempts[1].source_pack_digest);
  assert.equal(world.generated.length, 2);
  assert.throws(() => run(world), /cadence content deficit/);
  assert.equal(discoveryCalls, 1);
});

test('empty evidence pass and second refusal close topic for this week', (t) => {
  const world = withWorld(t, { queue: [TOPICS.happy], businesses: [bar('bar-a'), bar('bar-b')] });
  world.generatorPlan = ['refusal', 'refusal'];
  world.deps.discoverEvidence = () => { world.businesses.push(bar('bar-c')); return { state: 'smoked', verifiedSlugs: ['bar-c'] }; };
  assert.throws(() => run(world), /cadence content deficit/);
  assert.deepEqual(attemptsOf(world).map((a) => a.outcome), ['failed-before-submit', 'failed-before-submit']);
  assert.equal(world.evidence.size, 1);
  assert.equal([...world.evidence.values()][0].state, 'closed');
  const generated = world.generated.length;
  assert.throws(() => run(world), /cadence content deficit/);
  assert.equal(world.generated.length, generated);
});

test('empty or unchanged discovery never spends a second generation', (t) => {
  for (const outcome of ['empty', 'unchanged']) {
    const world = withWorld(t, { queue: [TOPICS.happy], businesses: [bar('bar-a'), bar('bar-b')] });
    world.generatorPlan = ['refusal'];
    world.deps.discoverEvidence = () => outcome === 'empty' ? { state: 'empty' } : { state: 'smoked', verifiedSlugs: ['bar-a'] };
    assert.throws(() => run(world), /cadence content deficit/);
    assert.equal(world.generated.length, 1);
    assert.equal(attemptsOf(world).length, 1);
    assert.equal([...world.evidence.values()][0].state, 'closed');
  }
});

test('source outage stays operational and a restart does not repeat ambiguous discovery', (t) => {
  const world = withWorld(t, { queue: [TOPICS.happy], businesses: [bar('bar-a'), bar('bar-b')] });
  world.generatorPlan = ['refusal'];
  let sourceCalls = 0;
  world.deps.discoverEvidence = () => { sourceCalls++; throw new Error('Maps unavailable'); };
  assert.throws(() => run(world), /Maps unavailable/);
  assert.equal([...world.evidence.values()][0].state, 'pending');
  world.deps.discoverEvidence = (_evidence, _category, allowSource) => { assert.equal(allowSource, false); return { state: 'empty' }; };
  assert.throws(() => run(world), /cadence content deficit/);
  assert.equal(sourceCalls, 1);
  assert.equal(world.generated.length, 1);
});

test('pending discovery resumes without a second source call and can use slot 3', (t) => {
  const world = withWorld(t, { queue: [TOPICS.happy], businesses: [bar('bar-a'), bar('bar-b')] });
  world.generatorPlan = ['refusal', 'ok'];
  let discoveryCalls = 0;
  world.deps.discoverEvidence = (_evidence, _category, allowSource) => {
    discoveryCalls++;
    if (allowSource) return { state: 'pending' };
    world.businesses.push(bar('bar-c'));
    return { state: 'smoked', verifiedSlugs: ['bar-c'] };
  };
  assert.throws(() => run(world), /publish or propagation pending/);
  // A distinct intent already used slot 2 while the discovery was pending.
  world.attempts.push({ target: 'staging', week_start_utc: '2026-09-28', lane: 'content', slot_number: 2,
    ordinal: 1, intent_fingerprint: 'other-intent', topic_key: 'other', idempotency_key: 'other-key', source_pack_digest: 'other-pack', outcome: 'rejected', submission_id: null });
  assert.throws(() => run(world), /cadence content deficit/);
  assert.equal(discoveryCalls, 2);
  assert.deepEqual(attemptsOf(world).filter((a) => a.intent_fingerprint !== 'other-intent').map((a) => a.slot_number), [1, 3]);
});

test('prior-week pending evidence is looked up without source replay and does not ban the next ISO week', (t) => {
  const world = withWorld(t, { now: SUN, queue: [TOPICS.happy], businesses: [bar('bar-a'), bar('bar-b')] });
  world.generatorPlan = ['refusal'];
  world.deps.discoverEvidence = (_evidence, _category, allowSource) => allowSource ? { state: 'pending' } : { state: 'pending' };
  assert.throws(() => run(world), /publish or propagation pending/);
  world.now = new Date('2026-10-05T12:30:00.000Z');
  assert.throws(() => run(world), /prior evidence publication pending/);
  world.deps.discoverEvidence = (_evidence, _category, allowSource) => { assert.equal(allowSource, false); return { state: 'empty' }; };
  assert.throws(() => run(world), /cadence content deficit/);
  assert.equal([...world.evidence.values()][0].state, 'closed');
  assert.equal(attemptsOf(world).some((item) => item.week_start_utc === '2026-10-05' && item.intent_fingerprint === attemptsOf(world)[0].intent_fingerprint), true);
});

test('linked retry pending in slot 3 resumes its original key after restart', (t) => {
  const world = withWorld(t, { queue: [TOPICS.happy], businesses: [bar('bar-a'), bar('bar-b')] });
  world.generatorPlan = ['refusal', 'ok'];
  world.gatePlan = ['pending'];
  world.deployCode = 3;
  world.deps.discoverEvidence = () => {
    world.businesses.push(bar('bar-c'));
    world.attempts.push({ target: 'staging', week_start_utc: '2026-09-28', lane: 'content', slot_number: 2,
      ordinal: 1, intent_fingerprint: 'other-intent', topic_key: 'other', idempotency_key: 'other-key', source_pack_digest: 'other-pack', outcome: 'rejected', submission_id: null });
    return { state: 'smoked', verifiedSlugs: ['bar-c'] };
  };
  assert.throws(() => run(world), /publish or propagation pending/);
  const retry = attemptsOf(world).find((item) => item.slot_number === 3);
  assert.equal(retry.outcome, 'published');
  world.deployCode = 0;
  assert.throws(() => run(world), /cadence content deficit/);
  assert.equal(retry.outcome, 'consumed');
  assert.equal(world.generated.length, 2);
  assert.equal(attemptsOf(world).filter((item) => item.idempotency_key === retry.idempotency_key).length, 1);
});

test('prior-week linked retry in slot 4 is reconciled under its old key', (t) => {
  const world = withWorld(t, { now: new Date('2026-10-05T12:30:00.000Z'), queue: [] });
  const old = { target: 'staging', week_start_utc: '2026-09-28', lane: 'content', slot_number: 4,
    ordinal: 1, intent_fingerprint: 'old-bars', topic_key: 'bars-title', idempotency_key: 'old-retry-key',
    source_pack_digest: 'new-pack', outcome: 'published', submission_id: 900 };
  world.attempts.push(old);
  world.submissions.set(900, { id: 900, kind: 'blog', key: old.idempotency_key, state: 'published', smokedAt: null, slug: 'old-bars-post' });
  assert.throws(() => run(world), /cadence content deficit/);
  assert.equal(old.outcome, 'late-smoked');
  assert.equal(world.generated.length, 0);
  assert.ok(world.calls.some((args) => args[0] === 'lookup' && args.includes(old.idempotency_key)));
});

test('no unused slot expires retry without raising the slot or generation cap', (t) => {
  const world = withWorld(t, { queue: [TOPICS.happy], businesses: [bar('bar-a'), bar('bar-b')] });
  world.generatorPlan = ['refusal'];
  world.deps.discoverEvidence = () => {
    world.businesses.push(bar('bar-c'));
    for (const n of [2, 3, 4]) world.attempts.push({ target: 'staging', week_start_utc: '2026-09-28', lane: 'content', slot_number: n,
      ordinal: 1, intent_fingerprint: `other-${n}`, topic_key: `other-${n}`, idempotency_key: `other-key-${n}`,
      source_pack_digest: 'other-pack', outcome: 'rejected', submission_id: null });
    return { state: 'smoked', verifiedSlugs: ['bar-c'] };
  };
  assert.throws(() => run(world), /cadence content deficit/);
  assert.equal(world.generated.length, 1);
  assert.equal([...world.evidence.values()][0].state, 'closed');
  assert.equal(attemptsOf(world).filter((item) => item.intent_fingerprint === attemptsOf(world)[0].intent_fingerprint).length, 1);
});

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

test('eligible inventory, not queue length, triggers bounded discovery before first generator spend', (t) => {
  const world = withWorld(t, { queue: [TOPICS.pet] });
  const calls = [];
  world.deps.replenish = (week) => { calls.push(week); world.queue.push(TOPICS.happy, TOPICS.coffee); };
  const result = run(world);
  assert.equal(result.cadenceMet, true);
  assert.deepEqual(calls, ['2026-09-28']);
  assert.deepEqual(world.generated.map((entry) => entry.title), ['Liberty Village Happy Hour', 'Coffee Shops']);
  assert.ok(events(world, 'cadence-inventory').some((event) => event.normal === 0 && event.low));
  assert.ok(events(world, 'cadence-inventory-recheck').some((event) => event.normal === 2 && event.low));
});

test('eligible normal inventory excludes intents also counted as disjoint reserves', (t) => {
  const world = withWorld(t, { queue: [TOPICS.happy, TOPICS.coffee, topic('k-bakery', 'Bakery in Liberty Village'), topic('k-salon', 'Salon in Liberty Village')] });
  run(world);
  const inventory = events(world, 'cadence-inventory')[0];
  assert.equal(inventory.reserve, 2);
  assert.equal(inventory.normal, 2, 'bakery/salon cannot satisfy both the normal and reserve floors');
  assert.equal(inventory.low, true);
});

test('weekly discovery claim survives empty results, retries, and target/week boundaries', (t) => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-inventory-claim-'));
  t.after(() => fs.rmSync(stateRoot, { recursive: true, force: true }));
  assert.equal(claimWeeklyInventoryDiscovery(stateRoot, 'staging', '2026-09-28'), true);
  assert.equal(claimWeeklyInventoryDiscovery(stateRoot, 'staging', '2026-09-28'), false, 'no-submission discovery is still spent');
  assert.equal(claimWeeklyInventoryDiscovery(stateRoot, 'staging', '2026-10-05'), true);
  assert.equal(claimWeeklyInventoryDiscovery(stateRoot, 'production', '2026-09-28'), true);
  assert.throws(() => claimWeeklyInventoryDiscovery(stateRoot, '../production', '2026-09-28'), /invalid inventory claim/);
});

test('discovery failure logs inventory deficit but does not discard already grounded candidates', (t) => {
  const world = withWorld(t, { queue: [TOPICS.happy, TOPICS.coffee] });
  world.deps.replenish = () => { throw new Error('discovery unavailable'); };
  assert.equal(run(world).cadenceMet, true);
  assert.deepEqual(world.generated.map((entry) => entry.title), ['Liberty Village Happy Hour', 'Coffee Shops']);
  assert.equal(events(world, 'cadence-inventory-replenish-failed').length, 1);
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

test('Sunday pending blog resumes its original key on Monday before any new-week draft', (t) => {
  const world = withWorld(t, { now: SUN, queue: [TOPICS.happy, TOPICS.coffee, TOPICS.fitness] });
  world.gatePlan = ['pending'];
  world.deployCode = 3;
  assert.throws(() => run(world), /publish or propagation pending/);
  const [old] = attemptsOf(world);
  assert.equal(old.outcome, 'published');
  world.now = new Date('2026-10-05T12:30:00.000Z');
  world.deployCode = 0;
  const result = run(world);
  assert.equal(result.cadenceMet, true);
  assert.equal(old.outcome, 'late-smoked');
  assert.equal(world.generated.filter((item) => item.title === 'Liberty Village Happy Hour').length, 1);
  assert.equal(attemptsOf(world).filter((item) => item.week_start_utc === '2026-10-05').some((item) => item.intent_fingerprint === old.intent_fingerprint), false);
  assert.ok(world.calls.some((args) => args[0] === 'lookup' && args.includes(old.idempotency_key)));
  assert.equal(events(world, 'cadence-smoked-uncounted').some((entry) => entry.id === old.submission_id && entry.late), true);
  assert.ok(world.alerts.has('2026-09-28|WEEKLY_CONTENT_MISSED'));
  assert.equal(result.contentCount, 2, 'late smoke counts only in the actual week');
});

test('gate terminal error closes its attempt and allows a distinct next intent', (t) => {
  const world = withWorld(t, { queue: [TOPICS.happy, TOPICS.coffee, TOPICS.fitness] });
  world.gatePlan = ['error'];
  run(world);
  const first = attemptsOf(world)[0];
  assert.equal(first.outcome, 'error');
  assert.equal(world.submissions.get(first.submission_id).state, 'error');
  assert.ok(attemptsOf(world).some((attempt) => attempt.outcome === 'consumed'));
});

test('gate operational exit 1 does not close an open submission', (t) => {
  const world = withWorld(t, { queue: [TOPICS.happy, TOPICS.coffee] });
  world.gatePlan = ['operational'];
  assert.throws(() => run(world), (error) => error.cliFailure?.reason === 'cli-operation');
  const [first] = attemptsOf(world);
  assert.equal(first.outcome, null);
  assert.equal(world.submissions.get(first.submission_id).state, 'open');
});

test('gate exit 1 notification failure preserves server retry class and original attempt', (t) => {
  const world = withWorld(t, { queue: [TOPICS.happy, TOPICS.coffee] });
  world.gatePlan = ['notify-fail'];
  assert.throws(() => run(world), (error) => error.cliFailure?.reason === 'cli-server' && error.cliFailure?.action === 'retry-original-slot');
  const [first] = attemptsOf(world);
  assert.equal(first.outcome, null, 'terminal submission is not settled while notification failed');
  assert.equal(world.submissions.get(first.submission_id).state, 'error');
  assert.throws(() => run(world), /cadence content deficit/); // webhook recovered; terminal receipt settles before new attempts
  assert.equal(first.outcome, 'error');
  assert.equal(attemptsOf(world).filter((attempt) => attempt.idempotency_key === first.idempotency_key).length, 1);
});

test('Monday recovery settles a Sunday gate error under the original key', (t) => {
  const world = withWorld(t, { now: SUN, queue: [TOPICS.happy, TOPICS.coffee, TOPICS.fitness] });
  world.gatePlan = ['pending'];
  world.deployCode = 3;
  assert.throws(() => run(world), /publish or propagation pending/);
  const [old] = attemptsOf(world);
  world.submissions.get(old.submission_id).state = 'error'; // gate recorded an error before runner could settle it
  world.now = new Date('2026-10-05T12:30:00.000Z');
  world.deployCode = 0;
  run(world);
  assert.equal(old.outcome, 'error');
  assert.equal(attemptsOf(world).filter((attempt) => attempt.idempotency_key === old.idempotency_key).length, 1);
  assert.ok(attemptsOf(world).filter((attempt) => attempt.week_start_utc === '2026-10-05').every((attempt) => attempt.idempotency_key !== old.idempotency_key), 'new week uses distinct keys only after old terminal settlement');
  const lookupIndex = world.calls.findIndex((args) => args[0] === 'lookup' && args.includes(old.idempotency_key));
  const newSubmitIndex = world.calls.findIndex((args) => args[0] === 'submit' && args.includes('20261005'));
  assert.ok(lookupIndex >= 0 && (newSubmitIndex < 0 || lookupIndex < newSubmitIndex));
  assert.ok(world.alerts.has('2026-09-28|WEEKLY_CONTENT_MISSED'));
});

test('Sunday crash before submit is reconciled under its old key before Monday candidates', (t) => {
  const world = withWorld(t, { now: SUN, queue: [TOPICS.happy, TOPICS.coffee] });
  world.submitPlan = ['network'];
  assert.throws(() => run(world), (error) => error.cliFailure?.reason === 'cli-network');
  const [old] = attemptsOf(world);
  world.now = new Date('2026-10-05T12:30:00.000Z');
  const result = run(world);
  assert.equal(result.cadenceMet, true);
  assert.equal(attemptsOf(world).filter((a) => a.intent_fingerprint === old.intent_fingerprint).length, 1);
  assert.equal(attemptsOf(world).filter((a) => a.week_start_utc === '2026-10-05' && a.intent_fingerprint === old.intent_fingerprint).length, 0);
  assert.equal(world.generated.filter((entry) => entry.title === 'Liberty Village Happy Hour').length, 2, 'one same-key retry, never a new-week redraft');
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
  assert.throws(() => run(world), /cadence content deficit/, 'one post is still a deficit');
  assert.deepEqual(attemptsOf(world).map((a) => a.slot_number), [2]);
  assert.equal(world.calls.some((args) => args[1] === 'reserve' && args.includes('3')), false, 'held slot counts as in flight');
  assert.deepEqual(events(world, 'cadence-slot-held').map((entry) => entry.holder), ['other']);
});

test('F5 Sunday reserves are derived from the directory (real queue shape, no reserve flag) and never run on Wednesday', (t) => {
  const wednesday = withWorld(t, { queue: [TOPICS.pet] });
  assert.throws(() => run(wednesday), /cadence content deficit/);
  assert.equal(wednesday.generated.length, 0, 'no reserve and no ungroundable spend on Wednesday');
  assert.equal(attemptsOf(wednesday).length, 0);

  const sunday = withWorld(t, { now: SUN, queue: [TOPICS.pet] });
  assert.equal(TOPICS.pet.reserve, undefined);
  const result = run(sunday);
  assert.equal(result.cadenceMet, true, 'two directory-backed reserves fill both slots');
  const attempts = attemptsOf(sunday);
  assert.deepEqual(attempts.map((a) => [a.slot_number, a.topic_key, a.outcome]), [[1, 'reserve:dir:bakery', 'consumed'], [2, 'reserve:dir:salon', 'consumed']]);
  assert.deepEqual(sunday.generated.map((entry) => entry.title), ['Bakery in Liberty Village', 'Salon in Liberty Village']);
  const packs = submitCalls(sunday).map((args) => JSON.parse(fs.readFileSync(args[args.indexOf('--source-pack') + 1], 'utf8')));
  assert.ok(packs.every((pack) => pack.reserve === true && pack.sources.length >= 3 && pack.sources.reduce((n, s) => n + s.claims.length, 0) >= 6));
  const [a, b] = packs.map((pack) => new Set(pack.sources.map((source) => source.id)));
  assert.equal([...a].some((id) => b.has(id)), false, 'reserve record sets are disjoint');
});

test('F5 reserves are capped at two per week and need a category with 3 records / 6 facts', (t) => {
  const world = withWorld(t, { now: SUN, queue: [] });
  world.gatePlan = ['reject', 'reject', 'reject'];
  assert.throws(() => run(world), /weekly content missed/);
  assert.equal(attemptsOf(world).filter((a) => a.topic_key.startsWith('reserve:')).length, CADENCE.reservePerWeek);
  const thin = withWorld(t, { now: SUN, queue: [], businesses: BUSINESSES.filter((b) => !['bakery-three', 'salon-three'].includes(b.slug)) });
  assert.throws(() => run(thin), /weekly content missed/);
  assert.equal(thin.generated.length, 0, 'two-record categories never become reserve intents');
});

test('F1 late smoke (next ISO week) is never success for the old week', (t) => {
  const world = withWorld(t, { now: SUN, queue: [TOPICS.happy, TOPICS.coffee] });
  world.smokeAt = new Date('2026-10-05T00:10:00.000Z');
  assert.throws(() => run(world), /late smoke; old week missed/);
  const [attempt] = attemptsOf(world);
  assert.equal(attempt.outcome, 'late-smoked', 'terminal in the old slot, never consumed for the old week');
  assert.equal(world.generated.length, 1, 'no further spend for a week that has ended');
});

test('F1 smoked but not current-live: honest failure, never cadenceMet', (t) => {
  const world = withWorld(t, { queue: [TOPICS.happy, TOPICS.coffee] });
  world.gatePlan = ['not-live', 'not-live'];
  assert.throws(() => run(world), /smoked but not counted for week/);
  assert.deepEqual(attemptsOf(world).map((a) => a.outcome), ['smoked', 'smoked']);
  assert.ok(events(world, 'cadence-smoked-uncounted').length === 2);
});

test('prior smoked-but-not-current-live attempt holds with its trusted submission ID', (t) => {
  const world = withWorld(t, { now: SUN, queue: [TOPICS.happy, TOPICS.coffee] });
  world.smokeAt = new Date('2026-10-05T00:10:00.000Z');
  world.gatePlan = ['not-live'];
  let firstError;
  try { run(world); } catch (error) { firstError = error; }
  const [attempt] = attemptsOf(world);
  assert.equal(firstError?.message, 'prior content smoke not current-live');
  assert.equal(firstError?.stuckSubmissionId, attempt.submission_id);
  assert.equal(attempt.outcome, 'smoked', 'the original attempt remains unresolved');
  world.now = new Date('2026-10-05T12:30:00.000Z');
  assert.throws(() => run(world), (error) => error.message === 'prior content smoke not current-live' && error.stuckSubmissionId === attempt.submission_id);
  assert.equal(attempt.outcome, 'smoked');
  assert.equal(attemptsOf(world).filter((item) => item.week_start_utc === '2026-10-05').length, 0, 'no new-week spend on unresolved smoke');
  assert.ok(events(world, 'cadence-prior-smoke-hold').some((event) => event.id === attempt.submission_id));
  world.live.add(attempt.submission_id); // operator restored the exact hosted alias revision
  assert.equal(run(world).contentCount, 2);
  assert.equal(attempt.outcome, 'late-smoked', 'restored alias releases the original slot, not a fabricated replacement');
});

test('F2 a valid sidecar next to an unrelated post never reaches submit', (t) => {
  const world = withWorld(t, { queue: [TOPICS.happy, TOPICS.coffee, TOPICS.fitness] });
  world.generatorPlan = ['unrelated'];
  run(world);
  const slot1 = attemptsOf(world).filter((a) => a.slot_number === 1);
  assert.equal(slot1[0].outcome, 'failed-before-submit');
  assert.equal(submitCalls(world).some((args) => args.includes(slot1[0].idempotency_key)), false);
  assert.ok(events(world, 'cadence-attempt-failed').some((entry) => entry.reason === 'draft-unbound'));
  assert.ok(events(world, 'draft-unbound')[0].errors.includes('no-attributed-business'));
});

test('F3 one post this run but still below two: fails with cadence content deficit (non-Sunday)', (t) => {
  const world = withWorld(t, { queue: [TOPICS.happy] });
  assert.throws(() => run(world), /cadence content deficit/);
  assert.equal(attemptsOf(world)[0].outcome, 'consumed', 'the post itself published and counted');
  assert.equal(JSON.parse(world.cli(['cadence', 'count', '--week-start', '2026-09-28', '--target', 'staging']).stdout).contentCount, 1);
});

test('F4 each run evaluates the PRIOR week once: missed alerts inserted idempotently and delivered; delivery failure is non-fatal', (t) => {
  const world = withWorld(t, { queue: [TOPICS.happy, TOPICS.coffee] });
  world.submissions.set(1, { id: 1, kind: 'blog', key: 'old', state: 'published', smokedAt: '2026-09-23T12:00:00.000Z', slug: 'last-week' });
  world.live.add(1);
  world.deliverFails = true;
  assert.equal(run(world).cadenceMet, true, 'delivery failure never aborts the run');
  assert.deepEqual(world.deadlineCalls.map((call) => call.week), ['2026-09-21']);
  assert.deepEqual([...world.alerts.values()].map((alert) => [alert.kind, alert.counts.content, alert.counts.roundup]), [['WEEKLY_CONTENT_MISSED', 1, 0], ['WEEKLY_NEWS_MISSED', 1, 0]]);
  assert.ok(events(world, 'cadence-alert-delivery-failed').length === 1);
  world.deliverFails = false;
  assert.equal(run(world).noChanges, true);
  assert.equal(world.alerts.size, 2, 'idempotent on rerun');
  assert.ok([...world.alerts.values()].every((alert) => alert.delivered));
  assert.equal(events(world, 'cadence-prior-week').at(-1).created, 0);
  world.alertsEnabled = false;
  const before = world.deliverCalls;
  run(world);
  assert.equal(world.deliverCalls, before, 'no webhook: delivery skipped');
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

test('F6 consumed exclusion is all-time via cadence consumed, not a lookback', (t) => {
  const world = withWorld(t, { queue: [TOPICS.happy, TOPICS.coffee, TOPICS.fitness] });
  world.attempts.push({ target: 'staging', week_start_utc: '2026-03-02', lane: 'content', slot_number: 1, ordinal: 1, intent_fingerprint: 'happy hour', topic_key: 'k-happy', idempotency_key: 'cadence:old', source_pack_digest: 'x', submission_id: 9, outcome: 'consumed' });
  run(world);
  assert.deepEqual(world.generated.map((entry) => entry.title), ['Coffee Shops', 'Fitness Classes'], '30-week-old consumed intent still excluded');
  assert.equal(world.calls.filter((args) => args[1] === 'consumed').length, 1);
  assert.equal(world.calls.some((args) => args.includes('2026-03-02')), false, 'the consumed week is never queried: no per-week lookback');
  assert.equal(fs.existsSync(path.join(world.stateRoot, 'topic-state.json')), false);
});

test('Sunday with the goal already met is a no-op', (t) => {
  const world = withWorld(t, { now: SUN });
  for (const id of [1, 2]) { world.submissions.set(id, { id, kind: 'blog', key: `k${id}`, state: 'published', smokedAt: WED.toISOString(), slug: `p${id}` }); world.live.add(id); }
  assert.equal(run(world).cadenceMet, true);
  assert.deepEqual(world.deadlineCalls.map((call) => call.week), ['2026-09-21'], 'only the prior week is evaluated');
  assert.equal(world.generated.length, 0);
});

const REAL_BUSINESSES = JSON.parse(fs.readFileSync(new URL('../../data/businesses.json', import.meta.url), 'utf8'));
const categoryOf = (slug) => REAL_BUSINESSES.find((record) => record.slug === slug)?.category;

test('R3 a directory reserve pack is built only from its category (real data): Bars stays bar-only and is skipped before spend', () => {
  const snapshot = { businesses: REAL_BUSINESSES, posts: [], services: [], topics: [] };
  const bars = reservePack(modules, { title: 'Bars in Liberty Village', category: 'bars', snapshot, now: SUN });
  assert.ok(bars.pack.sources.length >= 3);
  assert.ok(bars.pack.sources.every((source) => categoryOf(source.id) === 'bars'), 'no off-category source in the bars pack');
  assert.equal(bars.skip, 'reserve-generator-off-category', 'the generator\'s full-directory pack would add off-category bars, so no spend');
  const dentists = reservePack(modules, { title: 'Dentists in Liberty Village', category: 'dentists', snapshot, now: SUN });
  assert.equal(dentists.ok, true);
  assert.ok(dentists.pack.sources.every((source) => categoryOf(source.id) === 'dentists'));
});

test('R3 Sunday reserves on real data are category-pure and disjoint', (t) => {
  const world = withWorld(t, { now: SUN, queue: [], businesses: REAL_BUSINESSES });
  run(world);
  const reserves = attemptsOf(world).filter((a) => a.topic_key.startsWith('reserve:dir:'));
  assert.equal(reserves.length, CADENCE.reservePerWeek);
  const packs = submitCalls(world).map((args) => JSON.parse(fs.readFileSync(args[args.indexOf('--source-pack') + 1], 'utf8')));
  packs.forEach((pack, index) => {
    const category = reserves[index].topic_key.slice('reserve:dir:'.length);
    assert.ok(pack.sources.every((source) => categoryOf(source.id) === category), `${category} pack is category-pure`);
  });
  assert.equal(reserves.some((a) => a.topic_key === 'reserve:dir:bars'), false);
});

test('R3 a restart after one Sunday reserve never reuses its category (durable, from DB attempts)', (t) => {
  const world = withWorld(t, { now: SUN, queue: [] });
  // An earlier run this week already spent the bakery reserve (older title => different fingerprint).
  world.attempts.push({ target: 'staging', week_start_utc: '2026-09-28', lane: 'content', slot_number: 1, ordinal: 1, intent_fingerprint: 'legacy bakery guide', topic_key: 'reserve:dir:bakery', idempotency_key: 'cadence:earlier', source_pack_digest: 'x', submission_id: null, outcome: 'rejected' });
  world.slots.set('2026-09-28|content|1', { week_start_utc: '2026-09-28', lane: 'content', slot_number: 1, state: 'ready', attempt_ordinal: 1, token: null, owner: null, submission_id: null, roundup_slug: null });
  assert.throws(() => run(world), /weekly content missed/, 'only one reserve left this week');
  assert.deepEqual(world.generated.map((entry) => entry.title), ['Salon in Liberty Village']);
  assert.deepEqual(attemptsOf(world).map((a) => a.topic_key), ['reserve:dir:bakery', 'reserve:dir:salon']);
});

test('R2 first run ignores pre-start weeks, but a fully dead configured active prior week alerts exactly once', (t) => {
  const world = withWorld(t, { queue: [] });
  world.cadenceStartWeek = '2026-09-28';
  assert.throws(() => run(world), /cadence content deficit/);
  assert.deepEqual(world.deadlineCalls, [], 'initial W40 run never evaluates pre-start W39');
  assert.equal(world.alerts.size, 0);
  world.now = new Date('2026-10-07T11:00:00.000Z');
  assert.throws(() => run(world), /cadence content deficit/);
  assert.deepEqual(world.deadlineCalls.map((call) => call.week), ['2026-09-28'], 'the configured active W40 is evaluated as immediate prior week');
  assert.deepEqual([...world.alerts.values()].map((alert) => alert.kind), ['WEEKLY_CONTENT_MISSED', 'WEEKLY_NEWS_MISSED']);
  assert.throws(() => run(world), /cadence content deficit/);
  assert.equal(world.alerts.size, 2, 'alert keys are deduplicated across runs');

  const noRows = withWorld(t, { now: new Date('2026-10-07T11:00:00.000Z'), queue: [] });
  noRows.cadenceStartWeek = '2026-09-28';
  assert.equal(noRows.slots.size, 0, 'no cadence activity in the active prior week');
  assert.throws(() => run(noRows), /cadence content deficit/);
  assert.deepEqual(noRows.deadlineCalls.map((call) => call.week), ['2026-09-28'], 'a fully dead active week still gets evaluated');
  assert.deepEqual([...noRows.alerts.values()].map((alert) => alert.kind), ['WEEKLY_CONTENT_MISSED', 'WEEKLY_NEWS_MISSED']);
});

test('R2 excludes even row-bearing older weeks before the target cutoff', (t) => {
  const world = withWorld(t, { now: new Date('2026-10-21T11:00:00.000Z'), queue: [] });
  world.cadenceStartWeek = '2026-09-28';
  world.slots.set('2026-09-21|content|1', { week_start_utc: '2026-09-21', lane: 'content', slot_number: 1 });
  world.attempts.push({ target: 'staging', week_start_utc: '2026-09-21', lane: 'content', slot_number: 1, ordinal: 1 });
  world.slots.set('2026-09-28|content|1', { week_start_utc: '2026-09-28', lane: 'content', slot_number: 1 });
  assert.throws(() => run(world), /cadence content deficit/);
  assert.deepEqual(world.deadlineCalls.map((call) => call.week), ['2026-09-28', '2026-10-12'], 'active older W40 and immediate W42 only');
  assert.equal(world.alerts.has('2026-09-21|WEEKLY_CONTENT_MISSED'), false);
});

test('R2 absent cutoff defaults to this run\'s week; invalid dates stop before any CLI or spend', (t) => {
  const world = withWorld(t, { queue: [] });
  world.cadenceStartWeek = undefined;
  assert.throws(() => run(world), /cadence content deficit/);
  assert.deepEqual(world.deadlineCalls, []);
  assert.equal(events(world, 'cadence-start-week-defaulted')[0].week, '2026-09-28');
  world.now = new Date('2026-10-07T11:00:00.000Z');
  assert.throws(() => run(world), /cadence content deficit/);
  assert.deepEqual(world.deadlineCalls, [], 'no fixed config means no past-week alerts on any later run');
  assert.equal(events(world, 'cadence-start-week-defaulted')[1].week, '2026-10-05');
  for (const bad of ['2026-09-29', '2026-02-30', '2026-9-28', 'garbage']) {
    const invalid = withWorld(t, { queue: [] });
    invalid.cadenceStartWeek = bad;
    assert.throws(() => run(invalid), /invalid cadence start week/);
    assert.deepEqual(invalid.calls, [], 'invalid setting refuses before count or deadline');
    assert.deepEqual(invalid.generated, [], 'invalid setting refuses before generator spend');
  }
});

test('R2 catches up active older weeks; older inactive weeks stay quiet while the immediate prior week is eligible', (t) => {
  const world = withWorld(t, { queue: [TOPICS.happy, TOPICS.coffee, TOPICS.fitness] });
  const missed = (week) => [...world.alerts.values()].filter((alert) => alert.week === week).map((alert) => alert.kind);
  run(world);  // week 2026-09-28: cadence active (slots + attempts), no roundup
  world.now = new Date('2026-10-07T11:00:00.000Z');
  world.deadlineFails = true;
  for (let i = 0; i < 2; i++) assert.throws(() => run(world), /cadence content deficit/, 'deadline failure is non-fatal; the run continues');
  assert.deepEqual(missed('2026-09-28'), []);
  assert.ok(world.logs.filter((entry) => entry.event === 'cadence-deadline-failed').length >= 2);
  world.deadlineFails = false;
  world.now = new Date('2026-10-21T11:00:00.000Z');
  assert.throws(() => run(world), /cadence content deficit/);
  assert.deepEqual(missed('2026-09-28'), ['WEEKLY_NEWS_MISSED'], 'older active week caught up two weeks later');
  // 2026-09-14 was only ever an older (back>=2) candidate with no cadence rows.
  assert.deepEqual(missed('2026-09-14'), [], 'pre-activation week never alerts');
  assert.equal(world.deadlineCalls.some((call) => call.week === '2026-09-14'), false, 'and is never deadline-evaluated');
  assert.throws(() => run(world), /cadence content deficit/);
  assert.equal(missed('2026-09-28').length, 1, 'recorded once');
  const evaluated = world.deadlineCalls.slice(-3).map((call) => call.week);
  assert.deepEqual(evaluated, [...evaluated].sort(), 'oldest first');
});
