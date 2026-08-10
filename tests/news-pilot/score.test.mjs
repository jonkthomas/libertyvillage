import assert from 'node:assert/strict';
import test from 'node:test';

import {
  detectConcludedTimeBoundEvent,
  detectMunicipalProjectLabels,
  detectRiskFlags,
  hasSportingMatchup,
  reviewRankMetric,
  scoreCandidate,
  scoreEvidence,
  scoreFreshness,
  scoreNotability,
  SCORE_CONFIG,
} from '../../scripts/news-pilot/score.mjs';
import { clusterCandidates } from '../../scripts/news-pilot/dedupe.mjs';
import { makeCandidate } from '../../scripts/news-pilot/normalize.mjs';

const NOW = Date.parse('2026-08-07T18:00:00.000Z');

function cand(overrides = {}) {
  return {
    id: 't1',
    sourceId: 'test',
    sourceTier: 'official',
    title: '',
    url: 'https://example.com/a',
    canonicalUrl: 'https://example.com/a',
    publishedAt: '2026-08-06T12:00:00.000Z',
    dateConfidence: 'exact',
    urlUsable: true,
    snippet: '',
    rawTextSample: '',
    ...overrides,
  };
}

test('clearly local high-value item scores auto-eligible', () => {
  const result = scoreCandidate(
    cand({
      title: 'Liberty Village construction closes East Liberty Street this weekend',
      snippet:
        'City of Toronto says a development application related lane closure on East Liberty St will affect TTC streetcar access near Lamport Stadium.',
      sourceTier: 'official',
      publishedAt: '2026-08-07T10:00:00.000Z',
    }),
    { nowMs: NOW, clusterInfo: { independentSourceCount: 2, independentPublisherCount: 2 } },
  );

  assert.equal(result.tier, 'auto-eligible');
  assert.equal(result.autoPublishEligible, true);
  assert.equal(result.riskFlags.length, 0);
  assert.ok(result.total >= SCORE_CONFIG.autoEligibleMin, `total=${result.total}`);
  assert.ok(result.breakdown.localRelevance >= 0.35);
  assert.ok(result.breakdown.notability >= 0.2);
  assert.ok(result.reasons.some((r) => /liberty village/i.test(r)));
});

test('Toronto-wide item without LV signal is rejected', () => {
  const result = scoreCandidate(
    cand({
      title: 'Toronto city council debates downtown budget priorities',
      snippet: 'A city-wide fiscal update covering the GTA has no neighbourhood-specific actions.',
      sourceTier: 'lead',
      publishedAt: '2026-08-05T12:00:00.000Z',
    }),
    { nowMs: NOW, clusterInfo: { independentSourceCount: 1 } },
  );

  assert.equal(result.tier, 'reject');
  assert.equal(result.autoPublishEligible, false);
  assert.ok(result.breakdown.localRelevance < 0.2);
  assert.ok(result.total < SCORE_CONFIG.reviewMin || result.reasons.some((r) => /generic Toronto/i.test(r)));
});

test('crime item is forced to review even with high local score', () => {
  const result = scoreCandidate(
    cand({
      title: 'Shooting investigated near Liberty Village and King Street West',
      snippet:
        'Police say a shooting and assault investigation is underway after a man was arrested near East Liberty Street. Construction nearby is unrelated.',
      sourceTier: 'official',
      publishedAt: '2026-08-07T15:00:00.000Z',
    }),
    { nowMs: NOW, clusterInfo: { independentSourceCount: 3, independentPublisherCount: 3 } },
  );

  assert.ok(result.riskFlags.includes('crime'), `flags=${result.riskFlags.join(',')}`);
  assert.equal(result.autoPublishEligible, false);
  assert.equal(result.tier, 'review');
  assert.ok(result.total >= SCORE_CONFIG.reviewMin);
  assert.ok(result.reasons.some((r) => /risk flags force review/i.test(r)));
});

