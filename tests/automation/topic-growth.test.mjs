import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { candidatesFromGsc, rankTopicCandidates, localEvidenceHints, growthHints, appendDiscoveredTopics, discoverTopics, gscEditorialTitle, gscServedPage, checkTopicGroundability } from '../../scripts/automation/topic-queue.mjs';
const current = [
  { keys: ['https://libertyvillage.co/directory', 'liberty village coffee'], clicks: 10, impressions: 1000, position: 22 },
  { keys: ['https://libertyvillage.co/blog/gyms', 'liberty village gyms'], clicks: 70, impressions: 900, position: 2 },
];

const dentistCandidate = {
  kind: 'blog', title: 'Dentists in Liberty Village: Your Neighbourhood Dental Care Guide',
  source: 'serpapi', rationale: 'local intent',
};

test('GSC local questions map through canonical locality and keep served queries out', async () => {
  assert.equal(gscEditorialTitle('is liberty village, toronto worth visiting'), 'Is Liberty Village Worth Visiting?');
  for (const query of ['where is liberty township', 'liberty village', 'near liberty village', 'what about liberty village']) assert.equal(gscEditorialTitle(query), null, query);
  const rows = ['is liberty village worth visiting', 'what is liberty village famous for'].map(query => ({ query, impressions: 10 }));
  const candidates = candidatesFromGsc(rows);
  assert.equal(candidates.length, 2);
  const result = await appendDiscoveredTopics({ version: 1, topics: [] }, candidates, {
    publishedPosts: [{ slug: 'what-is-liberty-village-known-for', title: 'What Is Liberty Village Known For?' }], log: () => {},
  });
  assert.deepEqual(result.added.map(e => e.title), ['Is Liberty Village Worth Visiting?']);
});

test('GSC 28-day candidates retain weekly deltas rather than comparing 28 days with 7', () => {
  const query = 'is liberty village worth visiting';
  const dormant = 'where is liberty village located';
  const result = candidatesFromGsc([{ query, impressions: 30 }], [{ query, impressions: 10 }, { query: dormant, impressions: 5 }], {
    candidateRows: [{ query, impressions: 120 }, { query: dormant, impressions: 20 }],
  });
  assert.deepEqual(result.map(e => [e.growth.impressions, e.growth.impressionGrowth]), [[120, 2], [20, -1]]);
});

test('all eight existing GSC theme mappings remain unchanged', () => {
  for (const [query, label] of [['happy hour', 'Happy hour'], ['patios', 'Patio'], ['brunch', 'Brunch'], ['coffee', 'Coffee shop'],
    ['gyms', 'Gym'], ['restaurants', 'Restaurant'], ['bakery', 'Bakery'], ['hair salons', 'Hair salon']]) {
    assert.equal(gscEditorialTitle(`${query} liberty village`), `${label} directory guide in Liberty Village, Toronto`);
  }
  assert.equal(gscEditorialTitle('Jukebox Printing Liberty Village'), null);
});

test('GSC dentist, parking and breakfast fragments produce natural questions at intake and admission', () => {
  for (const [query, title] of [
    ['dentist near liberty village', 'Where Near Liberty Village Can I Find A Dentist?'],
    ['parking near liberty village', 'Where Near Liberty Village Can I Find Parking?'],
    ['best breakfast liberty village', 'Where In Liberty Village Can I Get The Best Breakfast?'],
  ]) {
    assert.equal(gscEditorialTitle(query), title);
    assert.equal(checkTopicGroundability({ title, kind: 'blog' }).editorialTitle, title);
  }
  assert.equal(gscEditorialTitle('liberty village cost mysterious fragment'), null);
  assert.equal(gscEditorialTitle('altea liberty village membership cost'), 'What Does An Altea Liberty Village Membership Cost?');
});

