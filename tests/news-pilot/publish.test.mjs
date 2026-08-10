import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AUTO_PUBLISH_CONFIG,
  collectRiskFlags,
  countAutoPublishesOnRunDate,
  evaluateAutoPublishEligibility,
  evaluatePublishReadyDraft,
  evaluateSourceQuality,
  prefilterAutoPublishCandidate,
  resolveAutoPublishImage,
} from '../../scripts/news-pilot/publish-gate.mjs';
import {
  appendPostToPostsJson,
  finalizeAutoPublishPost,
  parsePublishArgs,
  runPublish,
} from '../../scripts/news-pilot/publish.mjs';
import { createLocalImageExists, runDateIso } from '../../scripts/news-pilot/draft-validate.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const NOW = Date.parse('2026-08-10T18:00:00.000Z');
const RUN_DATE = runDateIso(NOW);

function baseCandidate(overrides = {}) {
  return {
    id: 'cand-1',
    clusterId: 'c9001',
    title: 'City advances Liberty Village park design shortlist at 34 Hanna',
    snippet: 'Official update on the new park competition in Liberty Village.',
    url: 'https://www.toronto.ca/news/example',
    canonicalUrl: 'https://www.toronto.ca/news/example',
    urlUsable: true,
    clusterHasUsableUrl: true,
    sourceTier: 'official',
    publisherDomain: 'toronto.ca',
    coverageRelation: 'new',
    alreadyCovered: false,
    matchingSlug: null,
    isClusterRepresentative: true,
    score: {
      total: 0.82,
      breakdown: {
        localRelevance: 0.9,
        notability: 0.7,
        evidence: 0.85,
        freshness: 0.8,
      },
      riskFlags: [],
      concludedEvent: false,
      tier: 'auto-eligible',
      autoPublishEligible: true,
      reasons: ['test'],
    },
    ...overrides,
  };
}

function evidencePack(overrides = {}) {
  return {
    clusterId: 'c9001',
    title: 'City advances Liberty Village park design shortlist at 34 Hanna',
    coverageRelation: 'new',
    independentPublisherCount: 2,
    riskFlags: [],
    sources: [
      {
        url: 'https://www.toronto.ca/news/example',
        canonicalUrl: 'https://www.toronto.ca/news/example',
        publisherDomain: 'toronto.ca',
        publisher: 'City of Toronto',
        sourceTier: 'official',
        urlUsable: true,
        fetchOk: true,
        extractionSubstantive: true,
        passages: ['The City of Toronto shortlisted five design teams for 34 Hanna Avenue.'],
        bodyExcerpt: 'The City of Toronto shortlisted five design teams for 34 Hanna Avenue in Liberty Village.',
      },
      {
        url: 'https://urbantoronto.ca/news/example',
        canonicalUrl: 'https://urbantoronto.ca/news/example',
        publisherDomain: 'urbantoronto.ca',
        publisher: 'UrbanToronto',
        sourceTier: 'lead',
        urlUsable: true,
        fetchOk: true,
        extractionSubstantive: true,
        passages: ['Five teams advance in the Liberty Village park competition.'],
        bodyExcerpt: 'Five teams advance in the Liberty Village park competition.',
      },
    ],
    ...overrides,
  };
}

function samplePost(overrides = {}) {
  return {
    slug: 'city-advances-liberty-village-park-shortlist-2026',
    title: 'City advances Liberty Village park design shortlist',
    description: 'Toronto shortlisted design teams for a new park at 34 Hanna Avenue.',
    content:
      '## What happened\n\nThe City of Toronto shortlisted five design teams.\n\n## Why this matters in Liberty Village\n\nResidents near Hanna Avenue will get new open space.\n',
    publishedAt: RUN_DATE,
    updatedAt: RUN_DATE,
    category: 'news',
    tags: ['liberty village', 'park'],
    answerBlock: 'Toronto shortlisted five design teams for a new park at 34 Hanna Avenue in Liberty Village.',
    faqs: [{ question: 'Where is the park?', answer: '34 Hanna Avenue in Liberty Village.' }],
    keyTakeaways: ['Five design teams shortlisted', 'Site is 34 Hanna Avenue'],
    relatedServices: [],
    relatedTopics: [],
    relatedPosts: [],
    author: 'LibertyVillage.co',
    image: null,
    ...overrides,
  };
}