test('corroboration counts distinct publishers not sourceIds', () => {
  // Same cbc.ca article discovered via three different query/source configs.
  const members = [
    makeCandidate({
      sourceId: 'serper-q-liberty-village',
      sourceTier: 'lead',
      title: 'Liberty Village traffic plan advances',
      url: 'https://www.cbc.ca/news/canada/toronto/lv-traffic-9.1',
      publishedAt: '2026-08-01T12:00:00.000Z',
      snippet: 'City advances Liberty Village traffic infrastructure.',
    }),
    makeCandidate({
      sourceId: 'serper-q-lv-development',
      sourceTier: 'lead',
      title: 'Liberty Village traffic plan advances',
      url: 'https://cbc.ca/news/canada/toronto/lv-traffic-9.1',
      publishedAt: '2026-08-01T12:00:00.000Z',
      snippet: 'City advances Liberty Village traffic infrastructure.',
    }),
    makeCandidate({
      sourceId: 'serpapi-q-liberty-village',
      sourceTier: 'lead',
      title: 'Liberty Village traffic plan advances',
      url: 'https://www.cbc.ca/news/canada/toronto/lv-traffic-9.1?utm_source=serpapi',
      publishedAt: '2026-08-01T12:00:00.000Z',
      snippet: 'City advances Liberty Village traffic infrastructure.',
    }),
  ];

  const clusters = clusterCandidates(members);
  assert.equal(clusters.length, 1);
  // Three sourceIds, ONE publisher (cbc.ca)
  assert.equal(clusters[0].sourceIds.length, 3);
  assert.equal(clusters[0].independentPublisherCount, 1);
  assert.equal(clusters[0].independentSourceCount, 1);

  const evidence = scoreEvidence(members[0], {
    independentSourceCount: clusters[0].independentSourceCount,
    independentPublisherCount: clusters[0].independentPublisherCount,
  });
  // lead base 0.40, no corroboration bonus for a single publisher
  assert.equal(evidence.score, 0.4);
  assert.ok(evidence.reasons.some((r) => /independent_publishers=1/.test(r)));
  assert.ok(!evidence.reasons.some((r) => /corroboration_bonus/.test(r)));
});

test('freshness half-life is multi-day; approximate dates do not decay slower', () => {
  assert.ok(SCORE_CONFIG.freshnessHalfLifeHours >= 168, 'half-life should be ~7-14 days');
  assert.ok(
    SCORE_CONFIG.approximateHalfLifeMultiplier <= 1,
    'approximate dates must not receive slower decay than exact',
  );

  const breweryAgeDays = 17;
  const brewery = cand({
    title: 'Something in the Water brewery closes Liberty Village location',
    snippet: 'The craft brewery has closed its Liberty Village taproom.',
    sourceTier: 'lead',
    publishedAt: new Date(NOW - breweryAgeDays * 86_400_000).toISOString(),
    dateConfidence: 'exact',
  });
  const brewScore = scoreCandidate(brewery, { nowMs: NOW });
  assert.ok(
    brewScore.total >= SCORE_CONFIG.reviewMin,
    `brewery should reach review after freshness retune, got ${brewScore.total}`,
  );
  assert.ok(brewScore.breakdown.notability >= 0.2, 'closes must count as closure notability');
  assert.equal(brewScore.tier, 'review');

  // Same age within one half-life: approximate must not outrank exact on freshness.
  const ageWithinHalfLife = new Date(NOW - 5 * 86_400_000).toISOString();
  const approxYoung = scoreFreshness(
    cand({ publishedAt: ageWithinHalfLife, dateConfidence: 'approximate' }),
    NOW,
  );
  const exactYoung = scoreFreshness(
    cand({ publishedAt: ageWithinHalfLife, dateConfidence: 'exact' }),
    NOW,
  );
  assert.ok(
    approxYoung.score <= exactYoung.score + 1e-9,
    `approx ${approxYoung.score} must not exceed exact ${exactYoung.score}`,
  );

  // Past half-life: approximate is further penalized as untrusted-current.
  const agePastHalfLife = new Date(NOW - 20 * 86_400_000).toISOString();
  const approxOld = scoreFreshness(
    cand({ publishedAt: agePastHalfLife, dateConfidence: 'approximate' }),
    NOW,
  );
  const exactOld = scoreFreshness(
    cand({ publishedAt: agePastHalfLife, dateConfidence: 'exact' }),
    NOW,
  );
  assert.ok(
    approxOld.score < exactOld.score,
    `stale approximate ${approxOld.score} should be below exact ${exactOld.score}`,
  );

  const unknown = scoreFreshness(cand({ publishedAt: null, dateConfidence: 'unknown' }), NOW);
  assert.ok(unknown.score >= 0.4 && unknown.score <= 0.6);
});

