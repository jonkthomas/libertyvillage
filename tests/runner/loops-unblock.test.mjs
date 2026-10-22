import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runOctoberBackfill, OCTOBER_BACKFILL, diagnosticMessage, gateDiagnostic, classifyCliFailure, summarizeNewsDecision } from '../../ops/exedev-runner/runner.mjs';
import { createWorld, topic, TOPICS } from './fake-cadence.mjs';
import { gscEditorialTitle, appendDiscoveredTopics } from '../../scripts/automation/topic-queue.mjs';
import { toRecord, filterCandidates, buildDedupeState } from '../../scripts/discover-businesses.mjs';
import { findCorroboratingMembers } from '../../scripts/news-pilot/publish.mjs';
import { createRequestBudget } from '../../scripts/news-pilot/fetch.mjs';

const backfill = (world) => runOctoberBackfill({ target: 'staging', slot: 'local-backfill-acceptance', deps: world.deps });

test('seven historical labels publish once per UTC date with real dates and original DB keys', (t) => {
  const categories = ['bakeries', 'hair-salons', 'florists', 'dentists', 'pet-stores', 'coffee-shops', 'gyms'];
  const businesses = categories.flatMap((category, index) => [1, 2, 3].map((n) => ({
    slug: `${category}-${n}`, name: `${category} place ${n}`, category,
    address: `${5 + index * 10 + n} Liberty Street, Toronto`, description: `${category} services in the neighbourhood.`,
    hours: 'Mon-Fri 9am-5pm', phone: `416-555-010${n}`, website: `https://${category}-${n}.example`,
  })));
  const world = createWorld({ now: new Date('2026-10-23T15:37:00Z'), businesses, queue: categories.map((c) => topic(c, `${c.replaceAll('-', ' ')} in Liberty Village`)) });
  t.after(() => world.cleanup());
  for (let index = 0; index < 7; index++) {
    world.now = new Date(`2026-10-${23 + index}T15:37:00Z`);
    const result = backfill(world);
    assert.equal(result.reason, 'october-backfill-published');
    const post = JSON.parse(fs.readFileSync(path.join(world.repo, 'data/posts.json'), 'utf8')).at(-1);
    assert.equal(post.publishedAt, world.now.toISOString().slice(0, 10));
    assert.equal(world.attempts.length, index + 1);
    const keys = world.attempts.map((a) => a.idempotency_key);
    const again = backfill(world);
    assert.equal(again.noChanges, true);
    assert.deepEqual(world.attempts.map((a) => a.idempotency_key), keys);
  }
  assert.equal(backfill(world).reason, 'october-backfill-complete');
  assert.deepEqual(world.attempts.map((a) => a.slot_number), [101, 102, 103, 104, 105, 106, 107]);
  assert.ok(world.attempts.every((a) => a.outcome === 'late-smoked'));
  assert.equal(new Set(world.attempts.map((a) => a.idempotency_key)).size, 7);
  assert.equal(OCTOBER_BACKFILL.length, 7);
});

test('pending backfill resumes the same submission; hold cannot advance the queue', (t) => {
  const world = createWorld({ now: new Date('2026-10-23T15:37:00Z'), queue: [TOPICS.coffee] });
  t.after(() => world.cleanup());
  world.gatePlan = ['pending']; world.deployCode = 3;
  assert.throws(() => backfill(world), /backfill publication incomplete/);
  const key = world.attempts[0].idempotency_key;
  const id = world.attempts[0].submission_id;
  world.deployCode = 0;
  assert.equal(backfill(world).id, id);
  assert.equal(world.attempts.length, 1);
  assert.equal(world.attempts[0].idempotency_key, key);
  assert.equal(world.generated.length, 1);
});

test('later-day grounded inventory cannot reset an exhausted backfill slot cap', (t) => {
  const categories = ['coffee-shops', 'gyms', 'dentists', 'florists'];
  const businesses = categories.flatMap((category) => [1, 2].map((n) => ({
    slug: `${category}-${n}`, name: `${category} ${n}`, category,
    description: `${category} services in the neighbourhood.`, address: `${n} Liberty St, Toronto`,
    hours: 'Mon-Fri 9am-5pm', phone: '416-555-0100', website: `https://${category}-${n}.example`,
  })));
  const entries = categories.map((c) => topic(c, `${c.replaceAll('-', ' ')} in Liberty Village`));
  const world = createWorld({ now: new Date('2026-10-23T15:37:00Z'), businesses, queue: entries.slice(0, 3) });
  t.after(() => world.cleanup());
  world.gatePlan = ['reject', 'reject', 'reject'];
  assert.throws(() => backfill(world), /backfill publication incomplete/);
  assert.equal(world.attempts.length, 3);
  const oldKeys = world.attempts.map((a) => a.idempotency_key);
  world.now = new Date('2026-10-24T15:37:00Z');
  world.queue.push(entries[3]);
  assert.throws(() => backfill(world), /backfill publication incomplete/);
  assert.equal(world.attempts.length, 3);
  assert.deepEqual(world.attempts.slice(0, 3).map((a) => a.idempotency_key), oldKeys);
  assert.ok(world.attempts.every((a) => a.slot_number === 101));
});

