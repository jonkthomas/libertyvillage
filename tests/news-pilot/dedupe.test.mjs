import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  clusterCandidates,
  dedupeAndMarkCovered,
  extractCivicProjectAnchor,
  extractNewDevelopmentSignals,
  extractPostIndex,
  hasSportingMatchup,
  isTrustedRecentDate,
  matchExistingPost,
  sameStory,
} from '../../scripts/news-pilot/dedupe.mjs';
import { makeCandidate } from '../../scripts/news-pilot/normalize.mjs';
import {
  detectConcludedTimeBoundEvent,
  reviewRankMetric,
  scoreCandidate,
  SCORE_CONFIG,
} from '../../scripts/news-pilot/score.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function cand(partial) {
  return {
    id: partial.id,
    sourceId: partial.sourceId,
    sourceTier: partial.sourceTier || 'lead',
    title: partial.title,
    url: partial.url,
    canonicalUrl: partial.canonicalUrl || partial.url,
    publishedAt: partial.publishedAt || '2026-08-07T12:00:00.000Z',
    dateConfidence: partial.dateConfidence || 'exact',
    urlUsable: partial.urlUsable !== false,
    snippet: partial.snippet || '',
    rawTextSample: partial.rawTextSample || '',
    publisherDomain: partial.publisherDomain,
    applicationNumber: partial.applicationNumber,
    addressKey: partial.addressKey,
  };
}

test('same story from 3 sources collapses to 1 cluster', () => {
  const a = cand({
    id: 'a',
    sourceId: 'serper-q-liberty-village',
    title: 'Liberty Village streetcar delays after water main break',
    url: 'https://news.example.com/lv-watermain?utm_source=serper',
    canonicalUrl: 'https://news.example.com/lv-watermain',
    publisherDomain: 'example.com',
    snippet: 'TTC service change near King Street West and Liberty Village.',
  });
  const b = cand({
    id: 'b',
    sourceId: 'cbc-toronto-rss',
    title: 'Liberty Village streetcar delays after watermain break',
    url: 'https://www.cbc.ca/news/lv-watermain',
    canonicalUrl: 'https://cbc.ca/news/lv-watermain',
    publisherDomain: 'cbc.ca',
    snippet: 'Delays on the King streetcar after a water main break in Liberty Village.',
  });
  const c = cand({
    id: 'c',
    sourceId: 'global-toronto-rss',
    title: 'Streetcar delays hit Liberty Village after water main break',
    url: 'https://globalnews.ca/news/lv-watermain-break',
    canonicalUrl: 'https://globalnews.ca/news/lv-watermain-break',
    publisherDomain: 'globalnews.ca',
    snippet: 'Liberty Village transit delays tied to construction crews fixing a water main.',
  });

  assert.equal(sameStory(a, b).match, true);
  assert.equal(sameStory(b, c).match || sameStory(a, c).match, true);

  const clusters = clusterCandidates([a, b, c]);
  assert.equal(clusters.length, 1, `expected 1 cluster, got ${clusters.length}`);
  assert.equal(clusters[0].members.length, 3);
  // Distinct publishers (not sourceId count alone — here they coincide at 3)
  assert.equal(clusters[0].independentPublisherCount, 3);
  assert.equal(clusters[0].independentSourceCount, 3);
  assert.deepEqual(new Set(clusters[0].sourceIds).size, 3);
});

test('story matching an existing post is flagged alreadyCovered', () => {
  const candidate = cand({
    id: 'x',
    sourceId: 'star-lv-search-rss',
    title: 'FIFA World Cup 2026 in Liberty Village: Your Survival Guide',
    url: 'https://example.com/external-fifa-lv',
    snippet: 'How residents can prepare for World Cup crowds in Liberty Village.',
  });

  const posts = [
    {
      slug: 'fifa-world-cup-2026-liberty-village-survival-guide',
      title: 'FIFA World Cup 2026 in Liberty Village: Your Survival Guide',
      tags: ['fifa-world-cup', 'bmo-field'],
    },
    {
      slug: 'dog-owners-guide-liberty-village',
      title: "The Complete Dog Owner's Guide to Liberty Village",
      tags: [],
    },
  ];

  const hit = matchExistingPost(candidate, posts);
  assert.equal(hit.alreadyCovered, true);
  assert.equal(hit.coverageRelation, 'duplicate');
  assert.equal(hit.matchingSlug, 'fifa-world-cup-2026-liberty-village-survival-guide');

  const { candidates } = dedupeAndMarkCovered([candidate], posts);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].alreadyCovered, true);
  assert.equal(candidates[0].coverageRelation, 'duplicate');
  assert.equal(candidates[0].matchingSlug, 'fifa-world-cup-2026-liberty-village-survival-guide');
});

test('true rehash of World Cup survival guide is duplicate against real posts', () => {
  const postsPath = path.join(ROOT, 'data', 'posts.json');
  const postsJson = JSON.parse(fs.readFileSync(postsPath, 'utf8'));
  const posts = extractPostIndex(postsJson);

  const worldCupPost = posts.find((p) => p.slug === 'fifa-world-cup-2026-liberty-village-survival-guide');
  assert.ok(worldCupPost, 'expected real World Cup post in data/posts.json');

  // Near-identical angle to the existing survival guide — not a new development.
  const rehash = cand({
    id: 'wc-rehash',
    sourceId: 'serper-q-liberty-village',
    title: 'FIFA World Cup 2026 in Liberty Village: Your Survival Guide for residents',
    url: 'https://www.thestar.com/entertainment/world-cup-liberty-village-survival',
    snippet:
      'How residents can prepare for World Cup crowds, trash, traffic and noise in Liberty Village.',
  });

  const hit = matchExistingPost(rehash, posts);
  assert.equal(hit.coverageRelation, 'duplicate');
  assert.equal(hit.alreadyCovered, true);
  assert.equal(hit.matchingSlug, 'fifa-world-cup-2026-liberty-village-survival-guide');
  assert.match(String(hit.reason || hit.coverageReason), /duplicate/i);
});