test('concluded time-bound fixture is rejected; fresh tonight is not', () => {
  const stale = detectConcludedTimeBoundEvent(
    cand({
      title: 'Ghana vs. Panama tonight brings road closures to Liberty Village',
      snippet: 'Match-night closures around Exhibition Place.',
      publishedAt: '2026-07-10T00:00:00.000Z',
      dateConfidence: 'approximate',
    }),
    NOW,
  );
  assert.equal(stale.concluded, true);

  const live = detectConcludedTimeBoundEvent(
    cand({
      title: 'Lane closures start tonight near Liberty Village and King Street West',
      snippet: 'TTC says overnight work begins tonight beside Lamport Stadium.',
      publishedAt: '2026-08-07T10:00:00.000Z',
      dateConfidence: 'exact',
    }),
    NOW,
  );
  assert.equal(live.concluded, false);

  const staleScore = scoreCandidate(
    cand({
      title: 'Ghana vs. Panama tonight brings road closures to Liberty Village',
      snippet: 'Match-night closures around Exhibition Place and BMO Field.',
      publishedAt: '2026-07-10T00:00:00.000Z',
      dateConfidence: 'approximate',
      sourceTier: 'lead',
    }),
    { nowMs: NOW, clusterInfo: { independentPublisherCount: 1, clusterHasUsableUrl: true } },
  );
  assert.equal(staleScore.tier, 'reject');
  assert.equal(staleScore.concludedEvent, true);
  assert.equal(staleScore.autoPublishEligible, false);
});

test('reviewRankMetric prefers fresher item when totals are comparable', () => {
  const stale = {
    total: 0.55,
    breakdown: { freshness: 0.27 },
  };
  const fresh = {
    total: 0.52,
    breakdown: { freshness: 0.92 },
  };
  assert.ok(
    reviewRankMetric(fresh) > reviewRankMetric(stale),
    `fresh ${reviewRankMetric(fresh)} vs stale ${reviewRankMetric(stale)}`,
  );
});

test('development / closure outranks video segment non-event', () => {
  const development = scoreCandidate(
    cand({
      title: '37-storey residential building and hotel proposed in Liberty Village',
      snippet: 'A 37-storey mixed-use tower and hotel has been proposed in Liberty Village.',
      sourceTier: 'lead',
      publishedAt: '2026-07-17T12:00:00.000Z',
      dateConfidence: 'approximate',
    }),
    { nowMs: NOW, clusterInfo: { independentPublisherCount: 2 } },
  );

  const video = scoreCandidate(
    cand({
      title: 'Around the 6ix - Liberty Village',
      snippet: 'Host visits must-see places in the neighbourhood. Watch the full video segment.',
      url: 'https://www.cp24.com/video/around-the-6ix/2026/08/07/around-the-6ix-liberty-village/',
      canonicalUrl: 'https://cp24.com/video/around-the-6ix/2026/08/07/around-the-6ix-liberty-village/',
      sourceTier: 'lead',
      publishedAt: '2026-08-07T14:00:00.000Z',
      dateConfidence: 'approximate',
    }),
    { nowMs: NOW, clusterInfo: { independentPublisherCount: 1 } },
  );

  assert.ok(
    development.breakdown.notability > video.breakdown.notability,
    `dev notability ${development.breakdown.notability} vs video ${video.breakdown.notability}`,
  );
  assert.ok(
    development.total > video.total,
    `dev total ${development.total} should beat video ${video.total}`,
  );
  assert.ok(video.nonEventLabels?.includes('video-segment'));
  assert.ok(scoreNotability(video).score < 0.1);
});

test('unusable URL cluster cannot be auto-eligible', () => {
  const result = scoreCandidate(
    cand({
      title: 'Liberty Village construction closes East Liberty Street this weekend',
      snippet:
        'City of Toronto says a development application related lane closure on East Liberty St will affect TTC streetcar access near Lamport Stadium.',
      sourceTier: 'official',
      publishedAt: '2026-08-07T10:00:00.000Z',
      urlUsable: false,
      url: 'https://www.google.com/goto?url=CAES',
      canonicalUrl: 'https://google.com/goto?url=CAES',
    }),
    {
      nowMs: NOW,
      clusterInfo: { independentPublisherCount: 2, clusterHasUsableUrl: false },
    },
  );
  assert.equal(result.autoPublishEligible, false);
  assert.notEqual(result.tier, 'auto-eligible');
});

test('Parkdale addresses do not outrank real Liberty Village stories', () => {
  const parkdaleDevApp = scoreCandidate(
    cand({
      title: 'Development application 26 213803 STE 04 SA — 1 CLOSE AVE',
      snippet: 'Toronto development application, M6K.',
      sourceTier: 'official',
      publishedAt: '2026-08-04T00:00:00.000Z',
    }),
    { nowMs: NOW, clusterInfo: { independentPublisherCount: 1 } },
  );
  const libertyVillageStory = scoreCandidate(
    cand({
      title: '37-storey residential building and hotel proposed in Liberty Village',
      snippet: 'A development application proposes a tower on Hanna Avenue in Liberty Village.',
      sourceTier: 'reputable',
      publishedAt: '2026-08-04T00:00:00.000Z',
    }),
    { nowMs: NOW, clusterInfo: { independentPublisherCount: 1 } },
  );

  assert.ok(
    libertyVillageStory.total > parkdaleDevApp.total,
    `LV story ${libertyVillageStory.total} must outrank Parkdale ${parkdaleDevApp.total}`,
  );
  assert.equal(parkdaleDevApp.tier, 'reject');
});

