// A publish-ready news candidate (real validateDraft + evaluatePublishReadyDraft)
// and the temp export root those checks read.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const NEWS_NOW = '2026-08-10T18:00:00.000Z';
export const NEWS_RUN_DATE = '2026-08-10';

export function newsEvidence() {
  return {
    clusterId: 'c9001',
    title: 'City advances Liberty Village park design shortlist at 34 Hanna',
    coverageRelation: 'new', independentPublisherCount: 2, riskFlags: [],
    sources: [
      {
        url: 'https://www.toronto.ca/news/example', canonicalUrl: 'https://www.toronto.ca/news/example',
        publisherDomain: 'toronto.ca', publisher: 'City of Toronto', sourceTier: 'official',
        urlUsable: true, fetchOk: true, extractionSubstantive: true,
        passages: ['The City of Toronto shortlisted five design teams for 34 Hanna Avenue.'],
        bodyExcerpt: 'The City of Toronto shortlisted five design teams for 34 Hanna Avenue in Liberty Village.',
      },
      {
        url: 'https://urbantoronto.ca/news/example', canonicalUrl: 'https://urbantoronto.ca/news/example',
        publisherDomain: 'urbantoronto.ca', publisher: 'UrbanToronto', sourceTier: 'lead',
        urlUsable: true, fetchOk: true, extractionSubstantive: true,
        passages: ['Five teams advance in the Liberty Village park competition.'],
        bodyExcerpt: 'Five teams advance in the Liberty Village park competition.',
      },
    ],
  };
}

export function newsPost(overrides = {}) {
  return {
    slug: 'city-advances-liberty-village-park-shortlist-2026',
    title: 'City advances Liberty Village park design shortlist',
    description: 'Toronto shortlisted design teams for a new park at 34 Hanna Avenue.',
    content: '## What happened\n\nThe City of Toronto shortlisted five design teams for 34 Hanna Avenue, according to the [City of Toronto](https://www.toronto.ca/news/example).\n\n## Why this matters in Liberty Village\n\nResidents near Hanna Avenue will get new open space, as [UrbanToronto](https://urbantoronto.ca/news/example) reported.\n',
    publishedAt: NEWS_RUN_DATE, updatedAt: NEWS_RUN_DATE, category: 'news',
    tags: ['liberty village', 'park', 'parks', 'city'],
    answerBlock: 'Toronto shortlisted five design teams for a new park at 34 Hanna Avenue in Liberty Village.',
    faqs: [{ question: 'Where is the park?', answer: '34 Hanna Avenue in Liberty Village.' }],
    keyTakeaways: ['Five design teams shortlisted', 'Site is 34 Hanna Avenue'],
    relatedServices: [], relatedTopics: [], relatedPosts: [],
    author: 'LibertyVillage.co', image: '/images/og/og-home.jpg',
    ...overrides,
  };
}

// Export-root stand-in: the repo's live site data plus the OG image the post uses.
export function newsExportRoot(repoRoot) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-news-root-'));
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'public', 'images', 'og'), { recursive: true });
  for (const file of ['services', 'topics', 'posts', 'businesses', 'neighborhoods', 'buildings', 'guide-hub']) {
    fs.copyFileSync(path.join(repoRoot, 'data', `${file}.json`), path.join(dir, 'data', `${file}.json`));
  }
  fs.writeFileSync(path.join(dir, 'public', 'images', 'og', 'og-home.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
  return dir;
}
