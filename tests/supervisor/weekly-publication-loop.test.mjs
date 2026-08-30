import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  buildFallbackGuide,
  consumePublishedIntent,
  DEFERRED_TO_DEADLINE,
  evaluateGateOutcome,
  evaluateRepairRound,
  extractVerbatimSpecifics,
  FALLBACK_CATEGORIES,
  findQualifyingPublication,
  hasDeferralHedge,
  intentFingerprint,
  isDeadlineLane,
  isoWeekWindow,
  MAX_WEEKLY_FRESH_CANDIDATES,
  MIN_RESOLVING_RECORDS,
  MIN_VERBATIM_SPECIFICS,
  PUBLISHED_MAIN,
  routeFailedGate,
  runWeeklyGroundedPublicationJourney,
  runWeeklyLane,
  selectDistinctTopic,
  selectFallbackCategory,
  validateGroundedGuide,
  WEEKLY_OBJECTIVE_MET,
  WEEKLY_PUBLICATION_MISSED,
  weeklyPublicationMissed,
} from '../../scripts/supervisor/weekly-publication-loop.mjs';
import { BLOCKING_SEVERITIES, GATE_MODEL, SCORE_THRESHOLD } from '../../scripts/automation/constants.mjs';
import { applyCandidateEvent, emptyCandidateState } from '../../scripts/automation/candidate-state.mjs';

const GATE = Object.freeze({
  model: GATE_MODEL,
  scoreThreshold: SCORE_THRESHOLD,
  blockingSeverities: [...BLOCKING_SEVERITIES],
});

const RECORDS = [
  { slug: 'cafe-a', name: 'Cafe A', text: 'Cafe A operates at 85 Hanna Ave and serves brunch from 9:00 a.m. to 2:00 p.m. with mains priced from $14 to $26.' },
  { slug: 'studio-b', name: 'Studio B', text: 'Studio B runs classes daily from 6:00 a.m. to 10:00 p.m. with drop-in passes at $22.' },
  { slug: 'market-c', name: 'Market C', text: 'Market C opens at 8:00 a.m. daily and stocks local produce with weekly baskets at $34.' },
];

test('the frozen gate profile stays threshold 8 with critical/high blocking severities', () => {
  assert.equal(SCORE_THRESHOLD, 8);
  assert.deepEqual([...BLOCKING_SEVERITIES], ['critical', 'high']);
  assert.equal(GATE_MODEL, 'claude-opus-5');
  assert.equal(MAX_WEEKLY_FRESH_CANDIDATES, 3);
});

test('intent fingerprints are deterministic per topic and distinct across topics', () => {
  const a = intentFingerprint({ title: 'Best Patios in Liberty Village' });
  assert.equal(a, intentFingerprint({ kind: 'blog', title: 'best   patios in liberty village ' }));
  assert.equal(a, intentFingerprint({ kind: 'blog', title: 'Best Patios In Liberty Village' }));
  assert.notEqual(a, intentFingerprint({ title: 'Liberty Village Running Routes' }));
  assert.throws(() => intentFingerprint({ title: '   ' }));
});

test('distinct-topic selection skips attempted, consumed, and slug-colliding topics before generation', () => {
  const candidates = [
    { title: 'Coffee Guide' },
    { title: 'Running Routes' },
    { title: 'Grocery Guide' },
  ];
  const first = selectDistinctTopic({ candidates });
  assert.equal(first.candidate.title, 'Coffee Guide');

  const afterCoffee = selectDistinctTopic({
    candidates,
    excludeFingerprints: [first.fingerprint],
  });
  assert.equal(afterCoffee.candidate.title, 'Running Routes');

  const consumed = selectDistinctTopic({
    candidates,
    consumedFingerprints: [intentFingerprint({ title: 'Coffee Guide' })],
  });
  assert.equal(consumed.candidate.title, 'Running Routes');

  const slugBlocked = selectDistinctTopic({
    candidates: [{ title: 'Coffee Guide', slug: 'coffee-guide' }],
    existingSlugs: ['coffee-guide'],
  });
  assert.equal(slugBlocked.candidate, null, 'an existing article slug must be skipped before model spend');
});