test('World Cup traffic/road-closure story is follow-up, not hard-rejected, vs real posts', () => {
  const postsPath = path.join(ROOT, 'data', 'posts.json');
  const postsJson = JSON.parse(fs.readFileSync(postsPath, 'utf8'));
  const posts = extractPostIndex(postsJson);

  const worldCupPost = posts.find((p) => /world.?cup|fifa/i.test(`${p.slug} ${p.title}`));
  assert.ok(worldCupPost, 'expected at least one real World Cup post');

  // Evaluate as-of match night so relative novelty is still trusted.
  const matchNightMs = Date.parse('2026-06-20T20:00:00.000Z');

  // Distinct reader need from dining/where-to-watch coverage: match-night traffic readiness.
  const traffic = cand({
    id: 'wc-traffic',
    sourceId: 'serper-q-liberty-village',
    title:
      'Ghana vs. Panama tonight brings road closures to Liberty Village, Fort York and Exhibition Place',
    url: 'https://www.cp24.com/news/ghana-panama-road-closures-liberty-village',
    snippet:
      'TTC detours and lane closures start tonight around Liberty Village as Ghana vs Panama fans head to BMO Field.',
    publishedAt: '2026-06-20T18:00:00.000Z',
    dateConfidence: 'exact',
  });

  const hit = matchExistingPost(traffic, posts, { nowMs: matchNightMs });
  assert.equal(hit.coverageRelation, 'follow-up', `got ${hit.coverageRelation}: ${hit.reason}`);
  assert.equal(hit.alreadyCovered, false, 'follow-up must not hard-reject via alreadyCovered');
  assert.ok(hit.matchingSlug, 'must link an existing World Cup post slug');
  assert.match(hit.matchingSlug, /world-cup|fifa|bmo|road-closure|parking|match/i);
  assert.match(String(hit.reason || hit.coverageReason), /follow-up/i);

  const { candidates } = dedupeAndMarkCovered([traffic], posts, { nowMs: matchNightMs });
  assert.equal(candidates[0].coverageRelation, 'follow-up');
  assert.equal(candidates[0].alreadyCovered, false);
  assert.equal(candidates[0].relatedPostSlug, hit.matchingSlug);
});

test('Ontario Line new development is follow-up; restatement is duplicate (real posts)', () => {
  const postsPath = path.join(ROOT, 'data', 'posts.json');
  const postsJson = JSON.parse(fs.readFileSync(postsPath, 'utf8'));
  const posts = extractPostIndex(postsJson);

  const ontarioPost = posts.find((p) => p.slug === 'ontario-line-construction-liberty-village-2026');
  assert.ok(ontarioPost, 'expected real Ontario Line post in data/posts.json');

  const restatement = cand({
    id: 'ol-rehash',
    sourceId: 'serper-q-lv-development',
    title: 'Ontario Line Construction in Liberty Village: 2026 Update on tunnelling',
    url: 'https://urbantoronto.ca/news/ontario-line-construction-lv-2026-update',
    snippet:
      'How Ontario Line construction is affecting Liberty Village in 2026 — tunnel boring timelines, haul routes, road closures, and what it means for your commute.',
    publishedAt: '2026-02-10T12:00:00.000Z',
  });

  const freshDev = cand({
    id: 'ol-new',
    sourceId: 'serper-q-lv-development',
    title:
      'Metrolinx approves Exhibition Ontario Line station secondary entrance design near Liberty Village',
    url: 'https://urbantoronto.ca/news/ontario-line-exhibition-entrance-approved',
    snippet:
      'A new overnight closure on Strachan Avenue starts Monday after Metrolinx approved the station design decision for the Exhibition Ontario Line stop.',
    publishedAt: '2026-08-01T12:00:00.000Z',
  });

  const dup = matchExistingPost(restatement, posts);
  assert.equal(dup.coverageRelation, 'duplicate', `restatement got ${dup.coverageRelation}: ${dup.reason}`);
  assert.equal(dup.alreadyCovered, true);
  assert.equal(dup.matchingSlug, 'ontario-line-construction-liberty-village-2026');

  const fu = matchExistingPost(freshDev, posts);
  assert.equal(fu.coverageRelation, 'follow-up', `new dev got ${fu.coverageRelation}: ${fu.reason}`);
  assert.equal(fu.alreadyCovered, false);
  assert.equal(fu.matchingSlug, 'ontario-line-construction-liberty-village-2026');
  assert.match(String(fu.reason || fu.coverageReason), /follow-up|new development|new angle/i);
});

test('unrelated titles do not cluster', () => {
  const a = cand({
    id: '1',
    sourceId: 's1',
    title: 'New coffee shop opens on Atlantic Avenue in Liberty Village',
    url: 'https://a.example/coffee',
  });
  const b = cand({
    id: '2',
    sourceId: 's2',
    title: 'Province announces highway toll study for northern Ontario',
    url: 'https://b.example/tolls',
    publishedAt: '2026-08-01T12:00:00.000Z',
  });
  const clusters = clusterCandidates([a, b]);
  assert.equal(clusters.length, 2);
});

