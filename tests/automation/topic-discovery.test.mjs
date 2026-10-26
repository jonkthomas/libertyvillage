import assert from 'node:assert/strict';
import test from 'node:test';

import { isGeneratorKind } from '../../scripts/automation/candidate-state.mjs';
import {
  appendDiscoveredTopics, buildSerpApiPaaEntries, checkTopicGroundability,
  reserveGuideEligibility, intentFingerprint, discoverTopics,
} from '../../scripts/automation/topic-queue.mjs';
import { classifyFindings, preflightDecision } from '../../scripts/automation/preflight.mjs';
import { GATE_MODEL, KIND_POLICIES } from '../../scripts/automation/constants.mjs';

test('SerpApi PAA discovery requires the explicit Liberty Village phrase', () => {
  const entries = buildSerpApiPaaEntries([
    { question: 'Where should I eat in Liberty Village?' },
    { question: 'What is happening in Liberty Township?' },
    { question: 'What restaurants are in Liberty?' },
  ], 'Liberty Village restaurants');

  assert.deepEqual(entries.map((entry) => entry.title), ['Where Should I Eat In Liberty Village, Toronto?']);
  assert.deepEqual(entries.map((entry) => entry.source), ['serpapi']);
});

test('the PAA filter is case-insensitive but does not accept similar place names', () => {
  assert.deepEqual(buildSerpApiPaaEntries([
    { question: 'LIBERTY VILLAGE transit options' },
    { question: 'Is Liberty Village In Toronto?' },
  ], 'query').map((entry) => entry.title), [
    'LIBERTY VILLAGE, Toronto Transit Options',
    'Is Liberty Village In Toronto?',
  ]);
  for (const question of [
    'Liberty Township restaurants',
    'Things to do near Liberty Center',
    'What restaurants are in Liberty?',
    '',
  ]) {
    assert.deepEqual(buildSerpApiPaaEntries([{ question }], 'query'), [], question);
  }
});

test('PAA contamination is filtered before the three-question cap', () => {
  const entries = buildSerpApiPaaEntries([
    { question: 'What is happening in Liberty Township?' },
    { question: 'Things to do near Liberty Center?' },
    { question: 'What restaurants are in Liberty?' },
    { question: 'Where is brunch in Liberty Village?' },
    { question: 'How do I reach Liberty Village by TTC?' },
    { question: 'What patios are open in Liberty Village?' },
    { question: 'A fourth valid Liberty Village question?' },
  ], 'query');
  assert.deepEqual(entries.map((entry) => entry.title), [
    'Where Is Brunch In Liberty Village, Toronto?',
    'How Do I Reach Liberty Village, Toronto By TTC?',
    'What Patios Are Open In Liberty Village, Toronto?',
  ]);
});

test('GSC-derived topics are geo-qualified without changing their source evidence', async () => {
  const discovery = {
    kind: 'blog', title: 'Best patios near the stadium', source: 'gsc',
    rationale: 'GSC top query', addedAt: '2026-08-24T00:00:00.000Z',
  };
  const result = await appendDiscoveredTopics({ version: 1, topics: [] }, [discovery]);
  assert.equal(result.added.length, 1);
  assert.equal(result.added[0].title, 'Patio directory guide in Liberty Village, Toronto');
  assert.equal(result.added[0].source, discovery.source);
  assert.equal(result.added[0].rationale, discovery.rationale);
});