test('a sub-8 score without blocking findings returns to fresh-candidate selection, not the fixer', () => {
  const routing = routeFailedGate(GATE, { overall: 7, findings: [{ severity: 'medium', path: 'data/posts.json', note: 'thin section' }] });
  assert.equal(routing.action, 'advance-topic');
  assert.match(routing.reason, /without blocking findings/);

  const blocking = routeFailedGate(GATE, { overall: 7, findings: [{ severity: 'high', path: 'data/posts.json', note: 'unsupported claim' }] });
  assert.equal(blocking.action, 'dispatch-fixer');

  const unrepairable = routeFailedGate(GATE, {
    overall: 5,
    findings: [{ severity: 'critical', path: 'data/posts.json', note: 'unrepairable' }],
  }, { repairable: false });
  assert.equal(unrepairable.action, 'advance-topic');

  assert.equal(routeFailedGate(GATE, { overall: 9, findings: [] }).action, 'none');
});

test('gate outcomes recompute the decision from the frozen profile', () => {
  assert.equal(evaluateGateOutcome(GATE, { overall: 8, findings: [] }).passed, true);
  assert.equal(evaluateGateOutcome(GATE, { overall: 9, findings: [{ severity: 'medium', path: 'x', note: 'y' }] }).passed, true);
  assert.equal(evaluateGateOutcome(GATE, { overall: 9, findings: [{ severity: 'high', path: 'x', note: 'y' }] }).passed, false);
  assert.equal(evaluateGateOutcome(GATE, { overall: 7, findings: [] }).passed, false);
});

test('a repair that regresses or adds a blocker terminates the candidate', () => {
  assert.equal(evaluateRepairRound({
    previous: { overall: 7.2, blockingCount: 1 },
    latest: { overall: 6.5, blockingCount: 1 },
  }).action, 'terminate-candidate');
  assert.equal(evaluateRepairRound({
    previous: { overall: 7.4, blockingCount: 0 },
    latest: { overall: 7.5, blockingCount: 1 },
  }).action, 'terminate-candidate');
  assert.equal(evaluateRepairRound({
    previous: { overall: 7.0, blockingCount: 1 },
    latest: { overall: 7.0, blockingCount: 1 },
  }).action, 'continue');
  assert.equal(evaluateRepairRound({
    previous: { overall: 6.5, blockingCount: 2 },
    latest: { overall: 7.4, blockingCount: 1 },
  }).action, 'continue');
  assert.equal(evaluateRepairRound({ previous: null, latest: { overall: 7, blockingCount: 1 } }).action, 'continue');
});

test('the weekly success predicate is containment plus ISO-week publication date', () => {
  const week = isoWeekWindow('2026-08-30T11:00:00.000Z');
  assert.equal(week.key, '2026-W35');
  assert.equal(week.start.toISOString(), '2026-08-24T00:00:00.000Z');
  assert.equal(week.end.toISOString(), '2026-08-30T23:59:59.999Z');

  const inWeek = findQualifyingPublication({
    history: [{ sha: 'a'.repeat(40), posts: [{ id: 'p1', slug: 's1', publishedAt: '2026-08-26' }], parentPosts: [] }],
    week,
  });
  assert.equal(inWeek.sha, 'a'.repeat(40));

  const outsideWeek = findQualifyingPublication({
    history: [{ sha: 'a'.repeat(40), posts: [{ id: 'p1', slug: 's1', publishedAt: '2026-09-01' }], parentPosts: [] }],
    week,
  });
  assert.equal(outsideWeek, null, 'an article published outside the ISO week does not satisfy the objective');

  const preexisting = findQualifyingPublication({
    history: [{ sha: 'a'.repeat(40), posts: [{ id: 'p1', publishedAt: '2026-08-26' }], parentPosts: [{ id: 'p1' }] }],
    week,
  });
  assert.equal(preexisting, null, 'a post main already contained is not a new publication');

  assert.equal(isDeadlineLane('2026-08-30T11:00:00.000Z'), true, 'Sunday is the deadline lane');
  assert.equal(isDeadlineLane('2026-09-02T11:00:00.000Z'), false, 'Wednesday is the primary lane');
});

