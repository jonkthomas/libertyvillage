import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { candidatesFromGsc, rankTopicCandidates, localEvidenceHints, growthHints, appendDiscoveredTopics, discoverTopics } from '../../scripts/automation/topic-queue.mjs';
const current = [
  { keys: ['https://libertyvillage.co/directory', 'liberty village coffee'], clicks: 10, impressions: 1000, position: 22 },
  { keys: ['https://libertyvillage.co/blog/gyms', 'liberty village gyms'], clicks: 70, impressions: 900, position: 2 },
];

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