test('cluster representative prefers usable publisher URL over google goto', () => {
  const gotoUrl =
    'https://www.google.com/goto?url=CAESkwEB7keqTfKg-gbf9vZksIowhJ5YArErLGDec4gUZy_YNF0Yt0Wxtz';
  const clean = makeCandidate({
    sourceId: 'serpapi-q-lv-development',
    sourceTier: 'lead',
    title: "Liberty Village's famous Carpet Factory may soon have a tower soaring above it",
    url: 'https://torontolife.com/real-estate/liberty-village-carpet-factory-hullmark-rentals-hotels',
    publishedAt: '2026-07-17T12:00:00.000Z',
    snippet: 'Hullmark proposal above the Carpet Factory in Liberty Village.',
  });
  const broken = makeCandidate({
    sourceId: 'serper-q-lv-development',
    sourceTier: 'lead',
    title: "Liberty Village's famous Carpet Factory may soon have a tower soaring above it",
    url: gotoUrl,
    publishedAt: '3 weeks ago',
    snippet: 'Hullmark proposal above the Carpet Factory in Liberty Village.',
    nowMs: Date.parse('2026-08-07T18:00:00.000Z'),
  });

  assert.equal(clean.urlUsable, true);
  assert.equal(broken.urlUsable, false);

  const clusters = clusterCandidates([broken, clean]);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].clusterHasUsableUrl, true);
  const rep = clusters[0].members.find(
    (_, i) => clusters[0].memberIndexes[i] === clusters[0].representativeIndex,
  ) || clusters[0].members[clusters[0].memberIndexes.indexOf(clusters[0].representativeIndex)];
  // representativeIndex is an index into the original candidates array
  const repCandidate = [broken, clean][clusters[0].representativeIndex];
  assert.equal(repCandidate.urlUsable, true);
  assert.match(repCandidate.canonicalUrl || repCandidate.url, /torontolife\.com/);
  assert.equal(/google\.com\/goto/i.test(repCandidate.url), false);
});

test('distinct CKAN development applications do not merge on boilerplate titles', () => {
  const a = cand({
    id: 'ck1',
    sourceId: 'ckan-dev-apps-lv',
    sourceTier: 'official',
    title: 'Development application 26 210726 STE 09 SA — 1423 DUFFERIN ST',
    url: 'https://www.toronto.ca/city-government/planning-development/application-information-centre/',
    applicationNumber: '26 210726 STE 09 SA',
    addressKey: '1423 DUFFERIN',
    snippet: 'Status: Under Review. Rezoning for mixed-use building.',
  });
  const b = cand({
    id: 'ck2',
    sourceId: 'ckan-dev-apps-lv',
    sourceTier: 'official',
    title: 'Development application 26 210187 NNY 08 OZ — 3180 DUFFERIN ST',
    url: 'https://www.toronto.ca/city-government/planning-development/application-information-centre/',
    applicationNumber: '26 210187 NNY 08 OZ',
    addressKey: '3180 DUFFERIN',
    snippet: 'Status: Under Review. Official plan amendment.',
  });
  const c = cand({
    id: 'ck3',
    sourceId: 'ckan-dev-apps-lv',
    sourceTier: 'official',
    title: 'Development application 26 213803 STE 04 SA — 3 CLOSE AVE',
    url: 'https://www.toronto.ca/city-government/planning-development/application-information-centre/',
    applicationNumber: '26 213803 STE 04 SA',
    addressKey: '3 CLOSE',
    snippet: 'Status: Under Review. Site plan for residential building.',
  });

  assert.equal(sameStory(a, b).match, false);
  assert.equal(sameStory(a, c).match, false);
  const clusters = clusterCandidates([a, b, c]);
  assert.equal(clusters.length, 3, `expected 3 clusters, got ${clusters.length}`);
});

test('same-day police theft story with divergent headlines merges via entity+date', () => {
  const a = cand({
    id: 'p1',
    sourceId: 'serpapi-q-liberty-village',
    title:
      'Toronto police officers “likely” stole $5,000 from a Liberty Village apartment, according to a judge',
    url: 'https://torontolife.com/city/toronto-police-officers-likely-stole-5000',
    publishedAt: '2026-08-06T20:44:00.000Z',
    snippet: 'A judge found officers likely stole $5,000 during a search in Liberty Village.',
  });
  const b = cand({
    id: 'p2',
    sourceId: 'serper-q-liberty-village',
    title:
      "Judge tosses drug charges after finding $5K ‘likely’ stolen during police search of Toronto man’s apartment",
    url: 'https://www.cp24.com/local/toronto/2026/08/06/judge-tosses-drug-charges',
    publishedAt: '2026-08-06T19:23:00.000Z',
    snippet: 'Judge says $5,000 was likely stolen by police during apartment search.',
  });
  const c = cand({
    id: 'p3',
    sourceId: 'star-lv-search-rss',
    title:
      "Judge finds Toronto drug squad officers 'likely' stole $5,000 from fitness coach, stays cocaine charges",
    url: 'https://www.thestar.com/news/gta/judge-finds-toronto-drug-squad-officers-likely',
    publishedAt: '2026-08-06T09:00:00.000Z',
    snippet: 'Fitness coach says police stole $5,000; judge stays charges.',
  });

  const clusters = clusterCandidates([a, b, c]);
  assert.equal(clusters.length, 1, `expected 1 police cluster, got ${clusters.length}`);
  assert.equal(clusters[0].members.length, 3);
});

test('follow-up does not become auto-eligible even with a high score', async () => {
  const { decideFinal } = await import('../../scripts/news-pilot/run.mjs');

  const postsPath = path.join(ROOT, 'data', 'posts.json');
  const posts = extractPostIndex(JSON.parse(fs.readFileSync(postsPath, 'utf8')));
  const matchNightMs = Date.parse('2026-06-20T20:00:00.000Z');

  const traffic = cand({
    id: 'wc-traffic-auto',
    sourceId: 'cbc-toronto-rss',
    sourceTier: 'reputable',
    title:
      'Ghana vs. Panama tonight brings road closures to Liberty Village, Fort York and Exhibition Place',
    url: 'https://www.cbc.ca/news/canada/toronto/ghana-panama-road-closures-lv',
    snippet:
      'Road closures and TTC detours hit Liberty Village tonight for the Ghana vs Panama match at BMO Field.',
    publishedAt: '2026-06-20T18:00:00.000Z',
    dateConfidence: 'exact',
  });

  const coverage = matchExistingPost(traffic, posts, { nowMs: matchNightMs });
  assert.equal(coverage.coverageRelation, 'follow-up');

  const scored = scoreCandidate(traffic, {
    nowMs: matchNightMs,
    clusterInfo: {
      independentPublisherCount: 2,
      independentSourceCount: 2,
      clusterHasUsableUrl: true,
    },
  });

  // Even if the raw score path would allow auto, coverage forces review.
  const final = decideFinal(
    {
      ...scored,
      tier: 'auto-eligible',
      autoPublishEligible: true,
    },
    coverage,
  );
  assert.equal(final.decision, 'review');
  assert.notEqual(final.decision, 'auto-eligible');
  assert.match(final.decisionReasons.join(' '), /follow-up/i);
});