test('PR #115 discovery titles are geo-qualified and deduplicated by stable intent', async () => {
  const discoveries = [
    { kind: 'blog', title: 'Liberty Village Happy Hour', source: 'gsc', rationale: 'higher priority' },
    { kind: 'blog', title: 'Happy Hour Liberty Village', source: 'gsc', rationale: 'duplicate' },
    { kind: 'blog', title: 'Jukebox Printing', source: 'gsc', rationale: 'local business query' },
    { kind: 'blog', title: 'Is Liberty Village A Good Area?', source: 'serpapi', rationale: 'specific' },
    { kind: 'blog', title: 'Is Liberty Village Worth It?', source: 'serpapi', rationale: 'overlap' },
    { kind: 'blog', title: 'What Is Liberty Village Known For?', source: 'serpapi', rationale: 'valid PAA' },
  ];

  const result = await appendDiscoveredTopics({ version: 1, topics: [] }, discoveries);

  assert.deepEqual(result.added.map((entry) => entry.title), [
    'Happy hour directory guide in Liberty Village, Toronto',
    'Is Liberty Village, Toronto A Good Area?',
    'What Is Liberty Village, Toronto Known For?',
  ]);
  assert.deepEqual(result.added.map((entry) => entry.rationale), [
    'higher priority', 'specific', 'valid PAA',
  ]);

  const replay = await appendDiscoveredTopics(result.queue, discoveries);
  assert.equal(replay.added.length, 0);
  assert.deepEqual(replay.queue, result.queue);

  const priorRun = await appendDiscoveredTopics({ version: 1, topics: [] }, [{
    kind: 'blog', title: 'Happy Hour Liberty Village', source: 'gsc', rationale: 'prior run',
  }]);
  const crossRun = await appendDiscoveredTopics(priorRun.queue, [{
    kind: 'blog', title: 'Liberty Village Happy Hour', source: 'gsc', rationale: 'later run',
  }]);
  assert.equal(crossRun.added.length, 0, 'word-order intent duplicates stay rejected across runs');
  assert.deepEqual(crossRun.queue, priorRun.queue);
});

// 2026-10-26 production topic-discovery: the gate rejected the whole submission
// because these two PAA paraphrases were appended as separate topics.
test('near-paraphrase PAA questions collapse to one topic before submission', async () => {
  const discoveries = buildSerpApiPaaEntries([
    { question: 'Is Liberty Village a nice area?' },
    { question: 'Is Liberty Village a good place to live?' },
  ], 'Liberty Village Toronto');
  const result = await appendDiscoveredTopics({ version: 1, topics: [] }, discoveries);
  assert.deepEqual(result.added.map((entry) => entry.title), ['Is Liberty Village, Toronto A Nice Area?']);

  const exact = await appendDiscoveredTopics({ version: 1, topics: [] }, [
    { kind: 'blog', title: 'Is Liberty Village, Toronto A Nice Area?', source: 'serpapi', rationale: 'PAA' },
    { kind: 'blog', title: 'Is Liberty Village, Toronto A Good Place To Live?', source: 'serpapi', rationale: 'PAA' },
    { kind: 'blog', title: 'What Is Liberty Village, Toronto Known For?', source: 'serpapi', rationale: 'PAA' },
    { kind: 'blog', title: 'What Is Liberty Village, Toronto Famous For?', source: 'serpapi', rationale: 'PAA' },
    { kind: 'blog', title: 'What Is There To Do In Liberty Village, Toronto?', source: 'serpapi', rationale: 'PAA' },
    { kind: 'blog', title: 'What Are Some Fun Things To Do In Liberty Village, Toronto?', source: 'serpapi', rationale: 'PAA' },
  ]);
  assert.deepEqual(exact.added.map((entry) => entry.title), [
    'Is Liberty Village, Toronto A Nice Area?',
    'What Is Liberty Village, Toronto Known For?',
    'What Is There To Do In Liberty Village, Toronto?',
  ]);

  const queued = await appendDiscoveredTopics({ version: 1, topics: [] }, [
    { kind: 'blog', title: 'Is Liberty Village, Toronto A Good Area?', source: 'serpapi', rationale: 'prior week' },
  ]);
  const nextWeek = await appendDiscoveredTopics(queued.queue, [
    { kind: 'blog', title: 'Is Liberty Village, Toronto A Good Place To Live?', source: 'serpapi', rationale: 'PAA' },
  ]);
  assert.equal(nextWeek.added.length, 0, 'a paraphrase of an already queued topic stays out');
});