test('verbatim specifics are extracted only from record text and validated fail-closed', () => {
  const specifics = extractVerbatimSpecifics(RECORDS);
  assert.ok(specifics.length >= MIN_VERBATIM_SPECIFICS);
  for (const specific of specifics) {
    const record = RECORDS.find((entry) => entry.slug === specific.recordSlug);
    assert.ok(record.text.includes(specific.text), 'an extracted specific must be a substring of its record');
  }

  const ok = validateGroundedGuide({ content: 'no hedge', specifics, records: RECORDS });
  assert.equal(ok.ok, true);
  assert.ok(ok.specifics >= MIN_VERBATIM_SPECIFICS);
  assert.ok(ok.records >= MIN_RESOLVING_RECORDS);

  const tooFewFallback = validateGroundedGuide({
    content: 'no hedge', specifics: specifics.slice(0, 4), records: RECORDS, mode: 'sunday-grounded-fallback',
  });
  assert.equal(tooFewFallback.ok, false);

  const candidateOk = validateGroundedGuide({
    content: 'no hedge', specifics: specifics.slice(0, 2), records: RECORDS, mode: 'distinct-candidate',
  });
  assert.equal(candidateOk.ok, true, 'the ≥6/≥3 bar applies only to the Sunday fallback');

  const tooNarrow = validateGroundedGuide({
    content: 'no hedge',
    specifics: specifics.filter((specific) => specific.recordSlug === 'cafe-a'),
    records: RECORDS,
    mode: 'sunday-grounded-fallback',
  });
  assert.equal(tooNarrow.ok, false, 'six specifics from one record do not span three resolving records');

  const invented = validateGroundedGuide({
    content: 'no hedge',
    specifics: [...specifics, { text: '999 Fabricated Blvd', recordSlug: 'cafe-a' }],
    records: RECORDS,
  });
  assert.equal(invented.ok, true, 'a fabricated specific is simply not counted');
  assert.equal(invented.specifics, specifics.length);
});

test('deferral hedges are detected in every documented shape', () => {
  for (const text of [
    'Check current listings before you visit.',
    'Verify hours with each venue.',
    'Call ahead to confirm availability.',
    'See their website for updated pricing.',
    'Research the latest schedules before going.',
  ]) {
    assert.equal(hasDeferralHedge(text), true, `hedge not detected: ${text}`);
  }
  assert.equal(hasDeferralHedge('Brunch runs 9:00 a.m. to 2:00 p.m. with mains from $14 to $26.'), false);
  assert.equal(hasDeferralHedge(''), false);
});

test('duplicate specifics count once toward the fallback bar', () => {
  const duplicated = [
    { text: '85 Hanna Ave', recordSlug: 'cafe-a' },
    { text: '85 Hanna Ave', recordSlug: 'cafe-a' },
    { text: '85 Hanna Ave', recordSlug: 'cafe-a' },
    { text: '85 Hanna Ave', recordSlug: 'cafe-a' },
    { text: '85 Hanna Ave', recordSlug: 'cafe-a' },
    { text: '85 Hanna Ave', recordSlug: 'cafe-a' },
  ];
  const result = validateGroundedGuide({
    content: 'no hedge', specifics: duplicated, records: RECORDS, mode: 'sunday-grounded-fallback',
  });
  assert.equal(result.ok, false);
  assert.equal(result.specifics, 1);
});