function makeTempRoot(withFallbackImage = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-news-publish-'));
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'public', 'images', 'og'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.news-pilot', 'runs', 't'), { recursive: true });
  const posts = [
    {
      slug: 'existing-post',
      title: 'Existing',
      description: 'd',
      content: 'c',
      publishedAt: '2026-01-01',
      updatedAt: '2026-01-01',
      category: 'lifestyle',
      tags: [],
      answerBlock: 'a',
      faqs: [],
      keyTakeaways: [],
      relatedServices: [],
      relatedTopics: [],
      relatedPosts: [],
      author: 'LibertyVillage.co',
      image: '/images/og/og-home.jpg',
    },
  ];
  fs.writeFileSync(
    path.join(dir, 'data', 'posts.json'),
    `${JSON.stringify(posts, null, 2)}\n`,
    'utf8',
  );
  if (withFallbackImage) {
    fs.writeFileSync(path.join(dir, 'public', 'images', 'og', 'og-home.jpg'), 'fake-image');
  }
  return dir;
}

test('parsePublishArgs reads dry-run and now', () => {
  const args = parsePublishArgs([
    '--run=foo',
    '--dry-run',
    '--now=2026-08-10T18:00:00.000Z',
  ]);
  assert.equal(args.run, 'foo');
  assert.equal(args.dryRun, true);
  assert.equal(args.now, '2026-08-10T18:00:00.000Z');
});

test('story with ANY risk flag is never auto-publish eligible', () => {
  for (const flag of AUTO_PUBLISH_CONFIG.blockedRiskFlags) {
    const candidate = baseCandidate({
      score: { ...baseCandidate().score, riskFlags: [flag], total: 0.95 },
    });
    const pre = prefilterAutoPublishCandidate(candidate, { nowMs: NOW, posts: [] });
    assert.equal(pre.ok, false, `expected block for ${flag}`);
    assert.equal(pre.code, 'risk_flags');

    const full = evaluateAutoPublishEligibility({
      candidate,
      evidencePack: evidencePack({ riskFlags: [flag] }),
      nowMs: NOW,
      posts: [],
    });
    assert.equal(full.ok, false, `expected full block for ${flag}`);
    assert.equal(full.code, 'risk_flags');
  }

  // Unknown future flag also blocks
  const unknown = prefilterAutoPublishCandidate(
    baseCandidate({ score: { ...baseCandidate().score, riskFlags: ['espionage'] } }),
    { nowMs: NOW, posts: [] },
  );
  assert.equal(unknown.ok, false);
  assert.equal(unknown.code, 'risk_flags');
  assert.deepEqual(collectRiskFlags(baseCandidate({ riskFlags: ['crime'] })), ['crime']);
});

test('single-lead-source story is never auto-publish eligible', () => {
  const pack = evidencePack({
    independentPublisherCount: 1,
    sources: [
      {
        url: 'https://torontolife.com/story',
        canonicalUrl: 'https://torontolife.com/story',
        publisherDomain: 'torontolife.com',
        publisher: 'Toronto Life',
        sourceTier: 'lead',
        urlUsable: true,
        fetchOk: true,
        extractionSubstantive: true,
        passages: ['A consequential development claim from one outlet only.'],
        bodyExcerpt: 'A consequential development claim from one outlet only.',
      },
    ],
  });
  const source = evaluateSourceQuality(pack);
  assert.equal(source.ok, false);
  assert.equal(source.code, 'insufficient_source_quality');

  const full = evaluateAutoPublishEligibility({
    candidate: baseCandidate({ sourceTier: 'lead', score: { ...baseCandidate().score, total: 0.9 } }),
    evidencePack: pack,
    nowMs: NOW,
    posts: [],
  });
  assert.equal(full.ok, false);
  assert.equal(full.code, 'insufficient_source_quality');
});