test('stale Ghana/World Cup fixture is not a top review candidate against real posts', async () => {
  const { decideFinal, compareCandidatesForReview } = await import('../../scripts/news-pilot/run.mjs');

  const postsPath = path.join(ROOT, 'data', 'posts.json');
  const posts = extractPostIndex(JSON.parse(fs.readFileSync(postsPath, 'utf8')));
  // Pilot "now": ~4 weeks after the approximate July 10 preview; tournament already over.
  const nowMs = Date.parse('2026-08-08T18:00:00.000Z');

  const staleFixture = cand({
    id: 'ghana-stale',
    sourceId: 'serper-q-liberty-village',
    sourceTier: 'lead',
    title:
      'Ghana vs. Panama tonight brings road closures to Liberty Village, Fort York and Exhibition Place',
    url: 'https://nowtoronto.com/news/toronto-road-closures-ghana-panama-world-cup/',
    snippet:
      'Road closures hit Liberty Village, Fort York and Exhibition Place tonight for Ghana vs Panama.',
    publishedAt: '2026-07-10T00:00:00.000Z',
    dateConfidence: 'approximate',
  });

  const freshPolice = cand({
    id: 'police-fresh',
    sourceId: 'cbc-toronto-rss',
    sourceTier: 'reputable',
    title:
      'Toronto police officers likely stole $5,000 from a Liberty Village apartment, judge finds',
    url: 'https://www.cbc.ca/news/canada/toronto/lv-police-theft-2026',
    snippet:
      'A judge found officers likely stole $5,000 during a search of a Liberty Village apartment.',
    publishedAt: '2026-08-06T12:00:00.000Z',
    dateConfidence: 'exact',
  });

  const coverage = matchExistingPost(staleFixture, posts, { nowMs });
  // Relative novelty must not invent a follow-up from stale "tonight"/matchup alone.
  assert.notEqual(
    coverage.coverageRelation,
    'follow-up',
    `stale fixture must not be novelty follow-up: ${coverage.reason}`,
  );

  const concluded = detectConcludedTimeBoundEvent(staleFixture, nowMs);
  assert.equal(concluded.concluded, true, 'past fixture preview must detect as concluded');

  const staleScore = scoreCandidate(staleFixture, {
    nowMs,
    clusterInfo: { independentPublisherCount: 1, clusterHasUsableUrl: true },
  });
  assert.equal(staleScore.tier, 'reject');
  assert.equal(staleScore.autoPublishEligible, false);
  assert.equal(staleScore.concludedEvent, true);

  const freshScore = scoreCandidate(freshPolice, {
    nowMs,
    clusterInfo: { independentPublisherCount: 2, clusterHasUsableUrl: true },
  });
  // Crime forces review, but it must remain surfaceable and outrank the stale fixture.
  assert.equal(freshScore.tier, 'review');
  assert.ok(freshScore.breakdown.freshness > staleScore.breakdown.freshness);

  const staleFinal = decideFinal(staleScore, coverage);
  assert.equal(staleFinal.decision, 'reject');

  const freshCoverage = matchExistingPost(freshPolice, posts, { nowMs });
  const freshFinal = decideFinal(freshScore, freshCoverage);

  const ranked = [
    {
      title: staleFixture.title,
      decision: staleFinal.decision,
      score: staleScore,
    },
    {
      title: freshPolice.title,
      decision: freshFinal.decision,
      score: freshScore,
    },
  ].sort(compareCandidatesForReview);

  assert.equal(ranked[0].title, freshPolice.title, 'fresh story must rank above stale fixture');
  assert.notEqual(ranked[0].title, staleFixture.title);
  assert.ok(reviewRankMetric(freshScore) > reviewRankMetric(staleScore));
});

test('fresh exact-dated tonight story still counts as new development', () => {
  const nowMs = Date.parse('2026-08-08T18:00:00.000Z');
  const postsPath = path.join(ROOT, 'data', 'posts.json');
  const posts = extractPostIndex(JSON.parse(fs.readFileSync(postsPath, 'utf8')));

  const freshTonight = cand({
    id: 'ol-tonight',
    sourceId: 'cbc-toronto-rss',
    sourceTier: 'reputable',
    title: 'TTC overnight closure starts tonight near Liberty Village Ontario Line works',
    url: 'https://www.cbc.ca/news/canada/toronto/lv-ttc-closure-tonight',
    snippet:
      'An overnight streetcar closure starts tonight on King Street West beside Liberty Village after a new phase of Ontario Line construction.',
    publishedAt: '2026-08-08T14:00:00.000Z',
    dateConfidence: 'exact',
  });

  assert.equal(
    isTrustedRecentDate(
      { dateConfidence: 'exact', publishedAt: freshTonight.publishedAt },
      nowMs,
    ),
    true,
  );

  const signals = extractNewDevelopmentSignals(
    `${freshTonight.title} ${freshTonight.snippet}`,
    'Ontario Line Construction in Liberty Village: 2026 Update tunnel boring haul routes',
    {
      dateConfidence: 'exact',
      publishedAt: freshTonight.publishedAt,
      nowMs,
    },
  );
  assert.ok(
    signals.includes('temporal-imminent'),
    `expected temporal-imminent in ${signals.join(',')}`,
  );

  const hit = matchExistingPost(freshTonight, posts, { nowMs });
  assert.equal(hit.coverageRelation, 'follow-up', `got ${hit.coverageRelation}: ${hit.reason}`);
  assert.equal(hit.alreadyCovered, false);

  const scored = scoreCandidate(freshTonight, {
    nowMs,
    clusterInfo: { independentPublisherCount: 1, clusterHasUsableUrl: true },
  });
  assert.equal(scored.concludedEvent, false);
  assert.notEqual(scored.tier, 'reject');
});