test('King St W addresses west of Dufferin are penalized', () => {
  const westOfDufferin = scoreCandidate(
    cand({
      title: 'Development application 26 183202 STE 10 OZ — 1187 KING ST W',
      sourceTier: 'official',
      publishedAt: '2026-08-04T00:00:00.000Z',
    }),
    { nowMs: NOW, clusterInfo: { independentPublisherCount: 1 } },
  );
  const insideNeighbourhood = scoreCandidate(
    cand({
      title: 'Development application 26 183202 STE 10 OZ — 1090 KING ST W',
      sourceTier: 'official',
      publishedAt: '2026-08-04T00:00:00.000Z',
    }),
    { nowMs: NOW, clusterInfo: { independentPublisherCount: 1 } },
  );

  assert.ok(
    insideNeighbourhood.total > westOfDufferin.total,
    `1090 King ${insideNeighbourhood.total} should beat 1187 King ${westOfDufferin.total}`,
  );
});

test('M6K alone does not establish a Liberty Village signal', () => {
  const postalOnly = scoreCandidate(
    cand({
      title: 'Toronto notice for an address in M6K',
      sourceTier: 'official',
      publishedAt: '2026-08-06T12:00:00.000Z',
    }),
    { nowMs: NOW, clusterInfo: { independentPublisherCount: 1 } },
  );
  assert.ok(
    postalOnly.breakdown.localRelevance < 0.2,
    `M6K-only local score ${postalOnly.breakdown.localRelevance} must stay below the local threshold`,
  );
  assert.equal(postalOnly.tier, 'reject');
});

test('zero local relevance is a hard reject regardless of source authority', () => {
  const officialButNotLocal = scoreCandidate(
    cand({
      title: 'Development application 26 183202 STE 10 OZ — 1187 KING ST W',
      snippet: 'Official City of Toronto development application record.',
      sourceTier: 'official',
      publishedAt: '2026-08-06T12:00:00.000Z',
    }),
    { nowMs: NOW, clusterInfo: { independentPublisherCount: 3 } },
  );

  assert.ok(officialButNotLocal.breakdown.localRelevance < SCORE_CONFIG.minLocalRelevance);
  assert.equal(officialButNotLocal.tier, 'reject');
  assert.equal(officialButNotLocal.autoPublishEligible, false);
});

test('core Liberty Village streets in the site address data are recognized', () => {
  for (const address of ['80 Western Battery Rd', '15 Lynn Williams St', '25 Western Battery Road']) {
    const result = scoreCandidate(
      cand({
        title: `Development application — ${address}`,
        sourceTier: 'official',
        publishedAt: '2026-08-06T12:00:00.000Z',
      }),
      { nowMs: NOW, clusterInfo: { independentPublisherCount: 1 } },
    );
    assert.ok(
      result.breakdown.localRelevance >= SCORE_CONFIG.minLocalRelevance,
      `${address} scored local ${result.breakdown.localRelevance}, below the hard gate`,
    );
  }
});

test('withinSince gives approximate dates a finite window and keeps unknown dates', async () => {
  const { withinSince, RUN_CONFIG } = await import('../../scripts/news-pilot/run.mjs');
  const sinceHours = 168; // 7 days
  const nowMs = NOW;

  assert.equal(
    withinSince(
      cand({
        publishedAt: new Date(NOW - 3 * 86_400_000).toISOString(),
        dateConfidence: 'exact',
      }),
      sinceHours,
      nowMs,
    ),
    true,
  );
  assert.equal(
    withinSince(
      cand({
        publishedAt: new Date(NOW - 20 * 86_400_000).toISOString(),
        dateConfidence: 'exact',
      }),
      sinceHours,
      nowMs,
    ),
    false,
  );

  // Approximate: allowed up to multiplier × sinceHours, not unlimited.
  const approxInside = withinSince(
    cand({
      publishedAt: new Date(NOW - 10 * 86_400_000).toISOString(),
      dateConfidence: 'approximate',
    }),
    sinceHours,
    nowMs,
  );
  assert.equal(approxInside, true);

  const approxOutside = withinSince(
    cand({
      publishedAt: new Date(NOW - 40 * 86_400_000).toISOString(),
      dateConfidence: 'approximate',
    }),
    sinceHours,
    nowMs,
  );
  assert.equal(approxOutside, false);
  assert.ok(RUN_CONFIG.approximateSinceHoursMultiplier >= 1);

  // Unknown dates deliberately kept.
  assert.equal(
    withinSince(cand({ publishedAt: null, dateConfidence: 'unknown' }), sinceHours, nowMs),
    true,
  );
  assert.equal(RUN_CONFIG.keepUnknownDates, true);
});