test('the fallback guide needs six verbatim specifics across three records and an unused category', () => {
  const { guide, validation } = buildFallbackGuide({
    records: RECORDS,
    usedCategories: ['food-drink'],
    publishedAt: '2026-08-30',
    id: 'fallback-1',
  });
  assert.equal(guide.id, 'fallback-1');
  assert.equal(guide.grounded, true);
  assert.notEqual(guide.category, 'food-drink', 'the fallback category must be unused');
  assert.equal(validation.ok, true);
  assert.ok(validation.specifics >= MIN_VERBATIM_SPECIFICS);
  assert.ok(validation.records >= MIN_RESOLVING_RECORDS);
  assert.equal(hasDeferralHedge(guide.content), false);

  assert.throws(() => buildFallbackGuide({
    records: RECORDS.slice(0, 1),
    usedCategories: [],
    publishedAt: '2026-08-30',
    id: 'fallback-2',
  }), /not publishable/, 'a single record cannot back the fallback guide');

  assert.equal(selectFallbackCategory(['lifestyle', 'community', 'food-drink', 'transit', 'real-estate', 'development', 'events']), 'news');
});

test('fallback intent and slug stay unique after every category is already used', () => {
  const used = [...FALLBACK_CATEGORIES];
  const first = buildFallbackGuide({
    records: RECORDS, usedCategories: used, publishedAt: '2026-08-30', id: 'week-35',
  });
  const second = buildFallbackGuide({
    records: RECORDS, usedCategories: used, publishedAt: '2026-09-06', id: 'week-36',
  });
  assert.equal(first.guide.category, 'lifestyle');
  assert.equal(second.guide.category, 'lifestyle');
  assert.notEqual(first.guide.slug, second.guide.slug);
  assert.notEqual(first.guide.title, second.guide.title);
  assert.notEqual(
    intentFingerprint({ title: first.guide.title }),
    intentFingerprint({ title: second.guide.title }),
  );
  assert.match(first.guide.slug, /2026-w35/);
  assert.match(second.guide.slug, /2026-w36/);
});

test('fallback guide is bounded to three records and six unique specifics', () => {
  const many = Array.from({ length: 20 }, (_, index) => ({
    slug: `record-${index}`,
    name: `Record ${index}`,
    text: `Record ${index} at ${100 + index} King St opens 9:00 a.m. with mains from $${10 + index} to $${20 + index}.`,
  }));
  const { guide, validation } = buildFallbackGuide({
    records: many, usedCategories: [], publishedAt: '2026-08-30', id: 'bounded',
  });
  assert.equal(validation.ok, true);
  assert.equal(validation.records, MIN_RESOLVING_RECORDS);
  assert.equal(validation.specifics, MIN_VERBATIM_SPECIFICS);
  assert.equal(guide.specifics.length, MIN_VERBATIM_SPECIFICS);
  assert.equal(new Set(guide.specifics.map((specific) => specific.recordSlug)).size, MIN_RESOLVING_RECORDS);
  assert.ok(guide.content.length < 2500);
});

test('intent consumption happens only after verified containment', () => {
  const fingerprint = intentFingerprint({ title: 'Coffee Guide' });
  const notContained = consumePublishedIntent([], { fingerprint, contained: false });
  assert.equal(notContained.consumedNow, false);
  assert.equal(notContained.consumed.has(fingerprint), false);

  const consumed = consumePublishedIntent([], { fingerprint, contained: true });
  assert.equal(consumed.consumedNow, true);
  const replay = consumePublishedIntent(consumed.consumed, { fingerprint, contained: true });
  assert.equal(replay.consumedNow, false, 'a consumed fingerprint cannot be consumed twice');

  const skipped = selectDistinctTopic({
    candidates: [{ title: 'Coffee Guide' }],
    consumedFingerprints: [fingerprint],
  });
  assert.equal(skipped.candidate, null, 'a consumed fingerprint blocks regeneration under a near-duplicate slug');
});