test('stale story does not outrank a fresh comparable story on review metric', () => {
  const nowMs = Date.parse('2026-08-08T18:00:00.000Z');

  const stale = scoreCandidate(
    cand({
      id: 'stale-traffic',
      sourceTier: 'lead',
      title: 'Liberty Village traffic plan and road closures advance near Exhibition Place',
      snippet: 'City advances Liberty Village traffic infrastructure and lane closures.',
      publishedAt: '2026-07-10T00:00:00.000Z',
      dateConfidence: 'approximate',
    }),
    { nowMs, clusterInfo: { independentPublisherCount: 1, clusterHasUsableUrl: true } },
  );

  const fresh = scoreCandidate(
    cand({
      id: 'fresh-traffic',
      sourceTier: 'lead',
      title: 'Liberty Village traffic plan and road closures advance near Exhibition Place',
      snippet: 'City advances Liberty Village traffic infrastructure and lane closures.',
      publishedAt: '2026-08-06T12:00:00.000Z',
      dateConfidence: 'exact',
    }),
    { nowMs, clusterInfo: { independentPublisherCount: 1, clusterHasUsableUrl: true } },
  );

  assert.ok(fresh.breakdown.freshness > stale.breakdown.freshness);
  assert.ok(
    reviewRankMetric(fresh) > reviewRankMetric(stale),
    `fresh rank ${reviewRankMetric(fresh)} should beat stale ${reviewRankMetric(stale)} (totals fresh=${fresh.total} stale=${stale.total})`,
  );
  // Comparable notability/local — freshness must decide ordering.
  assert.ok(Math.abs(fresh.breakdown.notability - stale.breakdown.notability) < 0.05);
});

test('relative novelty signals require exact recent dates', () => {
  const nowMs = Date.parse('2026-08-08T18:00:00.000Z');
  const text =
    'Ghana vs. Panama tonight brings road closures to Liberty Village and Exhibition Place';
  const post = 'Toronto Road Closures for FIFA World Cup 2026: Resident Guide';

  const staleApprox = extractNewDevelopmentSignals(text, post, {
    dateConfidence: 'approximate',
    publishedAt: '2026-07-10T00:00:00.000Z',
    nowMs,
  });
  assert.ok(!staleApprox.includes('temporal-imminent'));
  assert.ok(!staleApprox.includes('matchup'));

  const freshExact = extractNewDevelopmentSignals(text, post, {
    dateConfidence: 'exact',
    publishedAt: '2026-08-08T12:00:00.000Z',
    nowMs,
  });
  assert.ok(freshExact.includes('temporal-imminent'));
  assert.ok(freshExact.includes('matchup'));

  // Absolute signals still count without an exact recent date.
  const absolute = extractNewDevelopmentSignals(
    'Metrolinx approves phase 2 station design near Liberty Village on 2026-08-01',
    'Ontario Line Construction in Liberty Village: 2026 Update',
    {
      dateConfidence: 'approximate',
      publishedAt: '2026-07-01T00:00:00.000Z',
      nowMs,
    },
  );
  assert.ok(absolute.includes('decision'), `got ${absolute.join(',')}`);
  assert.ok(absolute.includes('phase-number') || absolute.includes('iso-date'));
});

test('incidental 34 Hanna body mention does not suppress park project (real posts.json)', () => {
  const postsPath = path.join(ROOT, 'data', 'posts.json');
  const postsJson = JSON.parse(fs.readFileSync(postsPath, 'utf8'));
  const posts = extractPostIndex(postsJson);

  // World Cup survival guide (and others) name-drop "34 Hanna" in body only.
  const survival = posts.find((p) => p.slug === 'fifa-world-cup-2026-liberty-village-survival-guide');
  assert.ok(survival, 'expected real World Cup survival guide post');
  assert.ok(/\b34 hanna\b/i.test(survival.body || ''), 'survival guide body must mention 34 Hanna');
  assert.ok(
    !/\b34 hanna\b/i.test(`${survival.title} ${survival.slug.replace(/-/g, ' ')}`),
    'survival guide title/slug must not be about 34 Hanna',
  );
  assert.ok(
    !/park competition|design team/i.test(survival.body || ''),
    'survival guide must not cover park competition / design teams',
  );

  const facility = cand({
    id: 'hanna-body-only',
    sourceId: 'city-toronto-rss',
    sourceTier: 'official',
    title: 'New Park at 34 Hanna Avenue',
    url: 'https://www.toronto.ca/city-government/planning-development/construction-new-facilities/park-facility-projects/new-park-at-34-hanna-avenue/',
    snippet:
      'City of Toronto park facility project page for the planned park at 34 Hanna Avenue in Liberty Village.',
    publishedAt: '2026-06-01T12:00:00.000Z',
  });

  const hit = matchExistingPost(facility, posts);
  assert.equal(
    hit.coverageRelation,
    'new',
    `incidental body address must not suppress park project: ${hit.coverageRelation} via ${hit.matchSource} → ${hit.matchingSlug}: ${hit.reason}`,
  );
  assert.equal(hit.alreadyCovered, false);
  assert.notEqual(hit.matchSource, 'body');
  assert.equal(hit.matchingSlug, null);
});