test('coyote culling story carries civic-controversy and cannot be auto-eligible', () => {
  const coyote = cand({
    title:
      "'Unnecessary suffering': The city's delay in killing the Liberty Village coyote added to its misery — and could lead to more attacks, says a new review",
    snippet:
      "A new review says the city's delay in killing the Liberty Village coyote caused unnecessary suffering and may lead to more attacks.",
    sourceTier: 'reputable',
    url: 'https://www.thestar.com/news/gta/unnecessary-suffering-the-citys-delay-in-killing-the-liberty-village-coyote/article_example.html',
    publishedAt: '2026-08-05T12:00:00.000Z',
  });

  const flags = detectRiskFlags(coyote);
  assert.ok(
    flags.includes('civic-controversy'),
    `expected civic-controversy in ${flags.join(',') || '(none)'}`,
  );

  const result = scoreCandidate(coyote, {
    nowMs: NOW,
    clusterInfo: { independentPublisherCount: 2, clusterHasUsableUrl: true },
  });
  assert.ok(result.riskFlags.includes('civic-controversy'));
  assert.equal(result.autoPublishEligible, false);
  assert.notEqual(result.tier, 'auto-eligible');
  assert.equal(result.tier, 'review');
  assert.ok(result.reasons.some((r) => /civic-controversy|risk flags force review/i.test(r)));
});

test('municipal facility project page ranks below comparable dated news', async () => {
  const { compareCandidatesForReview } = await import('../../scripts/news-pilot/run.mjs');

  const facility = cand({
    title: 'New Park at 34 Hanna Avenue',
    snippet:
      'City of Toronto park facility project for a new park at 34 Hanna Avenue in Liberty Village.',
    url: 'https://www.toronto.ca/city-government/planning-development/construction-new-facilities/park-facility-projects/new-park-at-34-hanna-avenue/',
    canonicalUrl:
      'https://www.toronto.ca/city-government/planning-development/construction-new-facilities/park-facility-projects/new-park-at-34-hanna-avenue/',
    sourceTier: 'official',
    // Approximate + older — the live corpus demotion previously hard-rejected this.
    publishedAt: '2026-07-10T00:00:00.000Z',
    dateConfidence: 'approximate',
  });

  const datedNews = cand({
    title: 'Toronto step closer to much needed Liberty Village traffic and community additions',
    snippet:
      'City advances Liberty Village traffic infrastructure plan and community additions after consultation.',
    url: 'https://www.cbc.ca/news/canada/toronto/liberty-village-traffic-2026',
    canonicalUrl: 'https://www.cbc.ca/news/canada/toronto/liberty-village-traffic-2026',
    sourceTier: 'reputable',
    publishedAt: '2026-08-04T12:00:00.000Z',
    dateConfidence: 'exact',
  });

  const olderDatedNews = cand({
    title: '37-storey residential building and hotel proposed in Liberty Village',
    snippet:
      'A 37-storey mixed-use tower and hotel has been proposed at the Carpet Factory in Liberty Village.',
    url: 'https://www.torontotoday.ca/local/real-estate-housing/37-storey-example',
    sourceTier: 'lead',
    publishedAt: '2026-07-12T00:00:00.000Z',
    dateConfidence: 'approximate',
  });

  assert.ok(detectMunicipalProjectLabels(facility).length > 0);
  assert.equal(detectMunicipalProjectLabels(datedNews).length, 0);

  const facilityScore = scoreCandidate(facility, {
    nowMs: NOW,
    clusterInfo: { independentPublisherCount: 1, clusterHasUsableUrl: true },
  });
  const newsScore = scoreCandidate(datedNews, {
    nowMs: NOW,
    clusterInfo: { independentPublisherCount: 1, clusterHasUsableUrl: true },
  });
  const olderNewsScore = scoreCandidate(olderDatedNews, {
    nowMs: NOW,
    clusterInfo: { independentPublisherCount: 1, clusterHasUsableUrl: true },
  });

  // Held for review via rank-last policy — no score haircuts required.
  assert.equal(facilityScore.tier, 'review');
  assert.equal(facilityScore.autoPublishEligible, false);
  assert.ok(facilityScore.municipalProjectLabels?.length > 0);
  assert.ok(
    facilityScore.reasons.some((r) => /municipal project/i.test(r)),
    `expected municipal rank-last reason, got ${facilityScore.reasons.join('; ')}`,
  );

  assert.notEqual(newsScore.tier, 'reject');
  assert.notEqual(olderNewsScore.tier, 'reject');

  const ranked = [
    { title: facility.title, decision: facilityScore.tier, score: facilityScore },
    { title: datedNews.title, decision: newsScore.tier, score: newsScore },
    { title: olderDatedNews.title, decision: olderNewsScore.tier, score: olderNewsScore },
  ].sort(compareCandidatesForReview);

  const muniIdx = ranked.findIndex((r) => r.title === facility.title);
  assert.equal(muniIdx, ranked.length - 1, 'municipal page must sort last among review items');
  for (let i = 0; i < muniIdx; i++) {
    assert.notEqual(ranked[i].title, facility.title);
    assert.equal(ranked[i].decision, 'review');
  }
});