test('a paraphrase of a published post is not queued; distinct intents all survive', async () => {
  const publishedPosts = [{ title: 'Is Liberty Village, Toronto a Good Area to Live In?', slug: 'is-liberty-village-toronto-a-good-area' }];
  const result = await appendDiscoveredTopics({ version: 1, topics: [] }, [
    { kind: 'blog', title: 'Is Liberty Village, Toronto A Nice Area?', source: 'serpapi', rationale: 'PAA' },
    { kind: 'blog', title: 'Is Liberty Village, Toronto Safe?', source: 'serpapi', rationale: 'PAA' },
    { kind: 'blog', title: 'How Expensive Is Liberty Village, Toronto?', source: 'serpapi', rationale: 'PAA' },
    { kind: 'blog', title: 'Is Liberty Village, Toronto Walkable?', source: 'serpapi', rationale: 'PAA' },
    { kind: 'blog', title: 'Is Liberty Village, Toronto Good For Families?', source: 'serpapi', rationale: 'PAA' },
    { kind: 'blog', title: 'What Is The Best Place To Eat In Liberty Village, Toronto?', source: 'serpapi', rationale: 'PAA' },
    { kind: 'blog', title: 'What To Do In Liberty Village, Toronto In Winter?', source: 'serpapi', rationale: 'PAA' },
  ], { publishedPosts });
  assert.deepEqual(result.added.map((entry) => entry.title), [
    'Is Liberty Village, Toronto Safe?',
    'How Expensive Is Liberty Village, Toronto?',
    'Is Liberty Village, Toronto Walkable?',
    'Is Liberty Village, Toronto Good For Families?',
    'What Is The Best Place To Eat In Liberty Village, Toronto?',
    'What To Do In Liberty Village, Toronto In Winter?',
  ]);
});

test('every place-to-live wording collapses to one livability topic; other intents stay distinct', async () => {
  const discoveries = buildSerpApiPaaEntries([
    { question: 'Is Liberty Village the best place to live?' },
    { question: 'Is Liberty Village a place to live?' },
    { question: 'Is Liberty Village an ideal neighbourhood?' },
  ], 'Liberty Village Toronto');
  const result = await appendDiscoveredTopics({ version: 1, topics: [] }, discoveries);
  assert.deepEqual(result.added.map((entry) => entry.title), ['Is Liberty Village, Toronto The Best Place To Live?']);

  const queued = await appendDiscoveredTopics({ version: 1, topics: [] }, [
    { kind: 'blog', title: 'Is Liberty Village, Toronto A Good Area?', source: 'serpapi', rationale: 'prior week' },
  ]);
  const controls = await appendDiscoveredTopics(queued.queue, [
    { kind: 'blog', title: 'Living In Liberty Village, Toronto', source: 'serpapi', rationale: 'PAA' },
    { kind: 'blog', title: 'Is Liberty Village, Toronto Safe To Live?', source: 'serpapi', rationale: 'PAA' },
    { kind: 'blog', title: 'Is Liberty Village, Toronto A Good Place For Kids?', source: 'serpapi', rationale: 'PAA' },
    { kind: 'blog', title: 'How Much Is Rent In Liberty Village, Toronto?', source: 'serpapi', rationale: 'PAA' },
    { kind: 'blog', title: 'Where Should I Live In Liberty Village, Toronto?', source: 'serpapi', rationale: 'PAA' },
    { kind: 'blog', title: 'Is Liberty Village, Toronto Worth Visiting?', source: 'serpapi', rationale: 'PAA' },
  ]);
  assert.deepEqual(controls.added.map((entry) => entry.title), [
    'Is Liberty Village, Toronto Safe To Live?',
    'Is Liberty Village, Toronto A Good Place For Kids?',
    'How Much Is Rent In Liberty Village, Toronto?',
    'Where Should I Live In Liberty Village, Toronto?',
    'Is Liberty Village, Toronto Worth Visiting?',
  ]);
});

test('best-places recommendations are not folded into residential livability', async () => {
  const queue = { version: 1, topics: [
    { key: 'g', kind: 'blog', title: 'Is Liberty Village, Toronto A Good Area?', source: 'serpapi', rationale: 'prior week' },
  ] };
  const publishedPosts = [{ title: 'Is Liberty Village, Toronto a Good Area to Live In?', slug: 'is-liberty-village-toronto-a-good-area' }];
  const discoveries = buildSerpApiPaaEntries([
    { question: 'What are the best places in Liberty Village?' },
    { question: 'What is the best area in Liberty Village?' },
    { question: 'Is Liberty Village the best place to live?' },
  ], 'Liberty Village Toronto');
  const result = await appendDiscoveredTopics(queue, discoveries, { publishedPosts });
  assert.deepEqual(result.added.map((entry) => entry.title), [
    'What Are The Best Places In Liberty Village, Toronto?',
    'What Is The Best Area In Liberty Village, Toronto?',
  ]);
});