test('park competition stories survive incidental 34 Hanna body mentions', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'posts.json'), 'utf8'));
  const records = Array.isArray(raw) ? raw : raw.posts;
  // This regression isolates incidental address mentions. Once an actual Hanna
  // park article exists (including the autonomous PR under test), duplicate is
  // the correct product result and must not invalidate this unrelated scenario.
  const withoutDedicatedHannaPark = records.filter(
    (post) => !/\b(?:hanna.*park|park.*hanna)\b/i.test(`${post.slug || ''} ${post.title || ''}`),
  );
  const posts = extractPostIndex(withoutDedicatedHannaPark);
  const nowMs = Date.parse('2026-08-08T18:00:00.000Z');

  const shortlist = cand({
    id: 'hanna-park-competition',
    sourceId: 'serper-q-lv-development',
    sourceTier: 'lead',
    title: 'Five Design Teams Shortlisted for Park Competition in Liberty Village',
    url: 'https://urbantoronto.ca/news/2026/03/five-design-teams-shortlisted-park-competition-liberty-village.58012',
    snippet:
      'Five design teams have been shortlisted for the international park competition at 34 Hanna Avenue in Liberty Village.',
    publishedAt: '2026-03-18T12:00:00.000Z',
    dateConfidence: 'exact',
  });
  const ar = cand({
    id: 'hanna-ar-competition',
    sourceId: 'serper-q-lv-development',
    sourceTier: 'lead',
    title: 'Competition: Liberty Village park, Toronto',
    url: 'https://www.architectural-review.com/competitions/competition-liberty-village-park-toronto',
    snippet:
      'Architectural Review covers the international design competition for a new Liberty Village park.',
    publishedAt: '2026-03-20T12:00:00.000Z',
    dateConfidence: 'exact',
  });

  for (const story of [shortlist, ar]) {
    const hit = matchExistingPost(story, posts, { nowMs });
    assert.equal(
      hit.coverageRelation,
      'new',
      `${story.title} must survive to review path, not coverage-reject: ${hit.coverageRelation} ${hit.reason}`,
    );
    assert.equal(hit.alreadyCovered, false);
    assert.notEqual(hit.matchSource, 'body');
  }
});

test('title/slug topic match still suppresses a true same-angle rehash', () => {
  // Synthetic post that is genuinely ABOUT the park (title carries the topic).
  // Body-only matching is gone; title/slug/tag remains the reliable coverage path.
  const posts = [
    {
      slug: 'new-park-34-hanna-avenue-liberty-village',
      title: 'New Park at 34 Hanna Avenue in Liberty Village',
      tags: ['parks', 'liberty-village', 'public-realm'],
      publishedAt: '2026-01-15T12:00:00.000Z',
      description: 'Guide to the planned park at 34 Hanna Avenue.',
      body: 'The new park at 34 Hanna Avenue will add green space for Liberty Village residents. Design and construction details follow the public realm strategy.',
    },
  ];

  const rehash = cand({
    id: 'hanna-rehash',
    sourceId: 'serper-q-lv-development',
    sourceTier: 'lead',
    title: 'New Park at 34 Hanna Avenue',
    url: 'https://www.toronto.ca/city-government/planning-development/construction-new-facilities/park-facility-projects/new-park-at-34-hanna-avenue/',
    snippet:
      'City of Toronto park facility project page for the planned park at 34 Hanna Avenue in Liberty Village.',
    publishedAt: '2026-06-01T12:00:00.000Z',
  });

  const hit = matchExistingPost(rehash, posts);
  assert.equal(hit.coverageRelation, 'duplicate', `got ${hit.coverageRelation}: ${hit.reason}`);
  assert.equal(hit.alreadyCovered, true);
  assert.equal(hit.matchingSlug, 'new-park-34-hanna-avenue-liberty-village');
  assert.ok(
    hit.matchSource === 'title' || hit.matchSource === 'title-slug',
    `expected title/slug match, got ${hit.matchSource}`,
  );
});

test('new development on a previously unpublished park topic is not body-suppressed', () => {
  const postsPath = path.join(ROOT, 'data', 'posts.json');
  const posts = extractPostIndex(JSON.parse(fs.readFileSync(postsPath, 'utf8')));
  const nowMs = Date.parse('2026-08-08T18:00:00.000Z');

  // Genuinely new construction start; evergreen bodies only mention 34 Hanna in passing.
  const fresh = cand({
    id: 'hanna-new-dev',
    sourceId: 'cbc-toronto-rss',
    sourceTier: 'reputable',
    title: 'Construction starts Monday on new park at 34 Hanna Avenue in Liberty Village',
    url: 'https://www.cbc.ca/news/canada/toronto/34-hanna-park-construction-starts',
    snippet:
      'City crews begin phase 1 construction Monday at 34 Hanna Avenue after council approved the final park design. Overnight lane closures start on Hanna Ave.',
    publishedAt: '2026-08-07T14:00:00.000Z',
    dateConfidence: 'exact',
  });

  const hit = matchExistingPost(fresh, posts, { nowMs });
  assert.equal(
    hit.coverageRelation,
    'new',
    `passing body address must not create coverage edge: ${hit.coverageRelation} ${hit.reason}`,
  );
  assert.equal(hit.alreadyCovered, false);
  assert.notEqual(hit.matchSource, 'body');
});

test('broad landmark body mentions do not suppress unrelated Exhibition Place items', () => {
  const postsPath = path.join(ROOT, 'data', 'posts.json');
  const posts = extractPostIndex(JSON.parse(fs.readFileSync(postsPath, 'utf8')));

  // World Cup / LV guides mention Exhibition Place in passing — that must not
  // hard-duplicate every Exhibition Place press item.
  const pledge = cand({
    id: 'ex-pledge',
    sourceId: 'exhibition-place-rss',
    sourceTier: 'official',
    title: 'Exhibition Place Signs the Sustainable Tourism 2030 Pledge',
    url: 'https://www.explace.on.ca/news/sustainable-tourism-2030',
    snippet: 'Exhibition Place commits to the Sustainable Tourism 2030 Pledge.',
    publishedAt: '2026-05-01T12:00:00.000Z',
  });

  const hit = matchExistingPost(pledge, posts);
  assert.notEqual(
    hit.matchSource,
    'body',
    `broad body landmark must not cover this: ${hit.reason}`,
  );
  assert.notEqual(
    hit.coverageRelation,
    'duplicate',
    `exhibition place pledge must not be body-duplicate of a guide: ${hit.reason}`,
  );
});

