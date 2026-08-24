import assert from 'node:assert/strict';
import test from 'node:test';

import { isGeneratorKind } from '../../scripts/automation/candidate-state.mjs';
import {
  appendDiscoveredTopics, buildSerpApiPaaEntries,
} from '../../scripts/automation/topic-queue.mjs';
import { classifyFindings, preflightDecision } from '../../scripts/automation/preflight.mjs';
import { GATE_MODEL, KIND_POLICIES } from '../../scripts/automation/constants.mjs';

test('SerpApi PAA discovery requires the explicit Liberty Village phrase', () => {
  const entries = buildSerpApiPaaEntries([
    { question: 'Where should I eat in Liberty Village?' },
    { question: 'What is happening in Liberty Township?' },
    { question: 'What restaurants are in Liberty?' },
  ], 'Liberty Village restaurants');

  assert.deepEqual(entries.map((entry) => entry.title), ['Where Should I Eat In Liberty Village?']);
  assert.deepEqual(entries.map((entry) => entry.source), ['serpapi']);
});

test('the PAA filter is case-insensitive but does not accept similar place names', () => {
  assert.equal(buildSerpApiPaaEntries([
    { question: 'LIBERTY VILLAGE transit options' },
  ], 'query').length, 1);
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
    'Where Is Brunch In Liberty Village?',
    'How Do I Reach Liberty Village By TTC?',
    'What Patios Are Open In Liberty Village?',
  ]);
});

test('GSC-derived topics remain eligible without the PAA phrase', async () => {
  const discovery = {
    kind: 'blog', title: 'Best patios near the stadium', source: 'gsc',
    rationale: 'GSC top query', addedAt: '2026-08-24T00:00:00.000Z',
  };
  const result = await appendDiscoveredTopics({ version: 1, topics: [] }, [discovery]);
  assert.equal(result.added.length, 1);
  assert.equal(result.added[0].title, discovery.title);
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
