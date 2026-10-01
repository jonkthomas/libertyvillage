import assert from 'node:assert/strict';
import test from 'node:test';

import { isGeneratorKind } from '../../scripts/automation/candidate-state.mjs';
import {
  appendDiscoveredTopics, buildSerpApiPaaEntries, checkTopicGroundability,
  reserveGuideEligibility, intentFingerprint,
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
  assert.equal(result.added[0].title, 'Best patios near the stadium Liberty Village Toronto');
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
    'Liberty Village Happy Hour',
    'Jukebox Printing Liberty Village Toronto',
    'Is Liberty Village, Toronto A Good Area?',
    'What Is Liberty Village, Toronto Known For?',
  ]);
  assert.deepEqual(result.added.map((entry) => entry.rationale), [
    'higher priority', 'local business query', 'specific', 'valid PAA',
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

test('local GSC titles and PostHog titles remain unchanged', async () => {
  const discoveries = [
    { kind: 'blog', title: 'Liberty Village Farmers Market', source: 'gsc', rationale: 'GSC top query' },
    { kind: 'seo', title: 'Restaurants', source: 'implicit-discovery', rationale: 'PostHog landing' },
  ];

  const result = await appendDiscoveredTopics({ version: 1, topics: [] }, discoveries);

  assert.deepEqual(result.added.map((entry) => entry.title), [
    'Liberty Village Farmers Market',
    'Restaurants',
  ]);
  assert.deepEqual(result.added.map((entry) => entry.rationale), ['GSC top query', 'PostHog landing']);
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
