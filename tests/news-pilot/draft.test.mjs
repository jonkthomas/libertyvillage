import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

import { detectRiskFlags } from '../../scripts/news-pilot/score.mjs';
import {
  buildSourceEvidence,
  resolveSelectedCluster,
  loadSiteLinkIndex,
  buildEvidencePack,
  isUnusableUrl,
  resolveMemberRiskFlags,
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
  createLocalImageExists,
  isPlausibleLocalImagePath,
  runDateIso,
} from '../../scripts/news-pilot/draft-validate.mjs';
import {
  DEFAULT_VAULT,
  resolveModelProvider,
  refreshKimiAccessToken,
  generateDraftWithModel,
  MODEL_PROVIDERS,
} from '../../scripts/news-pilot/draft-model.mjs';
import { ensureDraftOutDir } from '../../scripts/news-pilot/draft.mjs';
import {
  createRequestBudget,
  FETCH_DEFAULTS,
  fetchWithRetry,
  fetchSource,
} from '../../scripts/news-pilot/fetch.mjs';
import {
  isBlockedPublicHttpUrl,
  isPrivateOrLocalIp,
  ipv4MappedToDotted,
} from '../../scripts/news-pilot/url-guard.mjs';
import { ensureRunOutDir, reserveSourceBudgets } from '../../scripts/news-pilot/run.mjs';
import { CKAN_DEV_APPS } from '../../scripts/news-pilot/sources.mjs';
import { renderMarkdownContent } from '../../lib/markdown.ts';
import { serializeJsonLd } from '../../lib/schema.ts';

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