test('GSC lookup aliases reuse live category, guide and post coverage before queue append', async () => {
  const cases = [
    ['dentist near liberty village', { services: [{ slug: 'dentists', name: 'Dentist' }] }, '/best/dentists'],
    ['hotels near liberty village', { guides: [{ slug: 'where-to-stay', title: 'Liberty Village Hotels & Where to Stay in Toronto' }] }, '/guide/where-to-stay'],
    ['bars near liberty village', { services: [{ slug: 'bars', pluralName: 'Bars' }] }, '/best/bars'],
    ['food near liberty village', { services: [{ slug: 'restaurants', name: 'Restaurant' }] }, '/best/restaurants'],
    ['best breakfast liberty village', { services: [{ slug: 'brunch-spots', name: 'Brunch Spot' }] }, '/best/brunch-spots'],
    ['best breakfast liberty village', { guides: [{ slug: 'brunch-guide', title: 'Brunch Guide' }] }, '/guide/brunch-guide'],
    ['is liberty village safe', { guides: [{ slug: 'safety-guide', title: 'Safety Guide' }] }, '/guide/safety-guide'],
    ['dentist near liberty village', { publishedPosts: [{ slug: 'dentists-liberty-village-2026', title: 'Dentists in Liberty Village (2026)' }] }, '/blog/dentists-liberty-village-2026'],
    ['food near liberty village', { publishedPosts: [{ slug: 'best-restaurants-liberty-village-locals-guide', title: 'Best Restaurants in Liberty Village: Locals Guide' }] }, '/blog/best-restaurants-liberty-village-locals-guide'],
  ];
  for (const [query, inventory, url] of cases) {
    assert.equal(gscServedPage(query, inventory), url, query);
    assert.equal(gscServedPage(gscEditorialTitle(query), inventory), url, 'the grammatical question keeps its coverage');
    let messages = [];
    const result = await appendDiscoveredTopics({ version: 1, topics: [] }, [{ kind: 'blog', title: query, source: 'gsc' }], { ...inventory, log: value => { messages = [...messages, value]; } });
    assert.equal(result.added.length, 0, query);
    assert.ok(messages.some(value => value.includes(url)), url);
    const hidden = Object.fromEntries(Object.entries(inventory).map(([key, records]) => [key, records.map(row => ({ ...row, live: false }))]));
    assert.equal(gscServedPage(query, hidden), null, 'unpublished coverage cannot suppress a candidate');
  }
  const category = { services: [{ slug: 'dentists', name: 'Dentist' }] };
  for (const query of ['where are emergency dentists in liberty village', 'where are dentists near parkdale in liberty village']) assert.equal(gscServedPage(query, category), null, 'meaningful qualifiers survive');
});

test('GSC property questions use condo editorial coverage rather than one rental listing', async () => {
  const queries = ['is liberty village a good investment', 'best condo buildings in liberty village'];
  const guide = { slug: 'condo-guide', title: 'Liberty Village Condo Guide', description: 'Buying and investment considerations, plus the best buildings.' };
  const post = { ...guide, slug: 'liberty-village-condo-buying-renting-guide-2026' };
  const listing = { slug: 'downtown-toronto-condo-liberty-village', name: 'Downtown Toronto Condo — Liberty Village', description: 'A compact condo for short-term stays.' };
  for (const query of queries) {
    for (const [inventory, url] of [[{ guides: [guide] }, '/guide/condo-guide'], [{ publishedPosts: [post] }, `/blog/${post.slug}`]]) {
      assert.equal(gscServedPage(query, inventory), url);
      assert.equal((await appendDiscoveredTopics({ version: 1, topics: [] }, [{ kind: 'blog', title: query, source: 'gsc' }], { ...inventory, log: () => {} })).added.length, 0);
    }
    assert.equal(gscServedPage(query, { businesses: [listing] }), null, 'one rental listing does not answer a neighbourhood-wide condo question');
  }
});

test('one primary dentist intent blocks new posts across best/category, blog and guide pages', async () => {
  const cases = [
    { services: [{ slug: 'dentists', name: 'Dentist', pluralName: 'Dentists' }], primary: '/best/dentists' },
    { publishedPosts: [{ slug: 'best-dentists-liberty-village-clinic-reviews-guide-2026', title: 'Best Dentists in Liberty Village: Clinic Reviews Guide 2026' }], primary: '/blog/best-dentists-liberty-village-clinic-reviews-guide-2026' },
    { publishedPosts: [{ slug: 'dentist-liberty-village-complete-guide-2026', title: 'Dentist Liberty Village: The Complete Guide 2026' }], primary: '/blog/dentist-liberty-village-complete-guide-2026' },
    { guides: [{ slug: 'dental-care-guide', title: 'Dental Care in Liberty Village' }], primary: '/guide/dental-care-guide' },
  ];
  for (const { primary, ...inventory } of cases) {
    const reasons = [];
    const result = await appendDiscoveredTopics({ version: 1, topics: [] }, [dentistCandidate], { ...inventory, log: (reason) => reasons.push(reason) });
    assert.equal(result.added.length, 0, primary);
    assert.equal(result.queue.topics.length, 0);
    assert.ok(reasons.some((reason) => reason.includes('intent already served') && reason.includes(primary)), 'log the existing URL rather than silently discard');
  }
});