test('strong landmark + built-form merges Hullmark pair across days with publishers=2', () => {
  // Real corpus pair: Toronto Life (exact 2026-07-16) + TorontoToday (approx 2026-07-12).
  // Same Hullmark / Carpet Factory / 37-storey+hotel proposal; must be one cluster.
  const torontoLife = cand({
    id: 'hullmark-tl',
    sourceId: 'serper-q-lv-development',
    sourceTier: 'lead',
    title: "Liberty Village's famous Carpet Factory may soon have a tower soaring above it",
    url: 'https://torontolife.com/real-estate/liberty-village-carpet-factory-hullmark-rentals-hotels',
    publisherDomain: 'torontolife.com',
    publishedAt: '2026-07-16T07:00:00.000Z',
    dateConfidence: 'exact',
    snippet:
      'Developer Hullmark has rental units and hotel suites in its sights. A 37-storey mixed-use tower has been proposed for the Toronto Carpet Factory campus in Liberty Village.',
  });
  const torontoToday = cand({
    id: 'hullmark-tt',
    sourceId: 'serpapi-q-lv-development',
    sourceTier: 'lead',
    title: '37-storey residential building and hotel proposed in Liberty Village',
    url: 'https://www.torontotoday.ca/local/real-estate-housing/37-storey-residential-building-hotel-proposed-liberty-village-12541882',
    publisherDomain: 'torontotoday.ca',
    publishedAt: '2026-07-12T00:00:00.000Z',
    dateConfidence: 'approximate',
    snippet:
      "The developer says building within the Toronto Carpet Factory campus will help to reduce pressure. A 37-storey residential building and hotel is proposed in Liberty Village.",
  });

  const match = sameStory(torontoLife, torontoToday);
  assert.equal(match.match, true, `expected strong-anchor merge: ${match.reason}`);
  assert.match(match.reason, /strong_anchor_window/);

  const clusters = clusterCandidates([torontoLife, torontoToday]);
  assert.equal(clusters.length, 1, `expected 1 Hullmark cluster, got ${clusters.length}`);
  assert.equal(clusters[0].members.length, 2);
  assert.equal(
    clusters[0].independentPublisherCount,
    2,
    'corroboration must count both independent publishers',
  );
  assert.equal(clusters[0].independentSourceCount, 2);
});

test('generic development anchors do not merge different proposals across days', () => {
  // Proves FIX 1 did not over-merge: shared "liberty village" + "tower"/development
  // without a distinctive landmark + shared built-form specific stays split.
  const a = cand({
    id: 'dev-a',
    sourceId: 'serper-q-lv-development',
    title: '40-storey condo tower proposed near King West in Liberty Village',
    url: 'https://example.com/dev-a-40-storey-king',
    publisherDomain: 'example.com',
    publishedAt: '2026-07-16T12:00:00.000Z',
    dateConfidence: 'exact',
    snippet:
      'A developer filed plans for a 40-storey condo tower near King Street West in Liberty Village.',
  });
  const b = cand({
    id: 'dev-b',
    sourceId: 'serpapi-q-lv-development',
    title: '25-storey residential tower proposed on Atlantic Avenue in Liberty Village',
    url: 'https://othernews.example.com/dev-b-25-storey-atlantic',
    publisherDomain: 'othernews.example.com',
    publishedAt: '2026-07-12T12:00:00.000Z',
    dateConfidence: 'exact',
    snippet:
      'Plans for a 25-storey residential tower on Atlantic Avenue would add housing stock in Liberty Village.',
  });

  assert.equal(sameStory(a, b).match, false, `must not merge: ${sameStory(a, b).reason}`);
  const clusters = clusterCandidates([a, b]);
  assert.equal(clusters.length, 2, `expected 2 distinct development clusters, got ${clusters.length}`);
});

test('civic residents vs developer is not a sporting matchup or concluded fixture', () => {
  const nowMs = Date.parse('2026-08-08T18:00:00.000Z');
  const civicText =
    'Liberty Village residents vs developer clash over 40-storey tower proposal near Atlantic Avenue';

  assert.equal(hasSportingMatchup(civicText), false);
  assert.equal(hasSportingMatchup('Ghana vs. Panama tonight at BMO Field'), true);

  const civic = cand({
    id: 'civic-vs',
    sourceId: 'star-lv-search-rss',
    sourceTier: 'reputable',
    title: 'Liberty Village residents vs developer face off over waterfront tower height',
    url: 'https://www.thestar.com/news/gta/lv-residents-vs-developer-tower',
    snippet:
      'Community members say the developer ignored consultation feedback on the Liberty Village proposal.',
    publishedAt: '2026-07-01T12:00:00.000Z',
    dateConfidence: 'exact',
  });

  const concluded = detectConcludedTimeBoundEvent(civic, nowMs);
  assert.equal(
    concluded.concluded,
    false,
    `civic adversarial phrasing must not count as concluded fixture: ${concluded.reason}`,
  );

  // Aged sporting fixture still concludes.
  const sport = detectConcludedTimeBoundEvent(
    cand({
      id: 'sport-vs',
      title: 'Ghana vs. Panama brings road closures to Liberty Village',
      snippet: 'Match night traffic around BMO Field.',
      publishedAt: '2026-07-01T12:00:00.000Z',
    }),
    nowMs,
  );
  assert.equal(sport.concluded, true);

  // Novelty matchup signal must also ignore civic vs phrasing.
  const signals = extractNewDevelopmentSignals(
    civicText,
    'Liberty Village development guide',
    {
      dateConfidence: 'exact',
      publishedAt: '2026-08-08T12:00:00.000Z',
      nowMs,
    },
  );
  assert.ok(!signals.includes('matchup'), `signals=${signals.join(',')}`);
});


