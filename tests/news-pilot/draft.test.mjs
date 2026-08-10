import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { detectRiskFlags } from '../../scripts/news-pilot/score.mjs';
import {
  buildSourceEvidence,
  resolveSelectedCluster,
  loadSiteLinkIndex,
} from '../../scripts/news-pilot/draft-evidence.mjs';
import { evaluateEvidenceGate, HUMAN_RISK_FLAGS } from '../../scripts/news-pilot/draft-gate.mjs';
import {
  validateDraft,
  extractQuotes,
  wordCount,
  DRAFT_VALIDATION_CONFIG,
  repairInternalLinkFields,
  enforceRunDates,
  normalizeDraftImageField,
  runDateIso,
} from '../../scripts/news-pilot/draft-validate.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const NOW = Date.parse('2026-08-08T18:00:00.000Z');

function baseMember(overrides = {}) {
  return {
    id: 'm1',
    sourceId: 'test-source',
    sourceTier: 'lead',
    title: 'City shortlists five design teams for Liberty Village park',
    url: 'https://example.com/park-shortlist',
    canonicalUrl: 'https://example.com/park-shortlist',
    publishedAt: '2026-03-18T00:00:00.000Z',
    dateConfidence: 'exact',
    urlUsable: true,
    snippet: 'Five teams advance for a new park at 34 Hanna Avenue.',
    publisherDomain: 'example.com',
    clusterId: 'c-test',
    independentPublisherCount: 2,
    score: { total: 0.5, tier: 'review', riskFlags: [], breakdown: {} },
    ...overrides,
  };
}

function packFromSources(sources, overrides = {}) {
  return {
    builtAt: new Date(NOW).toISOString(),
    clusterId: 'c-test',
    title: overrides.title || 'City shortlists five design teams for Liberty Village park',
    snippet: overrides.snippet || 'Five teams advance for a new park at 34 Hanna Avenue.',
    coverageRelation: 'new',
    relatedPostSlug: null,
    matchingSlug: null,
    independentPublisherCount: overrides.independentPublisherCount ?? 2,
    riskFlags: overrides.riskFlags || [],
    sources,
    claimSupport: sources.flatMap((s) =>
      (s.passages || []).map((passage) => ({
        sourceUrl: s.canonicalUrl || s.url,
        publisher: s.publisher,
        publishDate: s.publishDate,
        sourceTier: s.sourceTier,
        passage,
        supports: s.supports || [],
      })),
    ),
    stats: {
      memberCount: sources.length,
      sourceRecords: sources.length,
      usableUrlFetches: sources.filter((s) => s.fetchOk).length,
      substantiveExtractions: sources.filter((s) => s.extractionSubstantive).length,
      failedFetches: sources.filter((s) => !s.fetchOk).length,
    },
    ...overrides,
  };
}

function substantiveSource(overrides = {}) {
  return {
    candidateId: 'm1',
    sourceId: 'test',
    sourceTier: 'lead',
    url: 'https://example.com/park-shortlist',
    canonicalUrl: 'https://example.com/park-shortlist',
    publisherDomain: 'example.com',
    publisher: 'Example News',
    publishDate: '2026-03-18T00:00:00.000Z',
    urlUsable: true,
    fetchOk: true,
    fetchStatus: 200,
    fetchError: null,
    extractionSubstantive: true,
    passages: [
      'The City of Toronto shortlisted five design teams for a new 4900 m² park at 34 Hanna Avenue in Liberty Village.',
      'The international competition will transform a Toronto Parking Authority lot near Hanna Avenue and Liberty Street.',
    ],
    bodyExcerpt:
      'The City of Toronto shortlisted five design teams for a new 4900 m² park at 34 Hanna Avenue in Liberty Village. The international competition will transform a Toronto Parking Authority lot.',
    supports: ['location', 'project-scope', 'size-or-count', 'actor'],
    ...overrides,
  };
}