test('historical raw GSC queue titles block their editorial directory-guide form', async () => {
  // Stored exactly as the 2026-08/09 runs appended them, before editorial titles.
  const queue = { version: 1, topics: [
    { key: 'h', kind: 'blog', title: 'Liberty Village Happy Hour', source: 'gsc', rationale: 'Aug run' },
    { key: 'g', kind: 'blog', title: 'Liberty Village Gyms', source: 'gsc', rationale: 'Sep run' },
  ] };
  const result = await appendDiscoveredTopics(queue, [
    { kind: 'blog', title: 'Liberty Village Happy Hour', source: 'gsc', rationale: 'GSC top query' },
    { kind: 'blog', title: 'liberty village gyms', source: 'gsc', rationale: 'GSC top query' },
    { kind: 'blog', title: 'brunch liberty village', source: 'gsc', rationale: 'GSC top query' },
  ]);
  assert.deepEqual(result.added.map((entry) => entry.title), ['Brunch directory guide in Liberty Village, Toronto']);
});

test('a failing PostHog source is reported, never silent', async (t) => {
  const names = ['GOOGLE_APPLICATION_CREDENTIALS', 'SERPAPI_API_KEY', 'POSTHOG_PERSONAL_API_KEY_LIBERTYVILLAGE'];
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const realFetch = globalThis.fetch;
  t.after(() => {
    for (const name of names) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
    globalThis.fetch = realFetch;
  });
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  delete process.env.SERPAPI_API_KEY;
  process.env.POSTHOG_PERSONAL_API_KEY_LIBERTYVILLAGE = 'test-token';
  globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  const warn = t.mock.method(console, 'warn', () => {});
  const found = await discoverTopics({ now: new Date('2026-10-26T10:00:00Z') });
  assert.deepEqual(found, []);
  assert.equal(warn.mock.callCount(), 1);
  assert.match(String(warn.mock.calls[0].arguments[0]), /^topic discovery: PostHog source failed: /);
});

test('unsupported GSC themes stay out while PostHog titles retain their source', async () => {
  const discoveries = [
    { kind: 'blog', title: 'Liberty Village Farmers Market', source: 'gsc', rationale: 'GSC top query' },
    { kind: 'seo', title: 'Restaurants', source: 'implicit-discovery', rationale: 'PostHog landing' },
  ];

  const result = await appendDiscoveredTopics({ version: 1, topics: [] }, discoveries);

  assert.deepEqual(result.added.map((entry) => entry.title), [
    'Restaurants',
  ]);
  assert.deepEqual(result.added.map((entry) => entry.rationale), ['PostHog landing']);
});

test('topic-discovery is coordinator-gated but never a candidate-ladder kind', () => {
  assert.equal(isGeneratorKind('topic-discovery'), false);
  assert.equal(isGeneratorKind('blog'), true);
});

test('topic-discovery no-fixer policy reaches the runtime finding classifier', () => {
  const sha = 'a'.repeat(40);
  const passing = { overall: 8.5, findings: [], model: GATE_MODEL, commit_sha: sha };
  const rejected = { ...passing, overall: 7.5 };
  assert.equal(KIND_POLICIES['topic-discovery'].noFixer, true);
  assert.deepEqual(classifyFindings('topic-discovery', passing, {
    changedFiles: ['data/topic-queue.json'],
  }), { repairable: [], unrepairable: [], noFixer: true, allUnrepairable: false });
  assert.equal(preflightDecision({
    kind: 'topic-discovery', contentSha: sha, attempts: 0,
    changedFiles: ['data/topic-queue.json'], verdict: passing,
  }), 'go', 'a passing verdict is still a pass, not an unrepairable verdict');
  assert.equal(preflightDecision({
    kind: 'topic-discovery', contentSha: sha, attempts: 0,
    changedFiles: ['data/topic-queue.json'],
    verdict: rejected,
  }), 'unrepairable');
});

