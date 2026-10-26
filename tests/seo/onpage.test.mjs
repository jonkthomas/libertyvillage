// SEO wave 2 PR-1: homepage head term, guide H1, body linkify, truthful About/byline (D4).
// Run: node --import tsx --test tests/seo/onpage.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const words = (s) => s.split(/\s+/).filter(Boolean).length;

const { generateHomePageMeta, guideHeading } = await import('../../lib/meta.ts');
const { generateOrganizationSchema, generateBlogPostSchema } = await import('../../lib/schema.ts');
const { linkifyHtml } = await import('../../lib/linkify.tsx');
const { renderMarkdownContent } = await import('../../lib/markdown.ts');

test('homepage title and meta description target "Liberty Village" within length limits', () => {
  const meta = generateHomePageMeta();
  const title = String(meta.title);
  const description = String(meta.description);
  assert.match(title, /^Liberty Village/);
  assert.ok(title.length >= 30 && title.length <= 60, `title is ${title.length} chars`);
  assert.match(description, /Liberty Village/);
  assert.ok(description.length >= 120 && description.length <= 160, `description is ${description.length} chars`);
  assert.doesNotMatch(description, /by residents/i);
});

test('homepage renders a 134-167 word direct answer about Liberty Village', async () => {
  const { HOME_ANSWER } = await import('../../lib/home.ts');
  const n = words(HOME_ANSWER);
  assert.ok(n >= 134 && n <= 167, `answer is ${n} words`);
  assert.match(HOME_ANSWER, /^Liberty Village is /);
  assert.doesNotMatch(HOME_ANSWER, /world cup|written by residents/i);
  assert.match(read('app/page.tsx'), /HOME_ANSWER/, 'homepage must render HOME_ANSWER');
});

test('Organization schema drops World Cup from knowsAbout and never invents sameAs', async () => {
  const org = generateOrganizationSchema();
  assert.ok(org.knowsAbout.length > 0);
  for (const topic of org.knowsAbout) assert.doesNotMatch(topic, /world cup|fifa/i);
  // No real social profile exists in the repo yet, so sameAs must stay absent rather than made up.
  assert.equal('sameAs' in org, false);
  const { HOME_FAQS } = await import('../../lib/home.ts');
  for (const faq of HOME_FAQS) assert.doesNotMatch(faq.answer, /world cup|fifa/i);
});

test('guide H1 names "Liberty Village" once for every guide topic', () => {
  const topics = JSON.parse(read('data/topics.json'));
  assert.ok(topics.length > 0);
  for (const t of topics) {
    const h1 = guideHeading(t.title);
    assert.equal((h1.match(/liberty village/gi) || []).length, 1, `${t.slug}: "${h1}"`);
  }
  assert.equal(guideHeading('Fitness Guide'), 'Liberty Village Fitness Guide');
  assert.equal(guideHeading('Liberty Village Parking: Where to Park'), 'Liberty Village Parking: Where to Park');
  assert.doesNotMatch(read('app/guide/[topic]/page.tsx'), /Liberty Village \{topic\.title\}/);
});

const lookups = [
  { name: 'Brodflour', href: '/directory/brodflour' },
  { name: 'Mozy\'s', href: '/directory/mozys' },
  { name: 'Cibo Wine Bar', href: '/directory/cibo-wine-bar' },
  { name: 'good space', href: '/directory/good-space' },
  { name: 'Self Cafe', href: '/blog/self-post' },
];

test('linkifyHtml links the first mention of a directory business in a body', () => {
  const html = renderMarkdownContent([
    '## Brodflour bakery',
    '',
    'Start at Brodflour for bread. Brodflour also sells pizza on Fridays.',
    '',
    'Then try [Cibo Wine Bar](/best/restaurants) or Mozy\'s Shawarma, a good space for lunch.',
  ].join('\n'));
  const out = linkifyHtml(html, lookups, { selfHref: '/blog/self-post' });
  const links = [...out.matchAll(/<a href="([^"]+)"[^>]*>([^<]*)<\/a>/g)].map((m) => [m[1], m[2]]);
  // Brodflour: linked once, in the paragraph, not in the heading.
  assert.deepEqual(links.filter(([h]) => h === '/directory/brodflour'), [['/directory/brodflour', 'Brodflour']]);
  assert.match(out, /<h2[^>]*>Brodflour bakery<\/h2>/);
  assert.match(out, /Brodflour also sells/, 'second mention stays plain text');
  // Existing link text is not re-linked.
  assert.equal(links.filter(([h]) => h === '/directory/cibo-wine-bar').length, 0);
  assert.match(out, /<a href="\/best\/restaurants"[^>]*>Cibo Wine Bar<\/a>/);
  // Escaped apostrophe still matches; all-lowercase generic names never match.
  assert.ok(links.some(([h]) => h === '/directory/mozys'));
  assert.equal(links.filter(([h]) => h === '/directory/good-space').length, 0);
});

test('linkifyHtml skips code, the page itself, and targets the body already links', () => {
  const html = '<p>Visit <code>Brodflour</code> or Self Cafe.</p><p>See <a href="/directory/brodflour">the bakery</a>. Brodflour opens at 8.</p>';
  const out = linkifyHtml(html, lookups, { selfHref: '/blog/self-post' });
  assert.match(out, /<code>Brodflour<\/code>/);
  assert.doesNotMatch(out, /href="\/blog\/self-post"/);
  assert.equal((out.match(/href="\/directory\/brodflour"/g) || []).length, 1);
  assert.equal(linkifyHtml(html, [], {}), html);
});

test('About page and blog byline make no claims a collective byline cannot back up (D4)', () => {
  const about = read('app/about/page.tsx');
  const removed = [
    'written by Liberty Village residents',
    'small editorial team of neighbourhood residents',
    'firsthand visits',
    'We visit in person',
    'has been visited by at least one team member',
    'firsthand experience',
    'long-time locals',
    'reviewed each January',
    'verified in person',
    '48 hours or less',
    'Google Business messaging',
    'annual service reviews',
    'credit individual contributors',
  ];
  for (const claim of removed) assert.equal(about.includes(claim), false, `About still says "${claim}"`);
  assert.match(about, /LibertyVillage\.co Editorial/, 'collective byline stays');
  assert.equal(read('app/blog/[slug]/page.tsx').includes('local residents covering'), false);
});

test('blog post schema credits the collective byline as an Organization, never an invented person', () => {
  const schema = generateBlogPostSchema({
    title: 't', description: 'd', publishedAt: '2026-06-01', updatedAt: '2026-06-01', slug: 's',
    author: 'Maya Chen, Liberty Village resident and local food writer (verified June 2026)',
  });
  assert.equal(schema.author['@type'], 'Organization');
  assert.equal(schema.author.name, 'LibertyVillage.co Editorial');
});