test('explicit selection is required — does not auto-pick top cluster', () => {
  const candidates = [
    baseMember({
      clusterId: 'c1',
      isClusterRepresentative: true,
      score: { total: 0.9, tier: 'review', riskFlags: [] },
    }),
    baseMember({
      id: 'm2',
      clusterId: 'c2',
      title: 'Lower scoring item',
      isClusterRepresentative: true,
      score: { total: 0.2, tier: 'reject', riskFlags: [] },
    }),
  ];
  const noSel = resolveSelectedCluster(candidates, {});
  assert.equal(noSel.ok, false);
  assert.equal(noSel.error, 'explicit_selection_required');

  const byCluster = resolveSelectedCluster(candidates, { clusterId: 'c2' });
  assert.equal(byCluster.ok, true);
  assert.equal(byCluster.clusterId, 'c2');

  const byRank = resolveSelectedCluster(candidates, { rank: 1 });
  assert.equal(byRank.ok, true);
  assert.equal(byRank.clusterId, 'c1');
});

test('evidence gate refuses a risk-flagged candidate', () => {
  const member = baseMember({
    title: 'Shooting investigated near Liberty Village',
    snippet: 'Police say a shooting and assault investigation is underway after a man was arrested.',
  });
  const flags = detectRiskFlags(member);
  assert.ok(flags.includes('crime'), `expected crime flag, got ${flags.join(',')}`);
  assert.ok(HUMAN_RISK_FLAGS.includes('crime'));

  const sources = [
    substantiveSource({
      passages: [
        'Police say a shooting investigation is underway near East Liberty Street after a man was arrested.',
      ],
    }),
  ];
  const pack = packFromSources(sources, {
    title: member.title,
    snippet: member.snippet,
    riskFlags: flags,
    independentPublisherCount: 3,
  });

  const gate = evaluateEvidenceGate(pack);
  assert.equal(gate.ok, false);
  assert.equal(gate.code, 'risk_flags');
  assert.ok(gate.reasons.some((r) => /risk flag/i.test(r)));
  assert.ok(gate.detail.humanFlags.includes('crime'));
});

test('evidence gate refuses when no member has a usable URL', () => {
  const sources = [
    buildSourceEvidence(
      baseMember({
        url: '',
        canonicalUrl: '',
        urlUsable: false,
      }),
      { ok: false, error: 'unusable_url', errorCode: 'unusable_url' },
    ),
    buildSourceEvidence(
      baseMember({
        id: 'm2',
        url: 'https://www.google.com/goto?url=http://example.com',
        canonicalUrl: 'https://www.google.com/goto?url=http://example.com',
        urlUsable: false,
      }),
      { ok: false, error: 'unusable_url', errorCode: 'unusable_url' },
    ),
  ];
  assert.equal(sources.every((s) => !s.urlUsable || s.fetchError === 'unusable_url'), true);

  const pack = packFromSources(sources, {
    title: 'Mystery item without links',
    independentPublisherCount: 1,
    riskFlags: [],
  });
  // Force urlUsable false on all
  for (const s of pack.sources) {
    s.urlUsable = false;
    s.fetchOk = false;
    s.extractionSubstantive = false;
    s.passages = [];
  }

  const gate = evaluateEvidenceGate(pack);
  assert.equal(gate.ok, false);
  assert.equal(gate.code, 'no_usable_url');
  assert.ok(gate.reasons.some((r) => /usable canonical URL/i.test(r)));
});

test('evidence gate refuses empty extraction even when URLs exist', () => {
  const sources = [
    {
      ...substantiveSource(),
      fetchOk: false,
      extractionSubstantive: false,
      passages: [],
      bodyExcerpt: '',
      fetchError: 'http_403',
    },
  ];
  const pack = packFromSources(sources, { riskFlags: [], independentPublisherCount: 2 });
  const gate = evaluateEvidenceGate(pack);
  assert.equal(gate.ok, false);
  assert.equal(gate.code, 'extraction_empty');
});