test('groundability rejects malformed geography, outside places, navigation and duplicate intent', () => {
  const businesses = [{ id: 'cafe', name: 'Good Cafe', live: true, description: 'Local cafe.' }];
  const check = (title, more = {}) => checkTopicGroundability({ title, kind: 'blog', businesses, ...more });
  for (const title of [
    'Best cafes Liberty Village Toronto Liberty Village Toronto',
    'Liberty Village Liberty Village brunch',
    'Liberty Village Toronto Liberty Village',
    'Best coffee Liberty Village Toronto cafes',
    'Best coffee Toronto Toronto',
  ]) assert.match(check(title).reason, /malformed/);
  assert.match(check('Best brunch in Parkdale').reason, /outside/);
  assert.match(check('Good Cafe hours').reason, /navigation/);
  assert.match(check('Liberty Village cafes', { livePosts: [{ title: 'Cafes in Liberty Village' }] }).reason, /duplicate/);
  assert.match(check('Liberty Village cafes', { consumedFingerprints: [intentFingerprint('Liberty Village cafes')] }).reason, /duplicate/);
});

test('one expected GSC suffix yields a canonical editorial intent without weakening premise checks', () => {
  const records = [
    { id: 'one', live: true, name: 'One', description: 'Happy hour 4-6 and coffee.' },
    { id: 'two', live: true, name: 'Two', description: 'Happy hour 5-7 and coffee.' },
  ];
  const check = (title, more = {}) => checkTopicGroundability({ title, kind: 'blog', businesses: records, ...more });
  const coffee = check('best coffee Liberty Village Toronto');
  assert.equal(coffee.ok, true);
  assert.equal(coffee.editorialTitle, 'best coffee');
  assert.equal(check('best coffee in Liberty Village Toronto?').editorialTitle, 'best coffee?');
  assert.equal(check('best coffee Liberty Village, Toronto').editorialTitle, 'best coffee');
  assert.equal(coffee.fingerprint, check('Best coffee in Liberty Village').fingerprint);
  assert.match(check('best coffee Liberty Village Toronto', { livePosts: [{ title: 'Best coffee in Liberty Village' }] }).reason, /duplicate/);
  assert.deepEqual(check('happy hour Liberty Village Toronto').supportingRecordIds, ['one', 'two']);
  assert.equal(check('pet friendly patios Liberty Village Toronto').ok, false);
  assert.match(check('pet friendly patios Liberty Village Toronto').reason, /unsupported operational premise/);
  assert.match(check('best coffee Liberty Village Toronto Liberty Village Toronto').reason, /malformed/);
});

test('operational claims require two supporting live records and reserve guide needs six facts', () => {
  const records = [
    { id: 'one', live: true, name: 'One', address: '1 Liberty St', hours: 'Happy hour 4-6', description: 'Patio and brunch.' },
    { id: 'two', live: true, name: 'Two', address: '2 Liberty St', description: 'Happy hour 5-7. Patio dining.' },
    { id: 'three', live: true, name: 'Three', website: 'https://example.com', phone: '416-555-0100' },
  ];
  const check = (title, businesses = records) => checkTopicGroundability({ title, kind: 'blog', businesses });
  assert.equal(check('Pet-friendly Liberty Village cafes').ok, false);
  assert.deepEqual(check('Happy hour in Liberty Village').supportingRecordIds, ['one', 'two']);
  assert.equal(check('Happy hour in Liberty Village', records.slice(0, 1)).ok, false);
  const reserve = reserveGuideEligibility({ businesses: records });
  assert.equal(reserve.ok, true);
  assert.equal(reserve.recordIds.length, 3);
  assert.ok(reserve.facts.length >= 6);
  assert.equal(reserveGuideEligibility({ businesses: records.slice(0, 2) }).ok, false);
  assert.equal(reserveGuideEligibility({ businesses: [{ ...records[0], live: false }, ...records.slice(1)] }).ok, false);
  assert.equal(reserve.facts.some((fact) => fact.field === 'price'), false);
});