test('primary-intent guard prefers the category URL and preserves distinct areas, intents and live state', async () => {
  const reasons = [];
  const result = await appendDiscoveredTopics({ version: 1, topics: [] }, [dentistCandidate], {
    services: [{ slug: 'dentists', pluralName: 'Dentists' }],
    publishedPosts: [{ slug: 'dentist-liberty-village-complete-guide-2026', title: 'Dentist Liberty Village: Complete Guide' }],
    log: (reason) => reasons.push(reason),
  });
  assert.equal(result.added.length, 0); assert.match(reasons[0], /\/best\/dentists/);
  for (const publishedPosts of [
    [{ slug: 'dentist-parkdale-guide', title: 'Dentist in Parkdale: Complete Guide' }],
    [{ slug: 'dentist-liberty-village-guide', title: 'Dentist in Liberty Village', live: false }],
    [{ slug: 'dentist-liberty-village-guide', title: 'Dentist in Liberty Village', unpublished: true }],
  ]) {
    assert.equal((await appendDiscoveredTopics({ version: 1, topics: [] }, [dentistCandidate], { publishedPosts })).added.length, 1);
  }
  const distinct = await appendDiscoveredTopics({ version: 1, topics: [] }, [
    { ...dentistCandidate, title: 'Emergency Dentists in Liberty Village' },
    { ...dentistCandidate, title: 'Physiotherapy in Liberty Village' },
  ], { services: [{ slug: 'dentists', pluralName: 'Dentists' }] });
  assert.equal(distinct.added.length, 2, 'retain meaningful service qualifiers and other business types');
});

test('discovery CLI reads live category inventory before persisting a new dentist topic', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-primary-intent-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'posts.json'), '[]');
  fs.writeFileSync(path.join(root, 'topics.json'), '[]');
  fs.writeFileSync(path.join(root, 'services.json'), JSON.stringify([{ slug: 'dentists', name: 'Dentist', pluralName: 'Dentists' }]));
  fs.writeFileSync(path.join(root, 'topic-queue.json'), JSON.stringify({ version: 1, topics: [] }));
  const moduleUrl = new URL('../../scripts/automation/topic-queue.mjs', import.meta.url).href;
  const script = `
    import { fileURLToPath } from 'node:url';
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ related_questions: [{ question: 'Best dentists in Liberty Village 2026?' }] }) });
    process.argv = [process.execPath, fileURLToPath(${JSON.stringify(moduleUrl)}), 'discover'];
    await import(${JSON.stringify(moduleUrl)});`;
  const env = { ...process.env, TOPIC_QUEUE_PATH: path.join(root, 'topic-queue.json'), SERPAPI_API_KEY: 'fixture-only' };
  for (const key of ['GOOGLE_APPLICATION_CREDENTIALS', 'CONTENT_DATABASE_URL', 'CONTENT_DATABASE_URL_UNPOOLED', 'POSTHOG_PERSONAL_API_KEY_LIBERTYVILLAGE', 'GITHUB_OUTPUT']) delete env[key];
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    env, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /added=0/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'topic-queue.json'))).topics.length, 0);
  assert.match(result.stderr, /intent already served.*\/best\/dentists/);
  console.log('LIVE topic discovery CLI: added=0, persisted topics=0; intent already served by /best/dentists');
});

test('GSC poor-position high demand outranks well-ranked query; rising demand and missing page contribute', () => {
  const candidates = candidatesFromGsc(current, [{ keys: ['https://libertyvillage.co/directory', 'liberty village coffee'], impressions: 200 }], { publishedPosts: [{ title: 'Gym directory guide in Liberty Village, Toronto' }] });
  const ranked = rankTopicCandidates(candidates);
  assert.equal(ranked[0].growth.targetQuery, 'liberty village coffee');
  assert.equal(ranked[0].growth.impressionGrowth, 4);
  assert.equal(ranked[0].growth.noMatchingPage, true);
  assert.equal(ranked[1].growth.noMatchingPage, false);
  assert.ok(ranked[0].growth.score > ranked[1].growth.score);
});