test('production default horizon keeps concluded stale fixture rejected', async () => {
  const { RUN_CONFIG, withinSince } = await import('../../scripts/news-pilot/run.mjs');

  assert.ok(
    RUN_CONFIG.defaultSinceHours >= 4320,
    `default horizon should cover multi-month civic stories, got ${RUN_CONFIG.defaultSinceHours}`,
  );
  assert.ok(
    RUN_CONFIG.defaultSinceHours >= SCORE_CONFIG.freshnessMaxAgeHours,
    'run horizon should not be tighter than freshness max-age by default',
  );

  const nowMs = Date.parse('2026-08-08T18:00:00.000Z');
  const staleFixture = cand({
    title:
      'Ghana vs. Panama tonight brings road closures to Liberty Village, Fort York and Exhibition Place',
    snippet:
      'Road closures hit Liberty Village, Fort York and Exhibition Place tonight for Ghana vs Panama.',
    publishedAt: '2026-07-10T00:00:00.000Z',
    dateConfidence: 'approximate',
    sourceTier: 'lead',
  });

  // Inside the longer production window (not structurally dropped)...
  assert.equal(
    withinSince(staleFixture, RUN_CONFIG.defaultSinceHours, nowMs),
    true,
    'stale fixture is inside the long horizon window',
  );

  // ...but concluded-event protection still hard-rejects.
  const concluded = detectConcludedTimeBoundEvent(staleFixture, nowMs);
  assert.equal(concluded.concluded, true);
  const scored = scoreCandidate(staleFixture, {
    nowMs,
    clusterInfo: { independentPublisherCount: 1, clusterHasUsableUrl: true },
  });
  assert.equal(scored.tier, 'reject');
  assert.equal(scored.concludedEvent, true);
  assert.equal(scored.autoPublishEligible, false);

  // Slow civic park competition is NOT concluded and is inside the default window.
  const parkCompetition = cand({
    title: 'Five Design Teams Shortlisted for Park Competition in Liberty Village',
    snippet:
      'Five design teams shortlisted for the international park competition at 34 Hanna Avenue in Liberty Village.',
    publishedAt: '2026-03-18T12:00:00.000Z',
    dateConfidence: 'exact',
  });
  assert.equal(withinSince(parkCompetition, RUN_CONFIG.defaultSinceHours, nowMs), true);
  assert.equal(detectConcludedTimeBoundEvent(parkCompetition, nowMs).concluded, false);
});