test('a missed week produces exactly one terminal with week, fingerprints, stages, and links', () => {
  const missed = weeklyPublicationMissed({
    week: '2026-W36',
    attemptedFingerprints: ['f1', 'f2'],
    failureStages: ['c1:rejected', 'c2:rejected', 'fallback:rejected'],
    runUrl: 'https://example/run/1',
    prUrl: 'https://example/pr/2',
  });
  assert.equal(missed.claimedTerminal, WEEKLY_PUBLICATION_MISSED);
  assert.equal(missed.week, '2026-W36');
  assert.deepEqual(missed.attemptedFingerprints, ['f1', 'f2']);
  assert.deepEqual(missed.failureStages, ['c1:rejected', 'c2:rejected', 'fallback:rejected']);
  assert.equal(missed.runUrl, 'https://example/run/1');
  assert.equal(missed.prUrl, 'https://example/pr/2');
  assert.throws(() => weeklyPublicationMissed({}), /ISO week/);
});

test('durable consume-intent marks the topic consumed after verified publication', () => {
  const applied = applyCandidateEvent(emptyCandidateState('blog'), {
    key: 'blog:run-1',
    action: 'consume-intent',
    at: '2026-08-30T11:00:00.000Z',
    topicKey: 'topic-coffee',
    reason: 'contained in origin/main',
    outcome: 'PUBLISHED_MAIN',
  });
  assert.equal(applied.changed, true);
  assert.equal(applied.state.topics['topic-coffee'].consumed, true);
  assert.equal(applied.state.topics['topic-coffee'].outcome, 'PUBLISHED_MAIN');
  const replay = applyCandidateEvent(applied.state, {
    key: 'blog:run-1',
    action: 'consume-intent',
    topicKey: 'topic-coffee',
    outcome: 'PUBLISHED_MAIN',
  });
  assert.equal(replay.changed, false);
});

test('image inventory includes neighborhood and og paths and optional dirs fail safely', () => {
  const source = fs.readFileSync(new URL('../../scripts/automation/review-agent.mjs', import.meta.url), 'utf8');
  assert.match(source, /dir: 'public\/images\/blog'[\s\S]*required: true/);
  assert.match(source, /dir: 'public\/images\/neighborhood'[\s\S]*required: false/);
  assert.match(source, /dir: 'public\/images\/og'[\s\S]*required: false/);
  assert.match(source, /neighborhoodImages/);
  assert.match(source, /ogImages/);
});

test('abandoned topics do not consume the fresh-candidate budget', async () => {
  const ran = [];
  const keys = ['topic-a', 'topic-b', 'topic-c', 'topic-d'];
  const result = await runWeeklyLane({
    scheduledAt: '2026-09-02T11:00:00.000Z',
    maxFresh: 1,
    fetchTarget: async () => {},
    readPublicationHistory: async () => [],
    resolveTopic: async ({ excludeTopicKeys }) => {
      const key = keys.find((entry) => !excludeTopicKeys.includes(entry));
      return key ? { topic_key: key, topic_title: key } : { topic_key: null };
    },
    planCandidate: async (topic) => (
      topic.topic_key === 'topic-d'
        ? { action: 'generate', generate: 'true', topic_key: 'topic-d' }
        : { action: 'abandon-topic', generate: 'false', topic_key: topic.topic_key }
    ),
    runCandidate: async ({ topic }) => {
      ran.push(topic.topic_key);
      return { terminal: PUBLISHED_MAIN, topic_key: topic.topic_key };
    },
  });
  assert.deepEqual(ran, ['topic-d']);
  assert.equal(result.terminal, PUBLISHED_MAIN);
});

