import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { CATEGORY_QUERIES, fetchImage, mapsSearch, parseScopedArgs, runScoped } from '../../scripts/discover-businesses.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(ROOT, 'scripts', 'discover-businesses.mjs');
const FAKE_FETCH = path.join(ROOT, 'tests', 'automation', 'fixtures', 'discovery', 'fake-fetch.mjs');
const SERP_KEY = 'test-serp-key';
const PEXELS_KEY = 'secret-pexels-key';

function lv(title, extra = {}) {
  return {
    title, rating: 4.6, reviews: 120, type: 'Coffee shop',
    address: `${title.length} Liberty St, Toronto, ON M6K 3G3, Canada`,
    gps_coordinates: { latitude: 43.638, longitude: -79.42 }, ...extra,
  };
}

function directory(t, existing = [], registry = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-scoped-discovery-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'data'));
  fs.writeFileSync(path.join(root, 'data', 'businesses.json'), `${JSON.stringify(existing, null, 2)}\n`);
  fs.writeFileSync(path.join(root, 'data', 'discovery-seen.json'), `${JSON.stringify(registry, null, 2)}\n`);
  const snapshot = () => ({
    businesses: fs.readFileSync(path.join(root, 'data', 'businesses.json'), 'utf8'),
    seen: fs.readFileSync(path.join(root, 'data', 'discovery-seen.json'), 'utf8'),
  });
  return { root, snapshot };
}

const response = (status, body) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

// Records every URL; Maps answers come from `maps`, Pexels from `pexels`.
function fakeFetch({ maps, pexels = () => response(500, {}) }) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push(String(url));
    if (String(url).startsWith('https://serpapi.com/')) return maps(String(url), init);
    if (String(url).startsWith('https://api.pexels.com/') || String(url).startsWith('https://images.pexels.com/')) return pexels(String(url), init);
    throw new Error('unexpected host');
  };
  return { impl, calls, maps: () => calls.filter((url) => url.startsWith('https://serpapi.com/')) };
}

const env = (extra = {}) => ({ SERPAPI_API_KEY: SERP_KEY, ...extra });
const results = (...items) => () => response(200, { search_metadata: { status: 'Success' }, local_results: items });
const assertBounded = (result, extraSecrets = []) => {
  const line = JSON.stringify(result);
  assert.ok(Buffer.byteLength(line) <= 160, `outcome line too long: ${line}`);
  for (const secret of [SERP_KEY, PEXELS_KEY, 'serpapi.com', '://', 'Scoped', 'Liberty St', ...extraSecrets]) assert.doesNotMatch(line, new RegExp(secret));
};

test('scoped selector accepts only exact static category slugs and a max of at most 3', () => {
  assert.equal(parseScopedArgs(['--max=15']), null, 'unscoped weekly discovery stays on the legacy path');
  assert.equal(parseScopedArgs([]), null);
  assert.deepEqual(parseScopedArgs(['--category=coffee-shops']), { category: 'coffee-shops', query: 'coffee shops', max: 3 });
  assert.deepEqual(parseScopedArgs(['--max=2', '--category=tattoo-parlors']), { category: 'tattoo-parlors', query: 'tattoo shops', max: 2 });
  for (const slug of Object.values(CATEGORY_QUERIES)) assert.equal(parseScopedArgs([`--category=${slug}`]).category, slug);
  for (const args of [
    ['--category=coffee shops'], ['--category=Coffee-Shops'], ['--category=pet-friendly-patios'], ['--category='], ['--category'],
    ['--category=__proto__'], ['--category=constructor'], ['--category=bars&q=pet+friendly'], ['--category=bars', '--category=gyms'],
    ['--category=bars', '--max=4'], ['--category=bars', '--max=0'], ['--category=bars', '--max=2.5'], ['--category=bars', '--max=03'],
    ['--category=bars', '--max=1', '--max=2'], ['--category=bars', '--dry'], ['--category=bars', '--query=pet friendly bars'],
  ]) {
    assert.deepEqual(parseScopedArgs(args), { error: 'invalid-arguments' }, args.join(' '));
  }
});