test('evidence gate refuses single lead-tier source on consequential claim', () => {
  const sources = [
    substantiveSource({
      sourceTier: 'lead',
      publisherDomain: 'torontolife.com',
      publisher: 'Toronto Life',
    }),
  ];
  const pack = packFromSources(sources, {
    title: '37-storey residential building and hotel proposed in Liberty Village',
    independentPublisherCount: 1,
    riskFlags: [],
  });
  const gate = evaluateEvidenceGate(pack);
  assert.equal(gate.ok, false);
  assert.equal(gate.code, 'single_lead_consequential');
});

function groundedPost(siteIndex, overrides = {}) {
  const realSlug = [...siteIndex.postSlugs][0];
  const runDate = runDateIso(NOW);
  return {
    slug: 'test-park-shortlist-liberty-village',
    title: 'Five teams shortlisted for Liberty Village park',
    description: 'City advances park design competition at 34 Hanna Avenue.',
    content: [
      `Published ${runDate}. Materially updated ${runDate}.`,
      'Originally reported 2026-03-18.',
      '',
      'The City of Toronto shortlisted five design teams for a 4900 m² park at 34 Hanna Avenue ([Example News](https://example.com/park-shortlist)).',
      '',
      '## Why this matters in Liberty Village',
      '',
      `Local context and a valid internal link to [an existing post](/blog/${realSlug}).`,
    ].join('\n'),
    publishedAt: runDate,
    updatedAt: runDate,
    category: 'development',
    tags: ['park', 'liberty-village'],
    answerBlock:
      'The City of Toronto shortlisted five design teams for a new 4900 m² park at 34 Hanna Avenue in Liberty Village.',
    faqs: [{ question: 'Where?', answer: '34 Hanna Avenue in Liberty Village.' }],
    keyTakeaways: [
      'Five design teams shortlisted',
      'Park planned at 34 Hanna Avenue',
      'About 4900 m²',
    ],
    relatedServices: [],
    relatedTopics: [],
    relatedPosts: [realSlug],
    author: 'LibertyVillage.co',
    image: null,
    ...overrides,
  };
}

test('post-generation validation rejects a draft containing a URL absent from the evidence pack', () => {
  const evidencePack = packFromSources(
    [
      substantiveSource(),
      substantiveSource({
        url: 'https://other.example.org/story',
        canonicalUrl: 'https://other.example.org/story',
        publisherDomain: 'other.example.org',
        publisher: 'Other',
      }),
    ],
    { independentPublisherCount: 2 },
  );
  const siteIndex = loadSiteLinkIndex(ROOT);
  assert.ok(siteIndex.postSlugs.size > 0, 'expected real posts.json slugs');

  const realSlug = [...siteIndex.postSlugs][0];
  const post = groundedPost(siteIndex, {
    relatedPosts: [realSlug],
    content: [
      `Published ${runDateIso(NOW)}. Materially updated ${runDateIso(NOW)}.`,
      'Originally reported 2026-03-18.',
      '',
      'The City of Toronto shortlisted five design teams for a 4900 m² park at 34 Hanna Avenue ([Example News](https://example.com/park-shortlist)).',
      '',
      '## Why this matters in Liberty Village',
      '',
      `Local context and a valid internal link to [an existing post](/blog/${realSlug}).`,
      '',
      'Bad external link sneaks in: [Random](https://evil.example/not-in-pack).',
    ].join('\n'),
  });

  const report = validateDraft({
    post,
    newsArticleStructuredData: {
      '@context': 'https://schema.org',
      '@type': 'NewsArticle',
      headline: post.title,
      datePublished: post.publishedAt,
      dateModified: post.updatedAt,
    },
    evidencePack,
    siteIndex,
    nowMs: NOW,
  });

  assert.equal(report.ok, false);
  assert.ok(
    report.failures.some((f) => f.code === 'url_not_in_evidence'),
    `expected url_not_in_evidence, got ${report.failures.map((f) => f.code).join(',')}`,
  );
  assert.ok(
    report.checks.some((c) => c.code === 'urls_in_evidence' && c.ok === false),
  );
});