test('concluded dated construction window is rejected; current roadwork is not', () => {
  const nowMs = Date.parse('2026-08-08T18:00:00.000Z');

  const staleClosure = cand({
    title:
      "'Please be quick,' Toronto residents react to King & Dufferin closure for TTC track work; construction to last until November",
    snippet:
      "Residents in Toronto's Liberty Village neighbourhood are reacting to a nearly two-month closure of the busy King Street West and Dufferin intersection. Construction is expected to last until November.",
    publishedAt: '2025-09-29T12:00:00.000Z',
    dateConfidence: 'exact',
    sourceTier: 'reputable',
    url: 'https://www.cbc.ca/news/canada/toronto/king-dufferin-closure-2025',
  });

  const staleStartsSunday = cand({
    title: 'King-Dufferin closure starts Sunday, diverting TTC streetcars, buses',
    snippet:
      'The TTC says the shutdown will begin on Sunday, Sept. 28 to renew aging streetcar tracks at the King Street West and Dufferin Street intersection in Liberty Village.',
    publishedAt: '2025-09-26T12:00:00.000Z',
    dateConfidence: 'exact',
    sourceTier: 'reputable',
    url: 'https://www.cbc.ca/news/canada/toronto/king-dufferin-starts-sunday',
  });

  const currentRoadwork = cand({
    title: 'Lane closures on East Liberty Street for track work until November',
    snippet:
      'TTC track construction in Liberty Village continues until November with intermittent lane closures near Lamport Stadium.',
    publishedAt: '2026-08-01T12:00:00.000Z',
    dateConfidence: 'exact',
    sourceTier: 'official',
    url: 'https://www.ttc.ca/service-advisories/east-liberty-track-work',
  });

  const concludedStale = detectConcludedTimeBoundEvent(staleClosure, nowMs);
  assert.equal(concludedStale.concluded, true, concludedStale.reason);
  const scoredStale = scoreCandidate(staleClosure, {
    nowMs,
    clusterInfo: { independentPublisherCount: 1, clusterHasUsableUrl: true },
  });
  assert.equal(scoredStale.tier, 'reject');
  assert.equal(scoredStale.concludedEvent, true);

  const concludedSunday = detectConcludedTimeBoundEvent(staleStartsSunday, nowMs);
  assert.equal(concludedSunday.concluded, true, concludedSunday.reason);
  assert.equal(
    scoreCandidate(staleStartsSunday, {
      nowMs,
      clusterInfo: { independentPublisherCount: 1, clusterHasUsableUrl: true },
    }).tier,
    'reject',
  );

  const live = detectConcludedTimeBoundEvent(currentRoadwork, nowMs);
  assert.equal(live.concluded, false, `current roadwork must stay live: ${live.reason}`);
  const scoredLive = scoreCandidate(currentRoadwork, {
    nowMs,
    clusterInfo: { independentPublisherCount: 1, clusterHasUsableUrl: true },
  });
  assert.notEqual(scoredLive.tier, 'reject');
  assert.equal(scoredLive.concludedEvent, false);
});

test('park design competition reaches review on civic notability', () => {
  const nowMs = Date.parse('2026-08-08T18:00:00.000Z');
  const parkCompetition = cand({
    title: 'Five Design Teams Shortlisted for Park Competition in Liberty Village',
    snippet:
      'Five design teams have been shortlisted for the international design competition for a new park at 34 Hanna Avenue in Liberty Village.',
    publishedAt: '2026-03-18T12:00:00.000Z',
    dateConfidence: 'exact',
    sourceTier: 'lead',
    url: 'https://urbantoronto.ca/news/2026/03/five-design-teams-shortlisted-park-competition-liberty-village.58012',
  });

  const scored = scoreCandidate(parkCompetition, {
    nowMs,
    clusterInfo: { independentPublisherCount: 1, clusterHasUsableUrl: true },
  });

  assert.ok(
    scored.reasons.some((r) => /civic-design-competition/i.test(r)),
    `expected civic-design-competition notability, got ${scored.reasons.join('; ')}`,
  );
  assert.ok(
    scored.breakdown.notability >= 0.3,
    `notability should reflect competition signal, got ${scored.breakdown.notability}`,
  );
  assert.ok(
    scored.breakdown.freshness >= SCORE_CONFIG.civicDesignCompetitionFreshnessFloor,
    `freshness floor should apply, got ${scored.breakdown.freshness}`,
  );
  assert.ok(
    scored.total >= SCORE_CONFIG.reviewMin,
    `park competition must clear reviewMin, total=${scored.total}`,
  );
  assert.equal(scored.tier, 'review');
  assert.equal(scored.autoPublishEligible, false);
  assert.equal(scored.concludedEvent, false);
});

test('bare public-realm strategy page is not lifted by civic-design-competition', () => {
  const nowMs = Date.parse('2026-08-08T18:00:00.000Z');
  const strategy = cand({
    title: 'Liberty Village Public Realm Strategy',
    snippet: 'City of Toronto',
    rawTextSample: 'City of Toronto',
    publishedAt: '2025-09-12T08:08:00.000Z',
    dateConfidence: 'exact',
    sourceTier: 'lead',
    url: 'https://www.toronto.ca/services-payments/streets-parking-transportation/traffic-management/neighbourhood-streets-plans/liberty-village-public-realm-community-services-study/',
    canonicalUrl:
      'https://toronto.ca/services-payments/streets-parking-transportation/traffic-management/neighbourhood-streets-plans/liberty-village-public-realm-community-services-study',
    publisherDomain: 'toronto.ca',
  });

  const scored = scoreCandidate(strategy, {
    nowMs,
    clusterInfo: { independentPublisherCount: 1, clusterHasUsableUrl: true },
  });

  assert.ok(
    !scored.reasons.some((r) => /civic-design-competition/i.test(r)),
    `bare public realm must not fire civic-design-competition, got ${scored.reasons.join('; ')}`,
  );
  assert.notEqual(
    scored.tier,
    'review',
    `static Public Realm Strategy page must not reach review (tier=${scored.tier}, total=${scored.total})`,
  );
  assert.equal(scored.autoPublishEligible, false);
});