test('dry run stays DRY_RUN and never plans, generates, or claims a publication', async () => {
  let planned = false;
  let generated = false;
  const result = await runWeeklyLane({
    scheduledAt: '2026-08-30T11:00:00.000Z',
    dryRun: true,
    fetchTarget: async () => {},
    readPublicationHistory: async () => {
      throw new Error('dry-run must not inspect publication history');
    },
    resolveTopic: async () => ({ topic_key: 'one', topic_title: 'One' }),
    planCandidate: async () => { planned = true; return { generate: 'true' }; },
    runCandidate: async () => { generated = true; return { terminal: PUBLISHED_MAIN }; },
    runFallback: async () => { generated = true; return { terminal: PUBLISHED_MAIN }; },
  });
  assert.equal(result.terminal, 'DRY_RUN');
  assert.equal(result.topic_key, 'one');
  assert.equal(planned, false);
  assert.equal(generated, false);
});

test('the weekly lane continues after abandonment instead of stopping', async () => {
  const resolved = [];
  const planned = [];
  const ran = [];
  const result = await runWeeklyLane({
    scheduledAt: '2026-09-02T11:00:00.000Z',
    fetchTarget: async () => { resolved.push('fetched-origin-main'); },
    readPublicationHistory: async () => [],
    resolveTopic: async ({ excludeTopicKeys }) => {
      if (excludeTopicKeys.includes('topic-a')) {
        return { topic_key: 'topic-b', topic_title: 'Running Routes' };
      }
      return { topic_key: 'topic-a', topic_title: 'Coffee Guide' };
    },
    planCandidate: async (topic) => {
      planned.push(topic.topic_key);
      if (topic.topic_key === 'topic-a') return { action: 'abandon-topic', generate: 'false', topic_key: 'topic-a' };
      return { action: 'generate', generate: 'true', topic_key: 'topic-b', regenerations: 0 };
    },
    runCandidate: async ({ topic }) => {
      ran.push(topic.topic_key);
      return { terminal: PUBLISHED_MAIN, topic_key: topic.topic_key, sha: 'a'.repeat(40) };
    },
    consumeIntent: async () => {},
  });
  assert.deepEqual(resolved, ['fetched-origin-main']);
  assert.deepEqual(planned, ['topic-a', 'topic-b']);
  assert.deepEqual(ran, ['topic-b']);
  assert.equal(result.terminal, PUBLISHED_MAIN);
  assert.equal(result.topic_key, 'topic-b');
});

test('Wednesday defers after a bounded miss; Sunday no-ops when origin/main already has the week', async () => {
  const deferred = await runWeeklyLane({
    scheduledAt: '2026-09-02T11:00:00.000Z',
    fetchTarget: async () => {},
    readPublicationHistory: async () => [],
    resolveTopic: async () => ({ topic_key: null }),
    planCandidate: async () => ({ generate: 'false', action: 'wait', reason: 'no eligible topics' }),
    runCandidate: async () => ({ terminal: 'SKIPPED_CANDIDATE' }),
  });
  assert.equal(deferred.terminal, DEFERRED_TO_DEADLINE);

  const week = isoWeekWindow('2026-08-30T11:00:00.000Z');
  const met = await runWeeklyLane({
    scheduledAt: '2026-08-30T11:00:00.000Z',
    fetchTarget: async () => {},
    readPublicationHistory: async () => [{
      sha: 'b'.repeat(40),
      posts: [{ id: 'already', slug: 'already', publishedAt: week.start.toISOString() }],
      parentPosts: [],
    }],
    resolveTopic: async () => { throw new Error('must not resolve after the week is already satisfied'); },
    planCandidate: async () => ({ generate: 'false' }),
    runCandidate: async () => ({ terminal: PUBLISHED_MAIN }),
  });
  assert.equal(met.terminal, WEEKLY_OBJECTIVE_MET);
  assert.equal(met.publication.articleCommit, 'b'.repeat(40));
});