test('story without a real image is never auto-publish eligible', () => {
  const root = makeTempRoot(false);
  try {
    const imageExists = createLocalImageExists(root);
    const resolved = resolveAutoPublishImage(samplePost({ image: null }), {
      root,
      imageExists,
    });
    assert.equal(resolved.ok, false);
    assert.equal(resolved.source, 'none');

    const ready = evaluatePublishReadyDraft({
      validation: { ok: true, failures: [], humanGates: [], publishReady: false },
      post: samplePost({ image: null }),
      root,
      nowMs: NOW,
      posts: [],
      imageExists,
    });
    assert.equal(ready.ok, false);
    assert.equal(ready.code, 'image_required');

    // Fabricated path must not count
    const fake = resolveAutoPublishImage(
      samplePost({ image: '/images/blog/totally-made-up-event.jpg' }),
      { root, imageExists },
    );
    assert.equal(fake.ok, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('neutral OG fallback satisfies image requirement without fabrication', () => {
  const root = makeTempRoot(true);
  try {
    const imageExists = createLocalImageExists(root);
    const resolved = resolveAutoPublishImage(samplePost({ image: null }), {
      root,
      imageExists,
    });
    assert.equal(resolved.ok, true);
    assert.equal(resolved.image, AUTO_PUBLISH_CONFIG.neutralFallbackImage);
    assert.equal(resolved.source, 'neutral_fallback');
    assert.ok(imageExists(resolved.image));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('one-per-day cap holds', () => {
  const posts = [
    {
      slug: 'auto-1',
      category: 'news',
      publishedAt: RUN_DATE,
      tags: [AUTO_PUBLISH_CONFIG.autoPublishTag],
    },
  ];
  assert.equal(countAutoPublishesOnRunDate(posts, NOW), 1);
  const pre = prefilterAutoPublishCandidate(baseCandidate(), { nowMs: NOW, posts });
  assert.equal(pre.ok, false);
  assert.equal(pre.code, 'daily_cap');

  const ready = evaluatePublishReadyDraft({
    validation: { ok: true, failures: [], humanGates: [], publishReady: true },
    post: samplePost({ image: AUTO_PUBLISH_CONFIG.neutralFallbackImage }),
    root: ROOT,
    nowMs: NOW,
    posts,
    imageExists: () => true,
  });
  assert.equal(ready.ok, false);
  assert.equal(ready.code, 'daily_cap');
});

test('publishing appends exactly one valid post and never overwrites an existing slug', () => {
  const root = makeTempRoot(true);
  try {
    const post = finalizeAutoPublishPost(samplePost(), {
      image: AUTO_PUBLISH_CONFIG.neutralFallbackImage,
      nowMs: NOW,
      clusterId: 'c9001',
    });
    const first = appendPostToPostsJson(root, post);
    assert.equal(first.ok, true);
    assert.equal(first.before, 1);
    assert.equal(first.after, 2);

    const after = JSON.parse(fs.readFileSync(path.join(root, 'data', 'posts.json'), 'utf8'));
    assert.equal(after.length, 2);
    assert.equal(after[1].slug, post.slug);
    assert.equal(after[1].category, 'news');
    assert.ok(after[1].tags.includes(AUTO_PUBLISH_CONFIG.autoPublishTag));

    assert.throws(
      () => appendPostToPostsJson(root, post),
      (err) => err?.message?.includes('slug_exists') || err?.code === 'slug_exists',
    );

    const again = JSON.parse(fs.readFileSync(path.join(root, 'data', 'posts.json'), 'utf8'));
    assert.equal(again.length, 2, 'overwrite attempt must not change post count');
    assert.equal(again.filter((p) => p.slug === post.slug).length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('zero qualifying stories exits successfully (0 published is success)', async () => {
  const root = makeTempRoot(true);
  const runDir = path.join(root, '.news-pilot', 'runs', 't');
  const weak = baseCandidate({
    independentPublisherCount: 1,
    sourceTier: 'lead',
    score: { ...baseCandidate().score, total: 0.5, tier: 'review', autoPublishEligible: false },
  });
  fs.writeFileSync(
    path.join(runDir, 'candidates.json'),
    JSON.stringify({ meta: { dryRun: true }, candidates: [weak], representatives: [weak.id] }, null, 2),
    'utf8',
  );
  const outDir = path.join(root, '.news-pilot', 'publish', 'out');
  const result = await runPublish(
    {
      run: runDir,
      out: outDir,
      root,
      now: '2026-08-10T18:00:00.000Z',
      dryRun: true,
      skipGenerate: true,
      vault: '/dev/null',
    },
    {
      // Source quality is judged from the evidence pack, so building it is
      // expected. This lone lead-tier publisher must still fail that check.
      buildEvidencePack: async () => ({
        sources: [
          {
            url: 'https://example.com/a',
            publisherDomain: 'example.com',
            sourceTier: 'lead',
            substantive: true,
            passages: ['A single lead-tier report with no corroboration.'],
          },
        ],
        substantiveSources: 1,
        independentPublisherCount: 1,
        fetchFailures: 0,
      }),
    },
  );
  assert.equal(result.ok, true);
  assert.equal(result.exitCode, 0);
  assert.equal(result.published, 0);
  assert.equal(result.status, 'no_eligible_candidate');
  assert.ok(fs.existsSync(path.join(outDir, 'result.json')));
});

test('score below the sanity floor is rejected even if discovery auto-eligible', () => {
  const candidate = baseCandidate({
    score: {
      ...baseCandidate().score,
      total: 0.3, // below the coarse sanity floor an editor would never see
      tier: 'auto-eligible',
      autoPublishEligible: true,
    },
  });
  const pre = prefilterAutoPublishCandidate(candidate, { nowMs: NOW, posts: [] });
  assert.equal(pre.ok, false);
  assert.equal(pre.code, 'score_below_bar');
});

test('a high-scoring permit record is blocked despite outscoring every real story', () => {
  const permit = baseCandidate({
    title: 'Development application 19 263260 STE 10 CD — 30 ORDNANCE ST',
    score: { ...baseCandidate().score, total: 0.836, tier: 'review' },
  });
  const pre = prefilterAutoPublishCandidate(permit, { nowMs: NOW, posts: [] });
  assert.equal(pre.ok, false);
  assert.equal(pre.code, 'development_application');
});

test('a municipal landing page is blocked as a standing reference, not an event', () => {
  const municipal = baseCandidate({
    title: 'New Park at 34 Hanna Avenue',
    score: {
      ...baseCandidate().score,
      total: 0.49,
      municipalProjectLabels: ['municipal-facility-url', 'municipal-facility-title'],
    },
  });
  const pre = prefilterAutoPublishCandidate(municipal, { nowMs: NOW, posts: [] });
  assert.equal(pre.ok, false);
  assert.equal(pre.code, 'municipal_page');
});

test('a video segment is blocked as a non-event', () => {
  const segment = baseCandidate({
    title: 'Around the 6ix - Liberty Village',
    score: { ...baseCandidate().score, total: 0.54, nonEventLabels: ['video-segment'] },
  });
  const pre = prefilterAutoPublishCandidate(segment, { nowMs: NOW, posts: [] });
  assert.equal(pre.ok, false);
  assert.equal(pre.code, 'non_event');
});

test('a modest-scoring but well-corroborated real story clears the prefilter', () => {
  const parkCompetition = baseCandidate({
    title: 'Five Design Teams Shortlisted for Park Competition in Liberty Village',
    independentPublisherCount: 3,
    score: { ...baseCandidate().score, total: 0.544, tier: 'review', riskFlags: [] },
  });
  const pre = prefilterAutoPublishCandidate(parkCompetition, { nowMs: NOW, posts: [] });
  assert.equal(pre.ok, true, `expected pass, got ${pre.code}: ${(pre.reasons || []).join(' ')}`);
});

test('a follow-up carrying a new development stays publishable', () => {
  const followUp = baseCandidate({
    coverageRelation: 'follow-up',
    relatedPostSlug: 'ontario-line-construction-liberty-village-2026',
  });
  const pre = prefilterAutoPublishCandidate(followUp, { nowMs: NOW, posts: [] });
  assert.equal(pre.ok, true, `expected pass, got ${pre.code}`);
});

test('duplicate coverage is never auto-publish eligible', () => {
  const candidate = baseCandidate({
    coverageRelation: 'duplicate',
    alreadyCovered: true,
    matchingSlug: 'existing-post',
  });
  const pre = prefilterAutoPublishCandidate(candidate, { nowMs: NOW, posts: [] });
  assert.equal(pre.ok, false);
  assert.equal(pre.code, 'coverage_blocked');
});

test('concluded time-bound events are never auto-publish eligible', () => {
  const candidate = baseCandidate({
    score: { ...baseCandidate().score, concludedEvent: true, total: 0.95 },
  });
  const pre = prefilterAutoPublishCandidate(candidate, { nowMs: NOW, posts: [] });
  assert.equal(pre.ok, false);
  assert.equal(pre.code, 'concluded_event');
});

test('official substantive source alone can satisfy source quality', () => {
  const pack = evidencePack({
    independentPublisherCount: 1,
    sources: [
      {
        url: 'https://www.toronto.ca/news/example',
        canonicalUrl: 'https://www.toronto.ca/news/example',
        publisherDomain: 'toronto.ca',
        publisher: 'City of Toronto',
        sourceTier: 'official',
        urlUsable: true,
        fetchOk: true,
        extractionSubstantive: true,
        passages: ['Official city notice.'],
        bodyExcerpt: 'Official city notice about Liberty Village.',
      },
    ],
  });
  const source = evaluateSourceQuality(pack);
  assert.equal(source.ok, true);
  assert.equal(source.code, 'official_or_primary');
});

test('dry-run append does not mutate posts.json', () => {
  const root = makeTempRoot(true);
  try {
    const before = fs.readFileSync(path.join(root, 'data', 'posts.json'), 'utf8');
    const post = finalizeAutoPublishPost(samplePost({ slug: 'dry-run-slug' }), {
      image: AUTO_PUBLISH_CONFIG.neutralFallbackImage,
      nowMs: NOW,
      clusterId: 'c1',
    });
    const result = appendPostToPostsJson(root, post, { dryRun: true });
    assert.equal(result.dryRun, true);
    assert.equal(result.after, 2);
    const after = fs.readFileSync(path.join(root, 'data', 'posts.json'), 'utf8');
    assert.equal(after, before);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('homepage and news route degrade gracefully and list news posts', () => {
  const home = fs.readFileSync(path.join(ROOT, 'app/page.tsx'), 'utf8');
  const news = fs.readFileSync(path.join(ROOT, 'app/news/page.tsx'), 'utf8');
  const data = fs.readFileSync(path.join(ROOT, 'lib/data.ts'), 'utf8');

  assert.match(home, /getNewsPosts/);
  assert.match(home, /Latest News/);
  assert.match(home, /newsPosts\.length > 0/);
  assert.doesNotMatch(home, /No news yet/); // empty state = hide section, not empty box

  assert.match(news, /getNewsPosts/);
  assert.match(news, /No news posts yet/);
  assert.match(news, /href=\{`\/blog\/\$\{post\.slug\}`\}/);

  assert.match(data, /export function getNewsPosts/);
  assert.match(data, /export function selectNewsPosts/);

  // Pure selector behaviour without importing TS
  const posts = [
    { slug: 'a', category: 'news', publishedAt: '2026-08-01' },
    { slug: 'b', category: 'lifestyle', publishedAt: '2026-08-09' },
    { slug: 'c', category: 'news', publishedAt: '2026-08-09' },
  ];
  const selected = posts
    .filter((p) => p.category === 'news')
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  assert.deepEqual(
    selected.map((p) => p.slug),
    ['c', 'a'],
  );
});

test('autopublish workflow is staging-PR only and discovery stays read-only', () => {
  const auto = fs.readFileSync(
    path.join(ROOT, '.github/workflows/news-autopublish.yml'),
    'utf8',
  );
  const discovery = fs.readFileSync(
    path.join(ROOT, '.github/workflows/news-discovery.yml'),
    'utf8',
  );
  const draft = fs.readFileSync(path.join(ROOT, '.github/workflows/news-draft.yml'), 'utf8');

  assert.match(auto, /contents:\s*write/);
  assert.match(auto, /pull-requests:\s*write/);
  assert.match(auto, /--base staging/);
  assert.match(auto, /news\/auto-/);
  assert.match(auto, /--kind news/);
  assert.match(auto, /coordinator\.mjs dispatch/);
  assert.doesNotMatch(auto, /gh pr merge/);
  assert.doesNotMatch(auto, /--base main/);
  assert.doesNotMatch(auto, /\/Users\//);

  assert.match(discovery, /permissions:\n  contents: read/);
  assert.doesNotMatch(discovery, /contents:\s*write/);
  assert.doesNotMatch(discovery, /git add data\/posts\.json|gh pr create/);
  assert.match(discovery, /never writes data\/posts\.json/);
  assert.match(discovery, /was not modified/);

  // Human draft path unchanged: still no PR / no posts.json write
  assert.doesNotMatch(draft, /contents:\s*write/);
  assert.doesNotMatch(draft, /gh pr create/);
  assert.match(draft, /default: "anthropic"/);
  assert.match(draft, /ANTHROPIC_API_KEY: \$\{\{ secrets\.ANTHROPIC_API_KEY \}\}/);
  assert.match(draft, /data\/posts\.json/);
  assert.match(draft, /was not modified/);
  assert.match(draft, /No PR opened/);
});

test('score floor is a coarse sanity filter, not the gate', async () => {
  const scoreMod = await import('../../scripts/news-pilot/score.mjs');
  // The floor exists only so nothing an editor would never see can publish.
  // Eligibility is decided by the categorical conditions, because score.total
  // ranks a review queue and cannot express publish confidence: real stories
  // peak near 0.50 while raw permit rows reach 0.836.
  assert.equal(AUTO_PUBLISH_CONFIG.minScore, scoreMod.SCORE_CONFIG.reviewMin);
  assert.ok(AUTO_PUBLISH_CONFIG.minScore < scoreMod.SCORE_CONFIG.autoEligibleMin);
});