test('post-generation validation rejects internal link to non-existent slug; accepts real posts.json slug', () => {
  const evidencePack = packFromSources(
    [
      substantiveSource(),
      substantiveSource({
        url: 'https://second.example.com/a',
        canonicalUrl: 'https://second.example.com/a',
        publisherDomain: 'second.example.com',
      }),
    ],
    { independentPublisherCount: 2 },
  );
  const siteIndex = loadSiteLinkIndex(ROOT);
  const realSlug = [...siteIndex.postSlugs][0];
  assert.ok(realSlug);

  const goodPost = groundedPost(siteIndex, {
    slug: 'lv-park-shortlist-2026',
    title: 'Park shortlist',
    description: 'Shortlist for Hanna Avenue park.',
    relatedPosts: [realSlug],
    content: [
      `Published ${runDateIso(NOW)}. Materially updated ${runDateIso(NOW)}.`,
      'Originally reported 2026-03-18.',
      '',
      'Five teams were shortlisted for a 4900 m² park at 34 Hanna Avenue ([source](https://example.com/park-shortlist)).',
      '',
      '## Why this matters in Liberty Village',
      '',
      `See also [related](/blog/${realSlug}).`,
    ].join('\n'),
    answerBlock:
      'Five design teams were shortlisted for a 4900 m² park at 34 Hanna Avenue in Liberty Village.',
    faqs: [{ question: 'Size?', answer: 'About 4900 m².' }],
    keyTakeaways: ['Five teams', '34 Hanna Avenue', '4900 m²'],
    tags: ['park'],
  });

  const good = validateDraft({
    post: goodPost,
    newsArticleStructuredData: {
      '@context': 'https://schema.org',
      '@type': 'NewsArticle',
      headline: goodPost.title,
      datePublished: goodPost.publishedAt,
      dateModified: goodPost.updatedAt,
    },
    evidencePack,
    siteIndex,
    nowMs: NOW,
  });
  assert.equal(
    good.ok,
    true,
    `expected good draft to pass, failures=${JSON.stringify(good.failures)}`,
  );
  assert.equal(good.publishReady, false, 'missing image must block publish-ready');
  assert.ok(good.checks.some((c) => c.code === 'internal_links_exist' && c.ok));

  const badPost = {
    ...goodPost,
    content: goodPost.content.replace(
      `/blog/${realSlug}`,
      '/blog/this-slug-does-not-exist-zz',
    ),
    relatedPosts: ['this-slug-does-not-exist-zz'],
  };
  const bad = validateDraft({
    post: badPost,
    newsArticleStructuredData: {
      '@context': 'https://schema.org',
      '@type': 'NewsArticle',
      headline: badPost.title,
      datePublished: badPost.publishedAt,
      dateModified: badPost.updatedAt,
    },
    evidencePack,
    siteIndex,
    nowMs: NOW,
  });
  assert.equal(bad.ok, false);
  assert.ok(bad.failures.some((f) => f.code === 'internal_link_missing'));
});

