import test from 'node:test';
import assert from 'node:assert/strict';
import { articleMarkdownText, createTregExtractor } from '../../scripts/news-pilot/treg-extract.mjs';
import { buildEvidencePack, buildSourceEvidence } from '../../scripts/news-pilot/draft-evidence.mjs';
import { evaluateSourceQuality } from '../../scripts/news-pilot/publish-gate.mjs';

const url = 'https://torontotoday.ca/local/transit/king-streetcar';
const member = { id: 'king', title: "TTC's King streetcar diverted after truck crash cut off power in Liberty Village", url, sourceTier: 'lead', urlUsable: true, snippet: 'The TTC is diverting service following a power outage.' };
const body = 'The TTC has diverted King streetcars after a truck hit overhead wires in Liberty Village. Passengers can use replacement service on Queen Street while crews restore power. The work is expected to continue through the afternoon.';
const dnsLookup = async () => [{ address: '8.8.8.8' }];

test('article chrome does not turn a traffic disruption into crime or injury news', async () => {
  const pack = await buildEvidencePack({ representative: member, members: [member], clusterId: 'king', tregExtractor: null,
    fetchFn: async () => ({ ok: true, status: 200, rawText: `<header>Police arrested suspect</header><article><header>TTC service disruption</header><p>${body}</p><aside>A man died in a shooting</aside></article><footer>Judge finds theft</footer>` }) });
  assert.deepEqual(pack.riskFlags, []);
  assert.equal(pack.sources[0].extractionSubstantive, true);
  assert.equal(evaluateSourceQuality(pack).ok, false, 'single publisher remains insufficient');
  for (const text of ['A passenger was injured.', 'Police arrested the driver.', 'Judge finds theft.', 'A public outcry over a coyote cull.']) {
    const risky = await buildEvidencePack({ representative: member, members: [member], clusterId: 'king', tregExtractor: null,
      fetchFn: async () => ({ ok: true, status: 200, rawText: `<article><header>${text}</header><p>${body}</p></article>` }) });
    assert.ok(risky.riskFlags.length > 0, text);
  }
});

test('search descriptions and challenge pages remain leads, not substantive evidence', () => {
  const source = buildSourceEvidence({ ...member, snippet: body }, { ok: false, status: 403 });
  assert.equal(source.leadText, body);
  assert.equal(source.extractionSubstantive, false);
  const challenge = buildSourceEvidence(member, { ok: true, status: 200, rawText: 'Just a moment '.repeat(50) });
  assert.equal(challenge.extractionSubstantive, false);
});

test('inline related-story links never hide later injury or crime claims', async () => {
  const articleText = articleMarkdownText(`${body}\n\nRead more: [Earlier coverage](https://example.com/earlier)\n\nPolice arrested the driver after passengers were injured.`);
  const pack = await buildEvidencePack({ representative: member, members: [member], clusterId: 'king',
    fetchFn: async () => ({ ok: true, status: 200, rawText: articleText, articleText }) });
  assert.ok(pack.riskFlags.includes('crime'));
  assert.ok(pack.riskFlags.includes('safety'));
});

test('empty/failed direct extraction uses thin fallback; substantive direct article does not', async () => {
  let calls = 0;
  const fallback = { extract: async () => { calls++; return { ok: true, status: 200, rawText: body, articleText: body, extractionProvider: 'treg:diffbot' }; } };
  for (const result of [{ ok: false, status: 403 }, { ok: true, status: 200, rawText: '<html></html>' }]) {
    const pack = await buildEvidencePack({ representative: member, members: [member], clusterId: 'king', fetchFn: async () => result, tregExtractor: fallback });
    assert.equal(pack.sources[0].extractionSubstantive, true);
    assert.equal(pack.sources[0].extractionProvider, 'treg:diffbot');
  }
  await buildEvidencePack({ representative: member, members: [member], clusterId: 'king', fetchFn: async () => ({ ok: true, status: 200, rawText: `<article>${body}</article>` }), tregExtractor: fallback });
  assert.equal(calls, 2);
});

test('treg is opt-in, capped per run, caches repeats, and does not leak token on redirect', async () => {
  let calls = 0;
  const fetchFn = async (endpoint, opts) => {
    calls++;
    assert.equal(endpoint.origin, 'https://treg.to');
    assert.equal(opts.redirect, 'error');
    return new Response(JSON.stringify({ output: { pages: [{ markdown: body, final_url: JSON.parse(opts.body).url }] } }), { headers: { 'X-Treg-Cost-Micro': '1196' } });
  };
  const off = createTregExtractor({ env: {}, fetchFn, dnsLookup });
  assert.equal(await off.extract(url), null);
  const zero = createTregExtractor({ env: { TREG_TOKEN: 'fixture', LV_NEWS_TREG_MAX_CALLS: '0' }, fetchFn, dnsLookup });
  assert.equal(await zero.extract(url), null);
  const relay = createTregExtractor({ env: { TREG_TOKEN: 'fixture', LV_NEWS_TREG_MAX_CALLS: '2' }, fetchFn, dnsLookup });
  assert.ok(await relay.extract(url));
  assert.ok(await relay.extract(url));
  assert.equal(calls, 1);
  assert.equal(await relay.extract('http://127.0.0.1/private'), null);
  assert.ok(await relay.extract(url + '-2'));
  assert.ok(await relay.extract(url), 'cached evidence survives exhausting the cap');
  assert.equal(await relay.extract(url + '-3'), null);
  assert.equal(relay.calls, 2);
  assert.equal(relay.costMicro, 2392);
});

test('relay rejects publisher substitution and fails closed on malformed or echoed errors', async () => {
  for (const data of [{ output: { pages: [{ markdown: body, final_url: 'https://other.ca/story' }] } }, { error: 'fixture-secret' }, { output: { pages: [{ markdown: body, final_url: 'http://localhost/private' }] } }]) {
    const relay = createTregExtractor({ env: { TREG_TOKEN: 'fixture-secret' }, dnsLookup,
      fetchFn: async () => new Response(JSON.stringify(data)) });
    assert.equal(await relay.extract(url), null);
  }
});
