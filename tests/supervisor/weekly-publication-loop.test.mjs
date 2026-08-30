import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFallbackGuide,
  consumePublishedIntent,
  evaluateGateOutcome,
  evaluateRepairRound,
  extractVerbatimSpecifics,
  findQualifyingPublication,
  hasDeferralHedge,
  intentFingerprint,
  isDeadlineLane,
  isoWeekWindow,
  MAX_WEEKLY_FRESH_CANDIDATES,
  MIN_RESOLVING_RECORDS,
  MIN_VERBATIM_SPECIFICS,
  routeFailedGate,
  selectDistinctTopic,
  selectFallbackCategory,
  validateGroundedGuide,
  WEEKLY_PUBLICATION_MISSED,
  weeklyPublicationMissed,
} from '../../scripts/supervisor/weekly-publication-loop.mjs';
import { BLOCKING_SEVERITIES, GATE_MODEL, SCORE_THRESHOLD } from '../../scripts/automation/constants.mjs';

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

test('a repair that regresses, plateaus, or adds a blocker terminates the candidate', () => {
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
  }).action, 'terminate-candidate');
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

  const tooFew = validateGroundedGuide({ content: 'no hedge', specifics: specifics.slice(0, 4), records: RECORDS });
  assert.equal(tooFew.ok, false);

  const tooNarrow = validateGroundedGuide({
    content: 'no hedge',
    specifics: specifics.filter((specific) => specific.recordSlug === 'cafe-a'),
    records: RECORDS,
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