test('scoped discovery makes exactly one Maps request for the allowlisted category and adds at most max', async (t) => {
  const { root, snapshot } = directory(t);
  const fetch = fakeFetch({ maps: results(lv('Scoped Cafe Alpha', { reviews: 900 }), lv('Scoped Cafe Beta', { reviews: 800 }),
    lv('Scoped Cafe Gamma', { reviews: 700 }), lv('Scoped Cafe Delta', { reviews: 600 })) });
  const { code, result } = await runScoped({ category: 'coffee-shops', query: 'coffee shops', max: 3 }, { root, env: env(), fetchImpl: fetch.impl });
  assert.equal(code, 0);
  assert.deepEqual(result, { outcome: 'added', category: 'coffee-shops', mapsRequests: 1 });
  assert.equal(fetch.maps().length, 1);
  const q = new URL(fetch.maps()[0]).searchParams.get('q');
  assert.equal(q, 'coffee shops Liberty Village Toronto');
  const added = JSON.parse(snapshot().businesses);
  assert.deepEqual(added.map((b) => b.name), ['Scoped Cafe Alpha', 'Scoped Cafe Beta', 'Scoped Cafe Gamma']);
  assert.ok(added.every((b) => b.category === 'coffee-shops' && b._needsEnrichment === true && b.image === ''));
  assert.deepEqual(Object.keys(JSON.parse(snapshot().seen)).sort(), ['scopedcafealpha', 'scopedcafebeta', 'scopedcafegamma']);
  assert.equal(fs.existsSync(path.join(root, 'tasks')), false, 'scoped runs write no provenance file outside the business lane');
  assertBounded(result);
});

test('true empty: no Google results, or only filtered/duplicate records, is a successful no-change', async (t) => {
  for (const maps of [
    () => response(200, { search_metadata: { status: 'Success' }, error: "Google hasn't returned any results for this query." }),
    results(),
    results(lv('Known Cafe'), lv('Out Of Box Cafe', { gps_coordinates: { latitude: 43.7, longitude: -79.3 } }), lv('Low Rated Cafe', { rating: 3.1 })),
  ]) {
    const { root, snapshot } = directory(t, [{ slug: 'known-cafe', name: 'Known Cafe', address: '1 Elsewhere' }]);
    const before = snapshot();
    const fetch = fakeFetch({ maps });
    const { code, result } = await runScoped({ category: 'coffee-shops', query: 'coffee shops', max: 3 }, { root, env: env({ PEXELS_API_KEY: PEXELS_KEY }), fetchImpl: fetch.impl });
    assert.equal(code, 0);
    assert.deepEqual(result, { outcome: 'empty', category: 'coffee-shops', mapsRequests: 1 });
    assert.deepEqual(snapshot(), before, 'genuine empty writes nothing');
    assert.equal(fetch.calls.length, 1, 'no image lookup without an addition');
  }
});

test('Maps 5xx, 429, 4xx, API error, malformed body and timeout are typed outages, never empty', async (t) => {
  const cases = [
    ['http-5xx', () => response(503, { error: `upstream https://serpapi.com/search.json?api_key=${SERP_KEY}` })],
    ['rate-limited', () => response(429, { error: 'Your account has run out of searches.' })],
    ['http-4xx', () => response(401, { error: 'Invalid API key. Your API key should be here: https://serpapi.com/manage-api-key' })],
    ['api-error', () => response(200, { search_metadata: { status: 'Error' }, error: 'Scoped internal failure' })],
    ['malformed', () => response(200, '<html>Scoped proxy page</html>')],
    ['malformed', () => response(200, { search_metadata: { status: 'Processing' } })],
    ['malformed', () => response(200, { search_metadata: { status: 'Success' }, local_results: 'Scoped Cafe' })],
    ['network', () => { throw new TypeError(`fetch failed https://serpapi.com/?api_key=${SERP_KEY}`); }],
    ['timeout', (_url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)))],
  ];
  for (const [reason, maps] of cases) {
    const { root, snapshot } = directory(t);
    const before = snapshot();
    const fetch = fakeFetch({ maps });
    const started = Date.now();
    const { code, result } = await runScoped({ category: 'bars', query: 'bars', max: 3 }, { root, env: env(), fetchImpl: fetch.impl, requestTimeoutMs: 50, deadlineMs: 500 });
    assert.ok(Date.now() - started < 2000, `${reason} must finish within its finite deadline`);
    assert.equal(code, 3, reason);
    assert.deepEqual(result, { outcome: 'maps-unavailable', category: 'bars', mapsRequests: 1, reason });
    assert.deepEqual(snapshot(), before, `${reason} writes nothing`);
    assert.equal(fetch.maps().length, 1, `${reason} does not retry or fan out`);
    assertBounded(result, ['Invalid API', 'run out', 'proxy']);
  }
});