test('broad topic anchors do not merge different proposals across days', () => {
  // Two genuinely different hotel proposals that only share the broad topic
  // "ontario line" (+ loose hotel) within a week must NOT strong-anchor-merge.
  const a = cand({
    id: 'ol-hotel-a',
    sourceId: 'serper-q-lv-development',
    title: 'Boutique hotel proposed beside Ontario Line portal near Exhibition',
    url: 'https://example.com/ontario-line-hotel-exhibition',
    publisherDomain: 'example.com',
    publishedAt: '2026-07-16T12:00:00.000Z',
    dateConfidence: 'exact',
    snippet:
      'A boutique hotel and mixed-use podium is proposed beside the Ontario Line portal near Exhibition Place.',
  });
  const b = cand({
    id: 'ol-hotel-b',
    sourceId: 'serpapi-q-lv-development',
    title: 'Mixed-use hotel tower filed near Ontario Line station at King West',
    url: 'https://othernews.example.com/ontario-line-hotel-king',
    publisherDomain: 'othernews.example.com',
    publishedAt: '2026-07-12T12:00:00.000Z',
    dateConfidence: 'exact',
    snippet:
      'Plans for a mixed-use hotel tower next to an Ontario Line station would reshape King Street West blocks outside Liberty Village core.',
  });

  const match = sameStory(a, b);
  assert.equal(match.match, false, `broad topic must not cross-day merge: ${match.reason}`);
  const clusters = clusterCandidates([a, b]);
  assert.equal(clusters.length, 2, `expected 2 clusters, got ${clusters.length}`);
});

test('park design competition cluster merges across months with civic anchor', () => {
  const urbanToronto = cand({
    id: 'park-ut',
    sourceId: 'serper-q-lv-park',
    sourceTier: 'lead',
    title: 'Five Design Teams Shortlisted for Park Competition in Liberty Village',
    url: 'https://urbantoronto.ca/news/2026/03/five-design-teams-shortlisted-park-competition-liberty-village.58012',
    publisherDomain: 'urbantoronto.ca',
    publishedAt: '2026-03-18T12:00:00.000Z',
    dateConfidence: 'exact',
    snippet:
      'Five design teams have been shortlisted for the international park competition at 34 Hanna Avenue in Liberty Village.',
  });
  const architecturalReview = cand({
    id: 'park-ar',
    sourceId: 'serpapi-q-lv-park',
    sourceTier: 'lead',
    title: 'Competition: Liberty Village park, Toronto',
    url: 'https://www.architectural-review.com/competitions/competition-liberty-village-park-toronto',
    publisherDomain: 'architectural-review.com',
    publishedAt: '2025-11-03T12:00:00.000Z',
    dateConfidence: 'exact',
    snippet:
      'Architectural Review covers the international design competition for a new Liberty Village park.',
  });
  const city = cand({
    id: 'park-city',
    sourceId: 'toronto-newsroom',
    sourceTier: 'official',
    title: 'City of Toronto launches international design competition for new park in Liberty Village',
    url: 'https://www.toronto.ca/news/liberty-village-park-design-competition',
    publisherDomain: 'toronto.ca',
    publishedAt: '2025-11-11T12:00:00.000Z',
    dateConfidence: 'exact',
    snippet:
      'The City launched an international design competition for a new public park in Liberty Village at 34 Hanna Avenue.',
  });
  const blogto = cand({
    id: 'park-blogto',
    sourceId: 'serper-q-lv-news',
    sourceTier: 'lead',
    title: 'International design competition launched for new Liberty Village park',
    url: 'https://www.blogto.com/city/2025/11/liberty-village-park-design-competition/',
    publisherDomain: 'blogto.com',
    publishedAt: '2025-11-12T12:00:00.000Z',
    dateConfidence: 'exact',
    snippet:
      'blogTO reports an international design competition for a new park in Liberty Village.',
  });

  // Municipal facility page must NOT join the competition cluster.
  const muni = cand({
    id: 'park-muni',
    sourceId: 'toronto-ca-park',
    sourceTier: 'official',
    title: 'New Park at 34 Hanna Avenue',
    url: 'https://www.toronto.ca/city-government/planning-development/construction-new-facilities/park-facility-projects/new-park-at-34-hanna-avenue/',
    publisherDomain: 'toronto.ca',
    publishedAt: '2026-07-10T00:00:00.000Z',
    dateConfidence: 'approximate',
    snippet:
      'City of Toronto park facility project for a new park at 34 Hanna Avenue in Liberty Village.',
  });

  assert.equal(extractCivicProjectAnchor(`${urbanToronto.title} ${urbanToronto.snippet}`), 'lv-park-design-competition');
  assert.equal(extractCivicProjectAnchor(`${muni.title} ${muni.snippet}`), null);

  const match = sameStory(urbanToronto, architecturalReview);
  assert.equal(match.match, true, `expected civic anchor merge: ${match.reason}`);
  assert.match(match.reason, /civic_project_anchor_window/);

  const clusters = clusterCandidates([urbanToronto, architecturalReview, city, blogto, muni]);
  const competition = clusters.filter((c) =>
    c.members.some((m) => /competition|shortlisted|design teams/i.test(m.title)),
  );
  assert.equal(competition.length, 1, `expected 1 competition cluster, got ${competition.length}`);
  assert.ok(
    competition[0].members.length >= 4,
    `expected >=4 competition members, got ${competition[0].members.length}`,
  );
  assert.ok(
    competition[0].independentPublisherCount >= 4,
    `expected >=4 publishers, got ${competition[0].independentPublisherCount}`,
  );
  // Municipal page remains its own cluster.
  assert.ok(
    clusters.some((c) => c.members.length === 1 && c.members[0].id === 'park-muni'),
    'municipal facility page must not merge into competition cluster',
  );
});