test('near-identical toronto.ca landing pages receive consistent treatment', async () => {
  const { compareCandidatesForReview } = await import('../../scripts/news-pilot/run.mjs');
  const nowMs = Date.parse('2026-08-08T18:00:00.000Z');

  const publicRealmStrategy = cand({
    title: 'Liberty Village Public Realm Strategy',
    snippet: 'City of Toronto',
    rawTextSample: 'City of Toronto',
    publishedAt: '2025-09-12T08:08:00.000Z',
    dateConfidence: 'exact',
    sourceTier: 'lead',
    url: 'https://www.toronto.ca/services-payments/streets-parking-transportation/traffic-management/neighbourhood-streets-plans/liberty-village-public-realm-community-services-study/',
    canonicalUrl:
      'https://toronto.ca/services-payments/streets-parking-transportation/traffic-management/neighbourhood-streets-plans/liberty-village-public-realm-community-services-study',
    publisherDomain: 'toronto.ca',
  });

  const hannaPark = cand({
    title: 'New Park at 34 Hanna Avenue',
    snippet:
      'City of Toronto park facility project for a new park at 34 Hanna Avenue in Liberty Village.',
    url: 'https://www.toronto.ca/city-government/planning-development/construction-new-facilities/park-facility-projects/new-park-at-34-hanna-avenue/',
    canonicalUrl:
      'https://www.toronto.ca/city-government/planning-development/construction-new-facilities/park-facility-projects/new-park-at-34-hanna-avenue/',
    sourceTier: 'official',
    publishedAt: '2026-07-10T00:00:00.000Z',
    dateConfidence: 'approximate',
    publisherDomain: 'toronto.ca',
  });

  const datedNews = cand({
    title: 'Coyotes spotted near Liberty Village parks spark resident debate',
    snippet:
      'Residents debate how the city should respond after coyotes were repeatedly spotted near Liberty Village parks.',
    url: 'https://www.cbc.ca/news/canada/toronto/liberty-village-coyotes-2026',
    canonicalUrl: 'https://www.cbc.ca/news/canada/toronto/liberty-village-coyotes-2026',
    sourceTier: 'reputable',
    publishedAt: '2026-08-04T12:00:00.000Z',
    dateConfidence: 'exact',
  });

  const strategyScore = scoreCandidate(publicRealmStrategy, {
    nowMs,
    clusterInfo: { independentPublisherCount: 1, clusterHasUsableUrl: true },
  });
  const hannaScore = scoreCandidate(hannaPark, {
    nowMs,
    clusterInfo: { independentPublisherCount: 1, clusterHasUsableUrl: true },
  });
  const newsScore = scoreCandidate(datedNews, {
    nowMs,
    clusterInfo: { independentPublisherCount: 1, clusterHasUsableUrl: true },
  });

  // Core defect: both static City landing pages must stay below competitive dated news.
  // Public Realm Strategy is no longer competition-boosted; Hanna remains municipal rank-last.
  assert.ok(
    !strategyScore.reasons.some((r) => /civic-design-competition/i.test(r)),
    'Public Realm Strategy must not receive competition notability',
  );
  assert.notEqual(strategyScore.tier, 'review');
  assert.equal(hannaScore.tier, 'review');
  assert.ok(hannaScore.municipalProjectLabels?.length > 0);
  assert.ok(newsScore.tier === 'review' || newsScore.tier === 'auto-eligible');

  const reviewItems = [
    { title: hannaPark.title, decision: hannaScore.tier, score: hannaScore },
    { title: datedNews.title, decision: newsScore.tier, score: newsScore },
  ].filter((r) => r.decision === 'review');
  const ranked = [...reviewItems].sort(compareCandidatesForReview);
  assert.equal(ranked.at(-1)?.title, hannaPark.title, '34 Hanna must sort last among review items');
  assert.ok(
    !ranked.some((r) => r.title === publicRealmStrategy.title),
    'Public Realm Strategy must not appear in the competitive review ranking',
  );
});

test('hasSportingMatchup rejects civic adversarial phrasing', () => {
  assert.equal(hasSportingMatchup('residents vs developer over Liberty Village tower'), false);
  assert.equal(hasSportingMatchup('Ghana vs Panama at BMO Field'), true);
});