test('malformed publication history is an explicit missed terminal, not a silent success', async () => {
  const result = await runWeeklyLane({
    scheduledAt: '2026-08-30T11:00:00.000Z',
    fetchTarget: async () => {},
    readPublicationHistory: async () => { throw new Error('data/posts.json at origin/main is not a JSON array'); },
    resolveTopic: async () => ({ topic_key: 'x' }),
    planCandidate: async () => ({ generate: 'true' }),
    runCandidate: async () => ({ terminal: PUBLISHED_MAIN }),
  });
  assert.equal(result.terminal, WEEKLY_PUBLICATION_MISSED);
  assert.match(result.publication.failureStages[0], /history:malformed/);
});

test('the journey never checks out the caller repo and keeps uncommitted work', async () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-weekly-checkout-'));
  const git = (args) => execFileSync('git', args, {
    cwd: repoPath, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_AUTHOR_DATE: '2026-08-30T11:00:00.000Z', GIT_COMMITTER_DATE: '2026-08-30T11:00:00.000Z' },
  }).trim();
  git(['init', '-b', 'main']);
  git(['config', 'user.name', 'Weekly Loop']);
  git(['config', 'user.email', 'weekly@example.invalid']);
  fs.mkdirSync(path.join(repoPath, 'data'), { recursive: true });
  fs.writeFileSync(path.join(repoPath, 'data/posts.json'), '[]\n');
  git(['add', 'data/posts.json']);
  git(['commit', '-m', 'seed']);
  const baseCommit = git(['rev-parse', 'HEAD']);
  git(['checkout', '-b', 'caller-work']);
  fs.writeFileSync(path.join(repoPath, 'dirty.txt'), 'uncommitted caller work\n');
  const beforeHead = git(['rev-parse', '--abbrev-ref', 'HEAD']);

  const result = await runWeeklyGroundedPublicationJourney({
    repoPath,
    targetBranch: 'main',
    baseCommit,
    scheduledAt: '2026-08-30T11:00:00.000Z',
    gate: { model: GATE_MODEL, scoreThreshold: SCORE_THRESHOLD, blockingSeverities: [...BLOCKING_SEVERITIES] },
    seed: {
      firstCandidateId: 'seeded-first-candidate',
      distinctCandidateId: 'seeded-distinct-candidate',
      sundayFallbackId: 'seeded-sunday-grounded-fallback',
    },
  });

  assert.equal(git(['rev-parse', '--abbrev-ref', 'HEAD']), beforeHead);
  assert.equal(fs.readFileSync(path.join(repoPath, 'dirty.txt'), 'utf8'), 'uncommitted caller work\n');
  assert.equal(result.publication?.claimedTerminal, PUBLISHED_MAIN);
  git(['merge-base', '--is-ancestor', result.publication.articleCommit, 'refs/heads/main']);
  fs.rmSync(repoPath, { recursive: true, force: true });
});

test('host-run wires the weekly lane and fetches origin/main for containment', () => {
  const host = fs.readFileSync(new URL('../../scripts/supervisor/host-run.mjs', import.meta.url), 'utf8');
  assert.match(host, /runWeeklyLane\(/);
  assert.match(host, /fetch', '--no-tags', 'origin', 'main'/);
  assert.match(host, /branchPublicationHistory\(gitAtRepo, 'origin\/main'\)/);
  assert.match(host, /exclude-topic-keys/);
  assert.match(host, /terminal: PUBLISHED_MAIN/);
  assert.match(host, /releaseDataBranch\(\)/);
  assert.match(host, /result\.terminal !== PUBLISHED_MAIN/);
  assert.doesNotMatch(host, /if \(candidate\.generate !== 'true'\) return \{ terminal: candidate\.action === 'abandon-topic' \? 'ABANDONED_TOPIC'/);
  assert.doesNotMatch(host, /export function resolveCandidateReadOnly/);
  assert.doesNotMatch(host, /export async function boundedCandidateFlow/);
});