test('quote-length cap is enforced', () => {
  const longQuote = Array.from({ length: DRAFT_VALIDATION_CONFIG.maxQuoteWords + 6 }, (_, i) => `word${i}`).join(
    ' ',
  );
  assert.ok(wordCount(longQuote) > DRAFT_VALIDATION_CONFIG.maxQuoteWords);

  const evidencePack = packFromSources(
    [
      substantiveSource({
        passages: [
          ...substantiveSource().passages,
          // put the long quote words into evidence so number/date checks are unrelated
          'Officials said something short.',
        ],
      }),
      substantiveSource({
        url: 'https://second.example.com/a',
        canonicalUrl: 'https://second.example.com/a',
        publisherDomain: 'second.example.com',
      }),
    ],
    { independentPublisherCount: 2 },
  );
  const siteIndex = loadSiteLinkIndex(ROOT);
  const realSlug = [...siteIndex.postSlugs][0];

  const post = groundedPost(siteIndex, {
    slug: 'quote-cap-test',
    title: 'Quote cap',
    description: 'Testing quote cap.',
    category: 'news',
    tags: ['test'],
    relatedPosts: [realSlug],
    content: [
      `Published ${runDateIso(NOW)}. Materially updated ${runDateIso(NOW)}.`,
      'Originally reported 2026-03-18.',
      '',
      `A source said "${longQuote}" according to Example News ([link](https://example.com/park-shortlist)).`,
      '',
      '## Why this matters in Liberty Village',
      '',
      `See [post](/blog/${realSlug}). Five teams and 4900 m² at 34 Hanna Avenue.`,
    ].join('\n'),
    answerBlock: 'Five teams shortlisted for a 4900 m² park at 34 Hanna Avenue.',
    faqs: [{ question: 'Q', answer: 'A about 34 Hanna Avenue and five teams.' }],
    keyTakeaways: ['Five teams', '4900 m²', '34 Hanna Avenue'],
  });

  const quotes = extractQuotes(post.content);
  assert.ok(quotes.some((q) => wordCount(q) > DRAFT_VALIDATION_CONFIG.maxQuoteWords));

  const report = validateDraft({
    post,
    newsArticleStructuredData: {
      '@context': 'https://schema.org',
      '@type': 'NewsArticle',
      headline: post.title,
      datePublished: post.publishedAt,
      dateModified: post.updatedAt,
    },
    evidencePack,
    siteIndex,
    nowMs: NOW,
  });
  assert.equal(report.ok, false);
  assert.ok(report.failures.some((f) => f.code === 'quote_too_long'));
  assert.ok(report.checks.some((c) => c.code === 'quote_length_cap' && c.ok === false));
});

test('buildSourceEvidence marks unusable and failed fetches explicitly', () => {
  const bad = buildSourceEvidence(
    baseMember({ url: '', canonicalUrl: '', urlUsable: false }),
    { ok: false },
  );
  assert.equal(bad.urlUsable, false);
  assert.equal(bad.fetchError, 'unusable_url');
  assert.equal(bad.extractionSubstantive, false);

  const failed = buildSourceEvidence(baseMember(), {
    ok: false,
    status: 500,
    error: 'http_500',
    errorCode: 'http_500',
  });
  assert.equal(failed.fetchOk, false);
  assert.equal(failed.fetchError, 'http_500');
  assert.equal(failed.extractionSubstantive, false);

  const html = `
    <html><head>
      <meta property="article:published_time" content="2026-03-18T12:00:00Z"/>
      <meta property="og:site_name" content="UrbanToronto"/>
    </head><body>
      <article>
        <p>The City of Toronto shortlisted five design teams for a new public park in Liberty Village at 34 Hanna Avenue covering about 4900 square metres near a Toronto Parking Authority lot.</p>
        <p>The international competition advances landscape architecture teams into the next stage of design for the neighbourhood greenspace.</p>
        <p>Local residents have asked for more parkland as towers rise around Hanna Avenue and Liberty Street.</p>
      </article>
    </body></html>`;
  const ok = buildSourceEvidence(baseMember(), {
    ok: true,
    status: 200,
    rawText: html,
  });
  assert.equal(ok.fetchOk, true);
  assert.equal(ok.extractionSubstantive, true);
  assert.ok(ok.passages.length >= 1);
  assert.ok(ok.publishDate);
  assert.match(ok.publisher, /UrbanToronto|example.com/);
});

test('site index loads real posts.json (read-only sanity)', () => {
  const postsPath = path.join(ROOT, 'data', 'posts.json');
  const before = fs.readFileSync(postsPath, 'utf8');
  const index = loadSiteLinkIndex(ROOT);
  const after = fs.readFileSync(postsPath, 'utf8');
  assert.equal(before, after, 'loadSiteLinkIndex must not mutate posts.json');
  assert.ok(index.postSlugs.has('fifa-world-cup-2026-liberty-village-survival-guide'));
  assert.ok(index.topicSlugs.has('transit-guide'));
  assert.ok(index.serviceSlugs.has('restaurants'));
});

