import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runOctoberBackfill, runWeeklyBlog, diagnosticMessage } from '../../ops/exedev-runner/runner.mjs';
import { createWorld, groundedPost, TOPICS, topic } from './fake-cadence.mjs';
import { buildSourcePack, checkDraftAgainstPack } from '../../scripts/automation/blog-source-pack.mjs';
import { blogDraftBindingErrors } from '../../scripts/content/submit.mjs';
import { filterCandidates, buildDedupeState } from '../../scripts/discover-businesses.mjs';

const backfill = (world) => runOctoberBackfill({ target: 'staging', slot: 'review-revisions', deps: world.deps });
const inventory = (categories, size) => categories.flatMap((category) => Array.from({ length: size }, (_, i) => ({
  slug: `${category}-${i}`, name: `${category} ${i}`, category, description: `${category} services in the neighbourhood.`,
  address: `${5 + i} Liberty Street, Toronto`, hours: 'Mon-Fri 9am-5pm', phone: '416-555-0100', website: `https://${category}-${i}.example`,
})));

test('F1/F3: submit and gate binding remain date-agnostic across UTC midnight; generation explicitly checks dates', () => {
  const now = new Date('2026-10-22T23:59:00Z');
  const businesses = inventory(['coffee-shops'], 2);
  const pack = buildSourcePack({ topic: 'Coffee shops', businesses, now }).pack;
  const post = groundedPost(pack, 'Coffee shops', '2026-10-22');
  const inputs = { businesses, now: new Date('2026-10-23T00:01:00Z'), imagePaths: [post.image] };
  assert.equal(checkDraftAgainstPack(post, pack, inputs).ok, true);
  assert.deepEqual(blogDraftBindingErrors(post, pack, { live: { businesses, posts: [], services: [], topics: [] }, now: inputs.now, imagePaths: [post.image] }), []);
  assert.ok(checkDraftAgainstPack(post, pack, { ...inputs, requireRealDate: true }).errors.includes('draft-must-use-real-publish-date'));
  assert.equal(checkDraftAgainstPack(post, pack, { ...inputs, now, requireRealDate: true }).ok, true);
  assert.match(fs.readFileSync(new URL('../../scripts/weekly-blog-agent.js', import.meta.url), 'utf8'), /requireRealDate: true/);
});

test('F2: missing reviewed building numbers with M6K are admitted, explicit outside/missing addresses stay excluded', () => {
  const candidate = (address) => ({ title: address, address, rating: 4.8, reviews: 100, type: 'Coffee shop', gps_coordinates: { latitude: 43.638, longitude: -79.42 } });
  for (const address of ['1 East Liberty St, Toronto, ON M6K 3P4', '5 East Liberty St, Toronto, ON M6K 3P4']) {
    assert.equal(filterCandidates([candidate(address)], 'coffee-shops', buildDedupeState([])).length, 1, address);
  }
  for (const address of ['1 East Liberty St, Toronto, ON M5V 1A1', '30 British Columbia Rd, Toronto, ON M6K 3C3', '10 Joe Shuster Way, Toronto, ON M6K 0A1', '1205 Queen St W, Toronto, ON M6K 1L2']) {
    assert.equal(filterCandidates([candidate(address)], 'coffee-shops', buildDedupeState([])).length, 0, address);
  }
});

test('F4: staging backfill is exercised once in Stage 2 before production activation', () => {
  const runbook = fs.readFileSync(new URL('../../docs/specs/lv-weekly-loops/go-live-runbook.md', import.meta.url), 'utf8');
  const stage = runbook.slice(runbook.indexOf('## Stage 2'), runbook.indexOf('## Stage 3'));
  assert.equal(stage.match(/sudo lv-runner run october-blog-backfill --target staging/g)?.length, 1);
});

test('F5: README describes all seven installed timers', () => {
  assert.match(fs.readFileSync(new URL('../../ops/exedev-runner/README.md', import.meta.url), 'utf8'), /service template and seven timers/);
});