test('HTTP failure headers abort unread Maps and Pexels bodies before clearing deadlines', async (t) => {
  const { root } = directory(t);
  const responseWithUnreadBody = (status) => new Response(new ReadableStream({ start() { /* deliberately never finish */ } }), { status });
  let mapsSignal;
  const maps = await mapsSearch('coffee shops', {
    apiKey: SERP_KEY, timeoutMs: 500,
    fetchImpl: async (_url, { signal }) => { mapsSignal = signal; return responseWithUnreadBody(503); },
  });
  assert.deepEqual(maps, { ok: false, reason: 'http-5xx' });
  assert.equal(mapsSignal.aborted, true, 'unread Maps response must release its transport');
  let imageSignal;
  const image = await fetchImage('no-image', 'coffee-shops', path.join(root, 'public'), {
    apiKey: PEXELS_KEY, timeoutMs: 500,
    fetchImpl: async (_url, { signal }) => { imageSignal = signal; return responseWithUnreadBody(429); },
  });
  assert.equal(image, '');
  assert.equal(imageSignal.aborted, true, 'unread Pexels response must release its transport');
});

test('optional Pexels failure or timeout is not a Maps outage and never blocks the addition', async (t) => {
  for (const pexels of [
    () => response(500, { error: 'down' }),
    () => { throw new TypeError(`fetch failed ${PEXELS_KEY}`); },
    (_url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason))),
  ]) {
    const { root, snapshot } = directory(t);
    const fetch = fakeFetch({ maps: results(lv('Scoped Cafe Alpha')), pexels });
    const started = Date.now();
    const { code, result } = await runScoped({ category: 'coffee-shops', query: 'coffee shops', max: 1 }, { root, env: env({ PEXELS_API_KEY: PEXELS_KEY }), fetchImpl: fetch.impl, requestTimeoutMs: 50, deadlineMs: 1000 });
    assert.ok(Date.now() - started < 2000);
    assert.equal(code, 0);
    assert.deepEqual(result, { outcome: 'added', category: 'coffee-shops', mapsRequests: 1 });
    assert.equal(fetch.calls.filter((url) => url.startsWith('https://api.pexels.com/')).length, 1);
    assert.equal(JSON.parse(snapshot().businesses)[0].image, '');
  }
});

test('the overall deadline bounds Maps plus images; an exhausted budget skips images, not Maps success', async (t) => {
  const { root } = directory(t);
  let clock = 0;
  const fetch = fakeFetch({ maps: () => { clock += 1000; return results(lv('Scoped Cafe Alpha'), lv('Scoped Cafe Beta', { reviews: 80 }))(); } });
  const { code, result } = await runScoped({ category: 'coffee-shops', query: 'coffee shops', max: 2 },
    { root, env: env({ PEXELS_API_KEY: PEXELS_KEY }), fetchImpl: fetch.impl, requestTimeoutMs: 500, deadlineMs: 1000, now: () => clock });
  assert.equal(code, 0);
  assert.equal(result.outcome, 'added');
  assert.equal(fetch.calls.length, 1, 'no Pexels call once the overall budget is spent');
});