test('publishedAt not equal to run date is rejected; enforceRunDates corrects backdating', () => {
  const evidencePack = packFromSources(
    [
      substantiveSource(),
      substantiveSource({
        url: 'https://second.example.com/a',
        canonicalUrl: 'https://second.example.com/a',
        publisherDomain: 'second.example.com',
      }),
    ],
    { independentPublisherCount: 2 },
  );
  const siteIndex = loadSiteLinkIndex(ROOT);
  const runDate = runDateIso(NOW);
  const backdated = groundedPost(siteIndex, {
    publishedAt: '2026-03-18',
    updatedAt: '2026-03-18',
  });

  const rejected = validateDraft({
    post: backdated,
    newsArticleStructuredData: {
      '@context': 'https://schema.org',
      '@type': 'NewsArticle',
      headline: backdated.title,
      datePublished: '2026-03-18',
      dateModified: '2026-03-18',
    },
    evidencePack,
    siteIndex,
    nowMs: NOW,
  });
  assert.equal(rejected.ok, false);
  assert.ok(
    rejected.failures.some((f) => f.code === 'frontmatter_date_not_run_date'),
    `expected frontmatter_date_not_run_date, got ${rejected.failures.map((f) => f.code).join(',')}`,
  );

  const corrected = enforceRunDates(
    backdated,
    {
      '@context': 'https://schema.org',
      '@type': 'NewsArticle',
      headline: backdated.title,
      datePublished: '2026-03-18',
      dateModified: '2026-03-18',
    },
    NOW,
  );
  assert.equal(corrected.post.publishedAt, runDate);
  assert.equal(corrected.post.updatedAt, runDate);
  assert.equal(corrected.newsArticleStructuredData.datePublished, runDate);
  assert.equal(corrected.newsArticleStructuredData.dateModified, runDate);

  const after = validateDraft({
    post: corrected.post,
    newsArticleStructuredData: corrected.newsArticleStructuredData,
    evidencePack,
    siteIndex,
    nowMs: NOW,
  });
  assert.equal(after.ok, true, JSON.stringify(after.failures));
  assert.equal(after.publishReady, false);
});

test('publishedAt=2099-12-31 no longer passes validation (reviewer self-ground probe)', () => {
  const evidencePack = packFromSources(
    [
      substantiveSource(),
      substantiveSource({
        url: 'https://second.example.com/a',
        canonicalUrl: 'https://second.example.com/a',
        publisherDomain: 'second.example.com',
      }),
    ],
    { independentPublisherCount: 2 },
  );
  const siteIndex = loadSiteLinkIndex(ROOT);
  const post = groundedPost(siteIndex, {
    publishedAt: '2099-12-31',
    updatedAt: '2099-12-31',
    // Body also asserts the future date — must not self-ground via frontmatter injection.
    content: groundedPost(siteIndex).content + '\n\nFuture stamp 2099-12-31 must fail grounding.',
  });

  const report = validateDraft({
    post,
    newsArticleStructuredData: {
      '@context': 'https://schema.org',
      '@type': 'NewsArticle',
      headline: post.title,
      datePublished: '2099-12-31',
      dateModified: '2099-12-31',
    },
    evidencePack,
    siteIndex,
    nowMs: NOW,
  });

  assert.equal(report.ok, false);
  assert.ok(
    report.failures.some((f) => f.code === 'frontmatter_date_not_run_date'),
    'frontmatter future date must fail run-date check',
  );
  assert.ok(
    report.failures.some((f) => f.code === 'ungrounded_number_or_date'),
    `body 2099 must fail grounding without frontmatter self-seed; got ${report.failures.map((f) => f.code).join(',')}`,
  );
  const groundedCheck = report.checks.find((c) => c.code === 'numbers_dates_grounded');
  assert.equal(groundedCheck.ok, false);
  assert.ok(
    (groundedCheck.detail?.ungrounded || []).some(
      (u) => u.value === '2099-12-31' || u.value === '2099',
    ),
  );
});