test('planner respects learned action/page/query weights, with neutral unseen groups', () => {
  const candidates = [
    { title: 'A', kind: 'blog', growth: { impressions: 500, position: 15, actionKind: 'new_post', pageType: 'blog', queryType: 'local-intent' } },
    { title: 'B', kind: 'seo', growth: { impressions: 500, position: 15, actionKind: 'refresh', pageType: 'guide', queryType: 'informational' } },
    { title: 'C', kind: 'seo', growth: { impressions: 500, position: 15, actionKind: 'refresh', pageType: 'directory', queryType: 'business-name' } },
  ];
  const ranked = rankTopicCandidates(candidates, [
    { actionKind: 'new_post', pageType: 'blog', queryType: 'local-intent', weight: 0.5 },
    { actionKind: 'refresh', pageType: 'guide', queryType: 'informational', weight: 2 },
  ]);
  assert.deepEqual(ranked.map((x) => x.title), ['B', 'C', 'A']);
});

test('snippet learning is distinct from full refresh learning for the same page/query group', () => {
  const growth = { impressions: 500, position: 15, actionKind: 'refresh', pageType: 'blog', queryType: 'local-intent' };
  const ranked = rankTopicCandidates([
    { title: 'Snippet', kind: 'seo', growth: { ...growth, actionType: 'snippet' } },
    { title: 'Full refresh', kind: 'seo', growth },
  ], [
    { actionKind: 'refresh', actionType: 'snippet', pageType: 'blog', queryType: 'local-intent', weight: 0.5 },
    { actionKind: 'refresh', actionType: 'refresh', pageType: 'blog', queryType: 'local-intent', weight: 2 },
  ]);
  assert.deepEqual(ranked.map((entry) => entry.title), ['Full refresh', 'Snippet']);
  assert.equal(ranked[0].growth.actionType, 'refresh');
});

test('ranked demand survives existing near-duplicate filter with evidence in queue rationale', async () => {
  const candidates = rankTopicCandidates(candidatesFromGsc([...current, { ...current[0], keys: ['https://libertyvillage.co', 'coffee liberty village'], impressions: 10 }]));
  const discoveries = candidates.map(({ growth, ...entry }) => ({ ...entry, rationale: entry.rationale + '\nGrowth hints: ' + JSON.stringify(growth) }));
  const { added, queue } = await appendDiscoveredTopics({ version: 1, topics: [] }, discoveries);
  assert.equal(added.length, 2);
  assert.equal(growthHints(queue.topics[0]).targetQuery, 'liberty village coffee');
  assert.equal((await appendDiscoveredTopics(queue, discoveries)).added.length, 0);
  assert.equal((await appendDiscoveredTopics({ version: 1, topics: [] }, discoveries, { publishedPosts: [{ title: 'Coffee shop directory guide in Liberty Village, Toronto' }] })).added.length, 1);
});

test('local hooks reuse directory names, exact street facts and supported real photo paths', () => {
  const businesses = JSON.parse(fs.readFileSync(new URL('../../data/businesses.json', import.meta.url)));
  const hints = localEvidenceHints({ title: 'Liberty Village restaurants' }, businesses);
  assert.ok(hints.length > 0);
  for (const hint of hints) {
    const original = businesses.find((r) => r.slug === hint.recordId);
    assert.equal(hint.name, original.name);
    assert.ok(hint.facts.some((f) => f.field === 'address' && f.value === original.address));
    if (hint.photo) assert.equal(hint.photo, original.image);
  }
});

test('PostHog query executes and resulting candidate carries local hooks; error text is redacted', async (t) => {
  const names = ['GOOGLE_APPLICATION_CREDENTIALS', 'SERPAPI_API_KEY', 'POSTHOG_PERSONAL_API_KEY_LIBERTYVILLAGE'];
  const saved = Object.fromEntries(names.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; for (const key of names) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } });
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS; delete process.env.SERPAPI_API_KEY;
  process.env.POSTHOG_PERSONAL_API_KEY_LIBERTYVILLAGE = 'private-test-token';
  let request;
  globalThis.fetch = async (url, options) => { request = JSON.parse(options.body); return { ok: true, json: async () => ({ results: [['/guide/restaurants', 20]] }) }; };
  const found = await discoverTopics({ now: new Date('2026-10-26T10:00:00Z'), weights: [] });
  assert.match(request.query.query, /SELECT properties.landing_path/);
  assert.equal(found.length, 1); assert.equal(found[0].kind, 'seo');
  assert.ok(growthHints(found[0]).localEvidence.length > 0);
  const warnings = t.mock.method(console, 'warn', () => {});
  globalThis.fetch = async () => { throw Error('private-test-token https://secret-host'); };
  assert.deepEqual(await discoverTopics({ weights: [] }), []);
  assert.equal(warnings.mock.callCount(), 1);
  assert.doesNotMatch(warnings.mock.calls[0].arguments[0], /private-test-token|secret-host/);
});