test('missing SerpApi key is a config error with zero source requests', async (t) => {
  const { root, snapshot } = directory(t);
  const before = snapshot();
  const fetch = fakeFetch({ maps: results(lv('Scoped Cafe Alpha')) });
  const { code, result } = await runScoped({ category: 'bars', query: 'bars', max: 3 }, { root, env: {}, fetchImpl: fetch.impl });
  assert.equal(code, 2);
  assert.deepEqual(result, { outcome: 'config-error', category: 'bars', mapsRequests: 0 });
  assert.equal(fetch.calls.length, 0);
  assert.deepEqual(snapshot(), before);
});

function spawnDiscovery(t, args, extraEnv = {}) {
  const { root, snapshot } = directory(t);
  const log = path.join(root, 'fetch.log');
  const run = spawnSync(process.execPath, ['--import', FAKE_FETCH, SCRIPT, ...args], {
    cwd: root, encoding: 'utf8', timeout: 60_000,
    env: { PATH: process.env.PATH, SERPAPI_API_KEY: SERP_KEY, FAKE_FETCH_LOG: log, ...extraEnv },
  });
  const requests = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [];
  return { run, requests, snapshot };
}

test('CLI: scoped success prints exactly one bounded JSON line and exits 0', (t) => {
  const { run, requests, snapshot } = spawnDiscovery(t, ['--category=coffee-shops', '--max=2'], { PEXELS_API_KEY: PEXELS_KEY, FAKE_PEXELS_MODE: 'throw' });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, '{"outcome":"added","category":"coffee-shops","mapsRequests":1}\n');
  assert.equal(requests.filter((url) => url.startsWith('https://serpapi.com/')).length, 1);
  assert.equal(JSON.parse(snapshot().businesses).length, 2);
  assert.doesNotMatch(run.stdout + run.stderr, /test-serp-key|secret-pexels-key|Scoped Fake/);
});

test('CLI: scoped 5xx and timeout exit nonzero with a typed outcome and no candidate text or key', (t) => {
  for (const [mode, reason] of [['http-503', 'http-5xx'], ['hang', 'timeout']]) {
    const { run, snapshot } = spawnDiscovery(t, ['--category=bars'], { FAKE_SERP_MODE: mode, DISCOVERY_REQUEST_TIMEOUT_MS: '200' });
    assert.equal(run.status, 3, `${mode}: ${run.stderr}`);
    assert.equal(run.stdout, `${JSON.stringify({ outcome: 'maps-unavailable', category: 'bars', mapsRequests: 1, reason })}\n`);
    assert.doesNotMatch(run.stdout + run.stderr, /test-serp-key|serpapi\.com|Scoped Fake/);
    assert.deepEqual(JSON.parse(snapshot().businesses), []);
  }
});

test('CLI: scoped genuine empty exits 0 with outcome empty', (t) => {
  const { run } = spawnDiscovery(t, ['--category=bars', '--max=1'], { FAKE_SERP_MODE: 'none' });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, '{"outcome":"empty","category":"bars","mapsRequests":1}\n');
});

test('CLI: untrusted category is refused before any source call and is never echoed', (t) => {
  const { run, requests } = spawnDiscovery(t, ['--category=pet friendly patios <script>']);
  assert.equal(run.status, 2);
  assert.equal(run.stdout, '{"outcome":"invalid-arguments","mapsRequests":0}\n');
  assert.doesNotMatch(run.stdout + run.stderr, /pet friendly|script/);
  assert.deepEqual(requests, []);
});

test('CLI: legacy unscoped discovery still scans every static category and keeps its report', (t) => {
  const { run, requests, snapshot } = spawnDiscovery(t, ['--max=15', '--dry']);
  assert.equal(run.status, 0, run.stderr);
  const queries = requests.map((url) => new URL(url).searchParams.get('q'));
  assert.deepEqual(queries, Object.keys(CATEGORY_QUERIES).map((query) => `${query} Liberty Village Toronto`));
  assert.match(run.stdout, /Discovery \d{4}-\d{2}-\d{2}: \d+ candidates, adding \d+ \(cap 15\)\./);
  assert.match(run.stdout, /--dry: no files written\./);
  assert.deepEqual(JSON.parse(snapshot().businesses), []);
});