test('draft missing image is flagged as not publish-ready via blocking human gate', () => {
  const evidencePack = packFromSources(
    [
      substantiveSource(),
      substantiveSource({
        url: 'https://second.example.com/a',
        canonicalUrl: 'https://second.example.com/a',
        publisherDomain: 'second.example.com',
      }),
    ],
    { independentPublisherCount: 2 },
  );
  const siteIndex = loadSiteLinkIndex(ROOT);
  const post = groundedPost(siteIndex);
  delete post.image;

  const normalized = normalizeDraftImageField(post);
  assert.equal(normalized.humanMustSupplyImage, true);
  assert.equal(normalized.post.image, null);

  const report = validateDraft({
    post: normalized.post,
    newsArticleStructuredData: {
      '@context': 'https://schema.org',
      '@type': 'NewsArticle',
      headline: post.title,
      datePublished: post.publishedAt,
      dateModified: post.updatedAt,
    },
    evidencePack,
    siteIndex,
    nowMs: NOW,
  });

  assert.equal(report.ok, true, `content validation should pass: ${JSON.stringify(report.failures)}`);
  assert.equal(report.publishReady, false);
  assert.ok(
    report.humanGates.some((g) => g.code === 'image_required_for_publish' && g.blocking),
  );
  assert.equal(report.stats.imageStatus, 'absent');
});

test('repair dropping a hallucinated slug produces a visible validation warning', () => {
  const siteIndex = loadSiteLinkIndex(ROOT);
  const realSlug = [...siteIndex.postSlugs][0];
  const evidencePack = packFromSources(
    [
      substantiveSource(),
      substantiveSource({
        url: 'https://second.example.com/a',
        canonicalUrl: 'https://second.example.com/a',
        publisherDomain: 'second.example.com',
      }),
    ],
    { independentPublisherCount: 2 },
  );

  const raw = groundedPost(siteIndex, {
    relatedPosts: [realSlug, 'this-hallucinated-slug-does-not-exist-zz'],
    relatedTopics: ['also-fake-topic-slug-zz'],
  });
  const repaired = repairInternalLinkFields(raw, siteIndex);
  assert.ok(repaired.warnings.some((w) => w.code === 'internal_link_dropped'));
  assert.ok(
    repaired.warnings.some((w) =>
      /this-hallucinated-slug-does-not-exist-zz/.test(w.message),
    ),
  );
  assert.deepEqual(repaired.post.relatedPosts, [realSlug]);
  assert.deepEqual(repaired.post.relatedTopics, []);

  const report = validateDraft({
    post: repaired.post,
    newsArticleStructuredData: {
      '@context': 'https://schema.org',
      '@type': 'NewsArticle',
      headline: repaired.post.title,
      datePublished: repaired.post.publishedAt,
      dateModified: repaired.post.updatedAt,
    },
    evidencePack,
    siteIndex,
    nowMs: NOW,
    repairWarnings: repaired.warnings,
  });

  assert.equal(report.ok, true, JSON.stringify(report.failures));
  assert.ok(report.warnings.some((w) => w.code === 'internal_link_dropped'));
  assert.ok(report.checks.some((c) => c.code === 'repair_warnings' && c.ok));
  // Inline markdown links still validated raw — hallucination there still fails.
  const withBadInline = {
    ...repaired.post,
    content:
      repaired.post.content +
      '\n\nSee [bogus](/blog/this-hallucinated-slug-does-not-exist-zz).',
  };
  const inlineFail = validateDraft({
    post: withBadInline,
    newsArticleStructuredData: {
      '@context': 'https://schema.org',
      '@type': 'NewsArticle',
      headline: withBadInline.title,
      datePublished: withBadInline.publishedAt,
      dateModified: withBadInline.updatedAt,
    },
    evidencePack,
    siteIndex,
    nowMs: NOW,
    repairWarnings: repaired.warnings,
  });
  assert.equal(inlineFail.ok, false);
  assert.ok(inlineFail.failures.some((f) => f.code === 'internal_link_missing'));
});