test('CLI validation and gate rejection retain a bounded redacted explanation; news logs only counts', () => {
  const message = diagnosticMessage('required: faqs https://example.com/?token=private-value sk-abcdefghijklmnop', { TEST_TOKEN: 'private-value' });
  assert.match(message, /required: faqs/); assert.doesNotMatch(message, /private-value|https:|sk-/);
  assert.equal(diagnosticMessage('x'.repeat(4096)).length, 2048);
  const failure = classifyCliFailure('node', ['scripts/content/cli.mjs', 'submit'], { status: 2, stdout: JSON.stringify({ error: 'ValidationError', message: 'unknown field: relatedBusinesses' }) });
  assert.equal(failure.message, 'unknown field: relatedBusinesses');
  assert.deepEqual(gateDiagnostic({ code: 2, stdout: JSON.stringify({ decision: 'unrepairable', message: 'malformed query' }) }), { decision: 'unrepairable', message: 'malformed query' });
  assert.deepEqual(summarizeNewsDecision({ published: 0, considered: 2, evaluations: [{ title: 'private title', prefilter: { ok: false, code: 'risk_flags' } }, { prefilter: { ok: true }, gate: { ok: false, code: 'extraction_empty' } }] }), { published: 0, considered: 2, refusals: { risk_flags: 1, extraction_empty: 1 } });
});

test('early draft schema rejection logs an actionable bounded message before submit', (t) => {
  const world = createWorld({ now: new Date('2026-10-23T15:37:00Z'), queue: [TOPICS.coffee] });
  t.after(() => world.cleanup());
  const generate = world.deps.generate;
  world.deps.generate = (title) => {
    const changed = generate(title);
    const file = path.join(world.repo, 'data/posts.json');
    const posts = JSON.parse(fs.readFileSync(file, 'utf8'));
    posts.at(-1).relatedBusinesses = ['cafe-one'];
    fs.writeFileSync(file, JSON.stringify(posts));
    return changed;
  };
  assert.throws(() => backfill(world), /backfill publication incomplete/);
  const event = world.logs.find((item) => item.event === 'draft-unbound');
  assert.ok(event.errors.includes('storage'));
  assert.match(event.message, /storage:unknown field: relatedBusinesses/);
  assert.equal(world.submissions.size, 0);
});

test('discovery incident inputs are excluded while grounded category intent remains', async () => {
  assert.equal(gscEditorialTitle('Jukebox Print Toronto Liberty Village Toronto'), null);
  assert.equal(gscEditorialTitle('Goodlife Liberty Village'), null);
  const r = await appendDiscoveredTopics({ version: 1, topics: [] }, [{ kind: 'blog', source: 'gsc', title: 'Jukebox Print Toronto' }, { kind: 'blog', source: 'gsc', title: 'Liberty Village coffee shops' }]);
  assert.equal(r.added.length, 1); assert.match(r.added[0].title, /Coffee shop directory guide/);
  const privateGym = { title: 'OVO Athletic Centre', type: 'Gym', rating: 4.7, reviews: 103, address: '30 British Columbia Rd, Toronto, ON M6K 3C3', gps_coordinates: { latitude: 43.6329, longitude: -79.42 } };
  assert.deepEqual(filterCandidates([privateGym], 'gyms', buildDedupeState([])), []);
  assert.equal(toRecord({ title: 'Studio', rating: 4.9, reviews: 817 }, 'tattoo-parlors').priceRange, '');
  assert.equal(toRecord({ title: 'Cafe', price: '$$' }, 'coffee-shops').priceRange, '$$');
});

test('news corroboration admits matching dated leads only and never promotes search tiers', async () => {
  const candidate = { title: 'Liberty Village park design shortlist announced', publishedAt: '2026-10-22T00:00:00Z' };
  const budget = createRequestBudget(1);
  const members = await findCorroboratingMembers(candidate, { budget, env: { SERPER_API_KEY: 'fixture' }, search: async (_source, ctx) => {
    ctx.budget.take(1);
    return { ok: true, data: { kind: 'serper', news: [
      { title: candidate.title, date: '2026-10-22', link: 'https://publisher.example/park' },
      { title: candidate.title, date: '2025-10-22', link: 'https://publisher.example/old' },
      { title: 'Unrelated Toronto launch', date: '2026-10-22', link: 'https://other.example/launch' },
    ] } };
  } });
  assert.equal(members.length, 1); assert.equal(members[0].sourceTier, 'lead');
  assert.deepEqual(await findCorroboratingMembers(candidate, { budget, env: { SERPER_API_KEY: 'fixture' }, search: () => assert.fail('spent budget') }), []);
});