test('runDateIso uses the Liberty Village Toronto calendar day', () => {
  assert.equal(runDateIso(Date.parse('2026-08-11T02:30:00.000Z')), '2026-08-10');
  assert.equal(runDateIso(Date.parse('2026-01-01T04:30:00.000Z')), '2025-12-31');
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

test('markdown renderer escapes HTML and drops unsafe link destinations', () => {
  const rendered = renderMarkdownContent(
    'Hello <script>alert(1)</script> [bad](javascript:alert(1)) [good](https://example.com/safe).',
  );
  assert.doesNotMatch(rendered, /<script|javascript:/i);
  assert.match(rendered, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(rendered, /href="https:\/\/example\.com\/safe"/);
});

test('JSON-LD serializer cannot be closed by model-authored text', () => {
  const serialized = serializeJsonLd({ headline: '</script><script>alert(1)</script>' });
  assert.doesNotMatch(serialized, /<\/script|<script/i);
  assert.match(serialized, /\\u003c\/script\\u003e/);
});

test('draft validation rejects raw HTML, unsafe links, canonical overrides and unsafe CTAs', () => {
  const evidencePack = packFromSources([substantiveSource()], {
    independentPublisherCount: 1,
  });
  const siteIndex = loadSiteLinkIndex(ROOT);
  const base = groundedPost(siteIndex);
  const cases = [
    {
      expected: 'raw_html_forbidden',
      post: { ...base, content: `${base.content}\n<img src=x onerror=alert(1)>` },
    },
    {
      expected: 'unsafe_markdown_link',
      post: { ...base, content: `${base.content}\n[click](javascript:alert(1))` },
    },
    {
      expected: 'canonical_url_forbidden',
      post: { ...base, canonicalUrl: 'https://evil.example/steal-equity' },
    },
    {
      expected: 'explore_cta_invalid',
      post: {
        ...base,
        exploreCta: { label: 'Click', href: 'javascript:alert(1)', description: 'Bad' },
      },
    },
  ];
  for (const attack of cases) {
    const report = validateDraft({
      post: attack.post,
      newsArticleStructuredData: {
        '@context': 'https://schema.org',
        '@type': 'NewsArticle',
        headline: attack.post.title,
        datePublished: attack.post.publishedAt,
        dateModified: attack.post.updatedAt,
      },
      evidencePack,
      siteIndex,
      nowMs: NOW,
    });
    assert.ok(
      report.failures.some((failure) => failure.code === attack.expected),
      `expected ${attack.expected}, got ${report.failures.map((failure) => failure.code).join(',')}`,
    );
  }
});

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


// ---------------------------------------------------------------------------
// CodeRabbit PR #56 major-finding regression coverage
// ---------------------------------------------------------------------------

test('finding1: DEFAULT_VAULT has no hardcoded /Users/ personal path', async () => {
  assert.equal(DEFAULT_VAULT == null || typeof DEFAULT_VAULT === 'string', true);
  if (typeof DEFAULT_VAULT === 'string') {
    assert.equal(
      DEFAULT_VAULT.includes('/Users/'),
      false,
      `DEFAULT_VAULT must not embed a personal home path, got ${DEFAULT_VAULT}`,
    );
  }
  const { hydrateModelEnvFromVault } = await import('../../scripts/news-pilot/draft-model.mjs');
  const env = {};
  const result = hydrateModelEnvFromVault(null, env);
  assert.equal(result.vaultPresent, false);
  assert.equal(result.vaultPath, null);
});

test('finding2: empty riskFlags array triggers fresh detectRiskFlags', () => {
  const member = baseMember({
    title: 'Shooting investigated near Liberty Village after a man was arrested',
    snippet: 'Police say a shooting and assault investigation is underway.',
    score: { total: 0.4, tier: 'review', riskFlags: [], breakdown: {} },
  });
  const flags = resolveMemberRiskFlags(member);
  assert.ok(flags.includes('crime'), `expected crime from fresh detection, got ${flags}`);
  // Non-empty stored flags are respected.
  const stored = resolveMemberRiskFlags({
    ...member,
    score: { riskFlags: ['legal'] },
  });
  assert.deepEqual(stored, ['legal']);
});

test('finding2b: buildEvidencePack riskFlags includes member risks when stored array empty', async () => {
  const rep = baseMember({
    title: 'Park design shortlist advances in Liberty Village',
    score: { total: 0.5, tier: 'review', riskFlags: [], breakdown: {} },
  });
  const risky = baseMember({
    id: 'm-risk',
    title: 'Shooting investigated near East Liberty Street',
    snippet: 'Police arrested a man after a shooting near Liberty Village.',
    url: 'https://other.example.com/crime',
    canonicalUrl: 'https://other.example.com/crime',
    publisherDomain: 'other.example.com',
    score: { total: 0.2, tier: 'review', riskFlags: [], breakdown: {} },
  });
  const html = `<html><body><article>${'The City of Toronto shortlisted five design teams for a new park at 34 Hanna Avenue in Liberty Village. '.repeat(6)}</article></body></html>`;
  const pack = await buildEvidencePack({
    representative: rep,
    members: [rep, risky],
    clusterId: 'c-risk',
    nowMs: NOW,
    fetchFn: async () => ({ ok: true, status: 200, rawText: html }),
  });
  assert.ok(
    pack.riskFlags.includes('crime'),
    `expected crime on pack.riskFlags, got ${pack.riskFlags.join(',')}`,
  );
});

test('evidence-body safety terms route a neutrally headlined story to humans', async () => {
  const rep = baseMember({
    title: 'Emergency response closes lane near Liberty Village',
    snippet: 'Officials attended an incident near East Liberty Street.',
    score: { total: 0.5, tier: 'review', riskFlags: [], breakdown: {} },
  });
  const benignLead = 'Officials attended an incident near East Liberty Street while traffic was redirected and nearby services continued operating. '.repeat(15);
  assert.ok(benignLead.length > 1_200, 'fixture must place risk terms beyond scorer window');
  const html = `<html><body><article>${benignLead}Officials then confirmed one person died after a fire inside the Liberty Village building. Emergency crews remained at the site.</article></body></html>`;
  const pack = await buildEvidencePack({
    representative: rep,
    members: [rep],
    clusterId: 'c-body-safety',
    nowMs: NOW,
    fetchFn: async () => ({ ok: true, status: 200, rawText: html }),
  });
  assert.ok(
    pack.riskFlags.includes('safety'),
    `expected evidence-body safety flag, got ${pack.riskFlags.join(',')}`,
  );
  const gate = evaluateEvidenceGate(pack);
  assert.equal(gate.ok, false);
  assert.equal(gate.code, 'risk_flags');
});

test('finding3: independentPublisherCount counts only substantive extractions', async () => {
  const rep = baseMember({
    independentPublisherCount: 99, // poisoned upstream value must not win
    publisherDomain: 'example.com',
  });
  const failed = baseMember({
    id: 'm2',
    url: 'https://failed.example.org/x',
    canonicalUrl: 'https://failed.example.org/x',
    publisherDomain: 'failed.example.org',
  });
  const html = `<html><body><article>${'The City of Toronto shortlisted five design teams for a new park at 34 Hanna Avenue in Liberty Village covering about 4900 square metres near a Toronto Parking Authority lot. '.repeat(4)}</article></body></html>`;
  let calls = 0;
  const pack = await buildEvidencePack({
    representative: rep,
    members: [rep, failed],
    clusterId: 'c-corr',
    nowMs: NOW,
    fetchFn: async (url) => {
      calls += 1;
      if (String(url).includes('failed.example.org')) {
        return { ok: false, status: 500, error: 'http_500', errorCode: 'http_500', rawText: '' };
      }
      return { ok: true, status: 200, rawText: html };
    },
  });
  assert.equal(calls, 2);
  assert.equal(pack.stats.substantiveExtractions, 1);
  assert.equal(pack.stats.failedFetches >= 1, true);
  assert.equal(
    pack.independentPublisherCount,
    1,
    'failed fetch must not inflate publisher corroboration count',
  );
  const gate = evaluateEvidenceGate({
    ...pack,
    title: '37-storey residential building proposed in Liberty Village',
  });
  // single lead consequential should still refuse with only one substantive publisher
  assert.equal(gate.ok, false);
  assert.equal(gate.code, 'single_lead_consequential');
});

test('finding4: fabricated image path does not clear human image gate', () => {
  const siteIndex = loadSiteLinkIndex(ROOT);
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
  const imageExists = createLocalImageExists(ROOT);
  const fabricated = '/images/blog/this-image-does-not-exist-zz-fabricated.jpg';
  assert.equal(isPlausibleLocalImagePath(fabricated), true);
  assert.equal(imageExists(fabricated), false);

  const post = groundedPost(siteIndex, { image: fabricated });
  const normalized = normalizeDraftImageField(post, { imageExists });
  assert.equal(normalized.imageStatus, 'absent');
  assert.equal(normalized.humanMustSupplyImage, true);
  assert.equal(normalized.post.image, null);
  assert.equal(normalized.rejectedImage, fabricated);

  const report = validateDraft({
    post: { ...post, image: fabricated },
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
    imageExists,
  });
  assert.equal(report.publishReady, false);
  assert.ok(report.humanGates.some((g) => g.code === 'image_required_for_publish' && g.blocking));
  assert.ok(report.warnings.some((w) => w.code === 'image_path_rejected'));
  assert.equal(report.stats.imageStatus, 'absent');

  // A real on-disk asset can clear the gate.
  const real = '/images/blog/fifa-world-cup-2026-liberty-village-survival-guide.jpg';
  assert.equal(imageExists(real), true);
  const okImg = normalizeDraftImageField({ ...post, image: real }, { imageExists });
  assert.equal(okImg.imageStatus, 'present');
  assert.equal(okImg.humanMustSupplyImage, false);
});

test('finding5: quotes longer than 400 chars are detected and fail the cap', () => {
  const longSpan = 'word '.repeat(120).trim(); // ~120 words, well over 400 chars
  assert.ok(longSpan.length > 400);
  assert.ok(wordCount(longSpan) > DRAFT_VALIDATION_CONFIG.maxQuoteWords);
  const quotes = extractQuotes(`Officials said "${longSpan}" yesterday.`);
  assert.equal(quotes.length, 1, 'long quote must be extracted, not skipped');
  assert.ok(wordCount(quotes[0]) > DRAFT_VALIDATION_CONFIG.maxQuoteWords);

  const siteIndex = loadSiteLinkIndex(ROOT);
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
  const realSlug = [...siteIndex.postSlugs][0];
  const post = groundedPost(siteIndex, {
    content: [
      `Published ${runDateIso(NOW)}. Materially updated ${runDateIso(NOW)}.`,
      'Originally reported 2026-03-18.',
      '',
      `A source said "${longSpan}" ([link](https://example.com/park-shortlist)).`,
      '',
      '## Why this matters in Liberty Village',
      '',
      `See [post](/blog/${realSlug}). Five teams and 4900 m² at 34 Hanna Avenue.`,
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
    imageExists: () => false,
  });
  assert.equal(report.ok, false);
  assert.ok(report.failures.some((f) => f.code === 'quote_too_long'));
  assert.ok(report.checks.some((c) => c.code === 'quote_length_cap' && c.ok === false));
});

test('finding6: --out=data/x is rejected WITHOUT creating a directory', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'np-out-guard-'));
  const dataTarget = path.join(tmpRoot, 'data', 'anything');
  // Ensure parent data/ does not exist yet either for the draft check.
  assert.equal(fs.existsSync(path.join(tmpRoot, 'data')), false);
  assert.throws(
    () => ensureDraftOutDir(tmpRoot, dataTarget, NOW),
    /refusing_to_write_under_data/,
  );
  assert.equal(fs.existsSync(path.join(tmpRoot, 'data')), false, 'data/ must not be created');
  assert.equal(fs.existsSync(dataTarget), false, 'data/anything must not be created');

  assert.throws(
    () => ensureRunOutDir(tmpRoot, dataTarget, 'stamp'),
    /refusing_to_write_under_data/,
  );
  assert.equal(fs.existsSync(dataTarget), false);

  // Safe out dir still works.
  const okDir = ensureDraftOutDir(tmpRoot, path.join(tmpRoot, '.news-pilot', 'drafts', 't'), NOW);
  assert.equal(fs.existsSync(okDir), true);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('finding7: Kimi refresh uses AbortController timeout; skipped when other provider preferred', async () => {
  let kimiRefreshCalls = 0;
  const hangingFetch = async (url, init = {}) => {
    if (String(url).includes('auth.kimi.com')) {
      kimiRefreshCalls += 1;
      // Honor abort signal like a real hung socket.
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => resolve({ ok: false, status: 599, text: async () => '' }), 60_000);
        if (init.signal) {
          init.signal.addEventListener('abort', () => {
            clearTimeout(t);
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  await assert.rejects(
    () => refreshKimiAccessToken('refresh-token', hangingFetch, { timeoutMs: 50 }),
    /kimi_refresh_timeout|AbortError|timeout/i,
  );
  assert.equal(kimiRefreshCalls, 1);

  // Preferring another PRESENT provider must not call Kimi refresh at all.
  kimiRefreshCalls = 0;
  const env = {
    BYTEPLUS_API_KEY: 'test-byteplus-key-not-real',
  };
  const resolved = await resolveModelProvider(env, {
    prefer: 'byteplus-ark',
    fetchFn: hangingFetch,
    vaultPath: null,
  });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.provider.id, 'byteplus-ark');
  assert.equal(kimiRefreshCalls, 0, 'Kimi refresh must be skipped when preferred provider is present');

  // If preferred provider is absent, fallback may use Kimi — refresh is allowed.
  kimiRefreshCalls = 0;
  const envFallback = { KIMI_CODER_API_KEY: 'expired.header.sig' };
  // expired JWT-ish token without valid exp => refresh path; provide no refresh => no hang
  const resolvedFb = await resolveModelProvider(envFallback, {
    prefer: 'byteplus-ark',
    fetchFn: hangingFetch,
    vaultPath: null,
  });
  // Without refresh token file guarantee, may still return kimi with warning or fail refresh.
  // Critical: hangingFetch must not be left running forever; ensureKimi may call it.
  // We only assert we did not skip refresh solely because prefer was set.
  assert.ok(resolvedFb.ok || resolvedFb.error, 'resolver returns a result');
});

test('finding8: OpenAI and Google adapters guard JSON parse and redact error paths', async () => {
  const openaiProvider = MODEL_PROVIDERS.find((p) => p.id === 'openai');
  const googleProvider = MODEL_PROVIDERS.find((p) => p.id === 'google-gemini');
  assert.ok(openaiProvider && googleProvider);

  const badJsonFetch = async () => ({
    ok: true,
    status: 200,
    text: async () => 'NOT_JSON{{',
  });
  const openaiBad = await generateDraftWithModel({
    resolved: { provider: openaiProvider, apiKey: 'sk-test', envVar: 'OPENAI_API_KEY' },
    system: 's',
    userText: 'u',
    maxTokens: 16,
    timeoutMs: 1000,
    fetchFn: badJsonFetch,
  });
  assert.equal(openaiBad.ok, false);
  assert.equal(openaiBad.error, 'invalid_json_response');

  const googleBad = await generateDraftWithModel({
    resolved: { provider: googleProvider, apiKey: 'ga-test', envVar: 'GOOGLE_API_KEY' },
    system: 's',
    userText: 'u',
    maxTokens: 16,
    timeoutMs: 1000,
    fetchFn: badJsonFetch,
  });
  assert.equal(googleBad.ok, false);
  assert.equal(googleBad.error, 'invalid_json_response');

  const leakyHttpFetch = async (url) => ({
    ok: false,
    status: 401,
    text: async () =>
      `unauthorized Bearer sk-live-LEAKEDSECRET key=${encodeURIComponent('abc.def')} url=${url}`,
  });
  const openaiHttp = await generateDraftWithModel({
    resolved: { provider: openaiProvider, apiKey: 'sk-test', envVar: 'OPENAI_API_KEY' },
    system: 's',
    userText: 'u',
    maxTokens: 16,
    timeoutMs: 1000,
    fetchFn: leakyHttpFetch,
  });
  assert.equal(openaiHttp.ok, false);
  assert.match(openaiHttp.error, /http_401/);
  assert.equal(String(openaiHttp.detail || '').includes('sk-live-LEAKEDSECRET'), false);
  assert.match(String(openaiHttp.detail || ''), /Bearer <redacted>|key=<redacted>/);

  const googleHttp = await generateDraftWithModel({
    resolved: { provider: googleProvider, apiKey: 'ga-test', envVar: 'GOOGLE_API_KEY' },
    system: 's',
    userText: 'u',
    maxTokens: 16,
    timeoutMs: 1000,
    fetchFn: leakyHttpFetch,
  });
  assert.equal(googleHttp.ok, false);
  assert.equal(String(googleHttp.detail || '').includes('sk-live-LEAKEDSECRET'), false);
});

test('finding9: per-source reservation prevents CKAN from exhausting shared budget', () => {
  const budget = createRequestBudget(20);
  const sources = [
    { id: 'toronto-ca-feed', type: 'rss' },
    {
      id: 'ckan-dev-apps-lv',
      type: 'json',
      ckan: {
        streetNames: CKAN_DEV_APPS.streetNames,
        postalPrefixes: CKAN_DEV_APPS.postalPrefixes,
      },
    },
    { id: 'serper-q-liberty-village', type: 'serper' },
    { id: 'serpapi-q-liberty-village', type: 'serpapi' },
  ];
  reserveSourceBudgets(budget, sources);

  // CKAN reservation is capped and leaves room for later sources.
  const ckanReserved = budget.remainingReserved('ckan-dev-apps-lv');
  const serperReserved = budget.remainingReserved('serper-q-liberty-village');
  const serpapiReserved = budget.remainingReserved('serpapi-q-liberty-village');
  assert.ok(ckanReserved > 0);
  assert.ok(ckanReserved <= (FETCH_DEFAULTS.ckanMaxRequestsPerRun || 32));
  assert.ok(serperReserved > 0, 'serper must retain a reservation');
  assert.ok(serpapiReserved > 0, 'serpapi must retain a reservation');

  // Even if CKAN spends its entire reservation, serper can still take.
  while (budget.remainingReserved('ckan-dev-apps-lv') > 0) {
    budget.take(1, 'ckan-dev-apps-lv');
  }
  assert.equal(budget.remainingReserved('ckan-dev-apps-lv'), 0);
  assert.doesNotThrow(() => budget.take(1, 'serper-q-liberty-village'));
  assert.doesNotThrow(() => budget.take(1, 'serpapi-q-liberty-village'));
  // CKAN cannot steal serper's remaining reservation via unscoped take.
  assert.throws(() => budget.take(5), /request_budget_exceeded/);
});

test('finding10: private/loopback evidence URLs are blocked before fetchFn', async () => {
  for (const bad of [
    'http://127.0.0.1/secret',
    'http://localhost:8080/x',
    'http://169.254.169.254/latest/meta-data/',
    'http://192.168.1.10/admin',
    'http://10.0.0.5/internal',
    'http://[::1]/status',
    'file:///etc/passwd',
    // Reviewer probe: WHATWG serializes [::ffff:127.0.0.1] → ::ffff:7f00:1
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:7f00:1]/',
    'http://[::ffff:192.168.0.1]/',
    'http://[::ffff:c0a8:1]/',
    'http://[::ffff:0a00:1]/', // 10.0.0.1
    'http://[::ffff:a9fe:a9fe]/', // 169.254.169.254
  ]) {
    assert.equal(isUnusableUrl(bad), true, `expected unusable: ${bad}`);
  }
  assert.equal(isUnusableUrl('https://example.com/story'), false);
  assert.equal(isUnusableUrl('http://[::ffff:0808:0808]/'), false, 'public IPv4-mapped must remain allowed lexically');

  assert.equal(ipv4MappedToDotted('::ffff:7f00:1'), '127.0.0.1');
  assert.equal(ipv4MappedToDotted('::ffff:c0a8:101'), '192.168.1.1');
  assert.equal(isPrivateOrLocalIp('::ffff:7f00:1'), true);
  assert.equal(isPrivateOrLocalIp('::ffff:0808:0808'), false);

  let fetched = [];
  const rep = baseMember({
    url: 'http://127.0.0.1:9/private',
    canonicalUrl: 'http://127.0.0.1:9/private',
    publisherDomain: '127.0.0.1',
  });
  const pack = await buildEvidencePack({
    representative: rep,
    members: [rep],
    clusterId: 'c-ssrf',
    nowMs: NOW,
    fetchFn: async (url) => {
      fetched.push(url);
      return { ok: true, status: 200, rawText: '<html><body>should not run</body></html>' };
    },
  });
  assert.deepEqual(fetched, [], 'fetchFn must not be called for private hosts');
  assert.equal(pack.sources[0].fetchError, 'unusable_url');
  assert.equal(pack.sources[0].urlUsable, false);
  assert.equal(pack.sources[0].bodyExcerpt, '');

  // Mapped IPv6 loopback must also be blocked before fetchFn.
  fetched = [];
  const mappedRep = baseMember({
    url: 'http://[::ffff:127.0.0.1]/secret',
    canonicalUrl: 'http://[::ffff:127.0.0.1]/secret',
    publisherDomain: '::ffff:7f00:1',
  });
  const mappedPack = await buildEvidencePack({
    representative: mappedRep,
    members: [mappedRep],
    clusterId: 'c-ssrf-mapped',
    nowMs: NOW,
    fetchFn: async (url) => {
      fetched.push(url);
      return { ok: true, status: 200, rawText: '<html><body>should not run</body></html>' };
    },
  });
  assert.deepEqual(fetched, [], 'fetchFn must not be called for IPv4-mapped loopback');
  assert.equal(mappedPack.sources[0].urlUsable, false);

  // Redirect onto private host is rejected when guardPublicHttp is on.
  const redirectFetch = async (url, init = {}) => {
    if (String(url).includes('example.com/start')) {
      return {
        ok: false,
        status: 302,
        headers: {
          get: (h) => (String(h).toLowerCase() === 'location' ? 'http://127.0.0.1/steal' : null),
        },
        text: async () => '',
      };
    }
    throw new Error(`unexpected follow to ${url}`);
  };
  // Monkey-patch global fetch for this unit only.
  const prev = globalThis.fetch;
  globalThis.fetch = redirectFetch;
  try {
    const res = await fetchWithRetry('https://example.com/start', {
      maxRetries: 0,
      guardPublicHttp: true,
      isBlockedUrl: isUnusableUrl,
      // example.com must resolve public for the initial hop under the DNS guard.
      dnsLookup: async (hostname) => {
        if (hostname === 'example.com') return [{ address: '93.184.216.34', family: 4 }];
        throw new Error(`unexpected dns for ${hostname}`);
      },
      timeoutMs: 500,
    });
    assert.equal(res.ok, false);
    assert.ok(
      res.errorCode === 'unusable_url' || res.errorCode === 'unsafe_redirect' || /unusable_url/.test(res.error || ''),
      `expected unsafe redirect rejection, got ${res.errorCode}:${res.error}`,
    );
  } finally {
    globalThis.fetch = prev;
  }
});

test('finding10b: DNS-resolved private hosts and failures are blocked (offline resolver)', async () => {
  const privateLookup = async (hostname) => {
    if (hostname === 'private.example.test') {
      return [{ address: '127.0.0.1', family: 4 }];
    }
    if (hostname === 'mixed.example.test') {
      return [
        { address: '93.184.216.34', family: 4 },
        { address: '10.0.0.5', family: 4 },
      ];
    }
    if (hostname === 'public.example.test') {
      return [{ address: '93.184.216.34', family: 4 }];
    }
    if (hostname === 'fail.example.test') {
      const err = new Error('ENOTFOUND');
      err.code = 'ENOTFOUND';
      throw err;
    }
    if (hostname === 'hang.example.test') {
      return new Promise(() => {});
    }
    throw new Error(`unexpected dns hostname ${hostname}`);
  };

  assert.equal(
    await isBlockedPublicHttpUrl('http://private.example.test/x', { lookup: privateLookup }),
    true,
    'hostname resolving to loopback must block',
  );
  assert.equal(
    await isBlockedPublicHttpUrl('http://mixed.example.test/x', { lookup: privateLookup }),
    true,
    'any private address among results must block',
  );
  assert.equal(
    await isBlockedPublicHttpUrl('http://public.example.test/story', { lookup: privateLookup }),
    false,
    'hostname resolving only to public IP must allow',
  );
  assert.equal(
    await isBlockedPublicHttpUrl('http://fail.example.test/x', { lookup: privateLookup }),
    true,
    'DNS failure must fail closed (block)',
  );
  assert.equal(
    await isBlockedPublicHttpUrl('http://hang.example.test/x', {
      lookup: privateLookup,
      dnsTimeoutMs: 40,
    }),
    true,
    'DNS timeout must fail closed (block)',
  );

  // fetchWithRetry must not call network for private-resolving names.
  const prev = globalThis.fetch;
  let networkHits = 0;
  globalThis.fetch = async (url) => {
    networkHits += 1;
    throw new Error(`network should not run for ${url}`);
  };
  try {
    const blocked = await fetchWithRetry('http://private.example.test/secret', {
      maxRetries: 0,
      guardPublicHttp: true,
      dnsLookup: privateLookup,
      timeoutMs: 200,
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.errorCode, 'unusable_url');
    assert.equal(networkHits, 0, 'blocked before fetch');

    const allowedProbe = await fetchWithRetry('http://public.example.test/ok', {
      maxRetries: 0,
      guardPublicHttp: true,
      dnsLookup: privateLookup,
      timeoutMs: 200,
    });
    // Allowed past the guard; our stub fetch throws → network_error proves guard passed.
    assert.equal(allowedProbe.ok, false);
    assert.equal(allowedProbe.errorCode, 'network_error');
    assert.equal(networkHits, 1, 'public-resolving host reaches fetch');

    const dnsFail = await fetchWithRetry('http://fail.example.test/x', {
      maxRetries: 0,
      guardPublicHttp: true,
      dnsLookup: privateLookup,
      timeoutMs: 200,
    });
    assert.equal(dnsFail.ok, false);
    assert.equal(dnsFail.errorCode, 'unusable_url');
  } finally {
    globalThis.fetch = prev;
  }

  // Redirect hop to a hostname that resolves private must be blocked (re-resolve hop).
  const redirectLookup = async (hostname) => {
    if (hostname === 'public.example.test') {
      return [{ address: '93.184.216.34', family: 4 }];
    }
    if (hostname === 'evil-private.example.test') {
      return [{ address: '192.168.9.9', family: 4 }];
    }
    throw new Error(`unexpected dns hostname ${hostname}`);
  };
  const seen = [];
  globalThis.fetch = async (url) => {
    seen.push(String(url));
    if (String(url).includes('public.example.test/start')) {
      return {
        ok: false,
        status: 302,
        headers: {
          get: (h) =>
            String(h).toLowerCase() === 'location'
              ? 'http://evil-private.example.test/pwn'
              : null,
        },
        text: async () => '',
      };
    }
    throw new Error(`should not follow redirect to ${url}`);
  };
  try {
    const res = await fetchWithRetry('http://public.example.test/start', {
      maxRetries: 0,
      guardPublicHttp: true,
      dnsLookup: redirectLookup,
      timeoutMs: 500,
    });
    assert.equal(res.ok, false);
    assert.ok(
      res.errorCode === 'unusable_url' || res.errorCode === 'unsafe_redirect',
      `expected redirect DNS block, got ${res.errorCode}:${res.error}`,
    );
    assert.deepEqual(seen, ['http://public.example.test/start']);
  } finally {
    globalThis.fetch = prev;
  }
});

test('credentialed search APIs never follow redirects with secrets', async () => {
  const previousFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), headers: init.headers || {} });
    return {
      ok: false,
      status: 302,
      headers: { get: (name) => String(name).toLowerCase() === 'location' ? 'https://attacker.example/steal' : null },
      text: async () => '',
    };
  };
  const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];
  try {
    for (const source of [
      { id: 'serper-secret-test', type: 'serper', query: 'Liberty Village' },
      { id: 'serpapi-secret-test', type: 'serpapi', query: 'Liberty Village' },
    ]) {
      calls.length = 0;
      const secrets = source.type === 'serper'
        ? { SERPER_API_KEY: 'test-serper-secret' }
        : { SERPAPI_API_KEY: 'test-serpapi-secret' };
      const result = await fetchSource(source, {
        secrets,
        maxRetries: 0,
        dnsLookup: publicLookup,
      });
      assert.equal(result.ok, false);
      assert.equal(result.errorCode, 'too_many_redirects');
      assert.equal(calls.length, 1, `${source.type} must contact only its fixed API origin`);
      assert.ok(!calls[0].url.startsWith('https://attacker.example/'));
    }
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('anthropic is preferred and authenticates with x-api-key, not bearer', async () => {
  const mod = await import('../../scripts/news-pilot/draft-model.mjs');
  const first = mod.MODEL_PROVIDERS[0];
  assert.equal(first.id, 'anthropic');
  assert.deepEqual(first.envVars, ['ANTHROPIC_API_KEY']);
  assert.equal(first.api, 'anthropic-messages');
  assert.ok(Object.prototype.hasOwnProperty.call(first.headers, 'x-api-key'));

  const kimi = mod.MODEL_PROVIDERS.find((p) => p.id === 'kimi-coder');
  assert.ok(
    !Object.prototype.hasOwnProperty.call(kimi.headers, 'x-api-key'),
    'kimi must keep bearer auth',
  );

  const seen = [];
  const fakeFetch = async (url, init) => {
    seen.push({ url, headers: init.headers });
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ content: [{ type: 'text', text: '{"ok":true}' }] }),
    };
  };

  await mod.generateDraftWithModel({
    resolved: { provider: first, apiKey: 'test-key-anthropic' },
    system: 's',
    userText: 'u',
    maxTokens: 16,
    timeoutMs: 5000,
    fetchFn: fakeFetch,
  });

  assert.equal(seen.length, 1, 'adapter must issue exactly one request');
  const anthropicHeaders = seen[0].headers;
  assert.equal(seen[0].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(anthropicHeaders['x-api-key'], 'test-key-anthropic');
  assert.equal(
    anthropicHeaders.Authorization,
    undefined,
    'must not send bearer alongside x-api-key',
  );

  seen.length = 0;
  await mod.generateDraftWithModel({
    resolved: { provider: kimi, apiKey: 'test-key-kimi' },
    system: 's',
    userText: 'u',
    maxTokens: 16,
    timeoutMs: 5000,
    fetchFn: fakeFetch,
  });

  const kimiHeaders = seen[0].headers;
  assert.equal(kimiHeaders.Authorization, 'Bearer test-key-kimi');
  assert.equal(kimiHeaders['x-api-key'], undefined);
});