test('F6: diagnostics redact service-account JSON, analytics identity and login values', () => {
  const env = { GOOGLE_SERVICE_ACCOUNT_JSON: '{"fixture":"service-account"}', DATAFORSEO_LOGIN: 'fixture-login@example.test', GA_PROPERTY_ID: '523614078' };
  const result = diagnosticMessage(Object.values(env).join(' | '), env);
  for (const value of Object.values(env)) assert.equal(result.includes(value), false);
});

test('D4 normal: terminal attempts persist the per-slot cap across daily backfill invocations', (t) => {
  const categories = ['coffee-shops', 'gyms', 'dentists', 'florists'];
  const entries = categories.map((c) => topic(c, `${c.replaceAll('-', ' ')} in Liberty Village`));
  const world = createWorld({ now: new Date('2026-10-23T15:37:00Z'), businesses: inventory(categories, 2), queue: entries.slice(0, 3) });
  t.after(() => world.cleanup()); world.gatePlan = ['reject', 'reject', 'reject'];
  assert.throws(() => backfill(world), /backfill publication incomplete/);
  const keys = world.attempts.map((a) => a.idempotency_key);
  world.now = new Date('2026-10-24T15:37:00Z'); world.queue.push(entries[3]);
  assert.throws(() => backfill(world), /backfill publication incomplete/);
  assert.equal(world.generated.length, 3); assert.deepEqual(world.attempts.map((a) => a.idempotency_key), keys);
});

test('D4 reserve: rejected reserve attempts and categories persist across daily invocations', (t) => {
  const world = createWorld({ now: new Date('2026-10-22T15:37:00Z'), businesses: inventory(['bakeries', 'dentists', 'florists'], 3), queue: [] });
  t.after(() => world.cleanup()); world.gatePlan = ['reject', 'reject'];
  assert.throws(() => backfill(world), /backfill publication incomplete/);
  world.now = new Date('2026-10-23T15:37:00Z');
  assert.throws(() => backfill(world), /backfill publication incomplete/);
  assert.equal(world.generated.length, 2);
});

test('D4 publication week: backfill cannot spend more than two reserves across historical weeks', (t) => {
  const world = createWorld({ now: new Date('2026-10-22T15:37:00Z'), businesses: inventory(['bakeries', 'dentists', 'florists'], 3), queue: [] });
  t.after(() => world.cleanup());
  assert.equal(backfill(world).reason, 'october-backfill-published');
  world.now = new Date('2026-10-23T15:37:00Z'); assert.equal(backfill(world).reason, 'october-backfill-published');
  world.now = new Date('2026-10-24T15:37:00Z'); assert.throws(() => backfill(world), /backfill publication incomplete/);
  assert.equal(world.generated.length, 2);
});

test('D5/F9: pending backfill in a prior or current label week never blocks live weekly-blog', (t) => {
  for (const historical of [true, false]) {
    const world = createWorld({ now: new Date('2026-10-23T11:00:00Z'), queue: [TOPICS.coffee, TOPICS.fitness] });
    t.after(() => world.cleanup());
    const week = historical ? '2026-09-28' : '2026-10-19'; const slot = historical ? 101 : 107;
    world.attempts.push({ target: 'staging', week_start_utc: week, lane: 'content', slot_number: slot, ordinal: 1, outcome: 'published', submission_id: 700, idempotency_key: 'backfill-pending', intent_fingerprint: 'old-intent', topic_key: 'old-topic' });
    world.submissions.set(700, { id: 700, state: 'published', kind: 'blog', key: 'backfill-pending', smokedAt: null, slug: 'pending-backfill' });
    const cli = world.deps.cli;
    world.deps.cli = (args, allowed) => args[0] === 'gate' && args[2] === '700' ? { code: 3, stdout: '{}' } : args[0] === 'deploy' ? { code: 3, stdout: '{}' } : cli(args, allowed);
    assert.equal(runWeeklyBlog({ target: 'staging', slot: 'live-weekly-review', deps: world.deps }).cadenceMet, true);
    assert.equal(world.calls.filter((args) => args[0] === 'gate' && args[2] === '700').length, 0);
    assert.equal(world.attempts.find((a) => a.submission_id === 700).outcome, 'published');
  }
});
