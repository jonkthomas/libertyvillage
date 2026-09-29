import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { collectRoundup, COLLECT_LIMITS, roadLeadByName, roundupSignalId } from '../../scripts/news-pilot/roundup-collect.mjs';
import { extractRoundupRecords } from '../../scripts/news-pilot/roundup-records.mjs';
import { ROUNDUP_SOURCES, roundupSourceById } from '../../scripts/news-pilot/sources.mjs';
import { classifyBlockedResponse } from '../../scripts/news-pilot/url-guard.mjs';
import { createHostPacer, createRobotsCache, robotsAllows } from '../../scripts/news-pilot/fetch.mjs';

const NOW = '2026-09-30T14:00:00.000Z';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rv2-collect-'));
const src = (id) => roundupSourceById(id, ROUNDUP_SOURCES);
const ids = (...list) => list.map(src);

const BMO_HTML = `<html><body><main>
<div class="eventItem"><div class="date"><span>Oct </span><span>03</span> <span>at 3:00 PM</span></div><h3 class="title"><a>Toronto Argonauts vs. BC Lions</a></h3><span class="start"> 3:00 PM</span></div>
<div class="eventItem"><div class="date"><span>Oct </span><span>10</span></div><h3 class="title"><a>Toronto FC vs. CF Montréal</a></h3></div>
</main></body></html>`;
const ROAD_JSON = JSON.stringify({ Closure: [
  { id: 'Tor-RD1S2026-975', road: 'Hanna Ave', fromRoad: 'Snooker St', toRoad: 'Liberty St', startTime: '1790600400000', endTime: '1790969400000', description: 'Bell manhole' },
  { id: '12228824', road: 'Don Valley Parkway S', atRoad: 'Lawrence Ave E', startTime: '1790707252000', endTime: null, description: 'stopped vehicle' },
  { id: 'Tor-OLD-1', road: 'Strachan Ave', fromRoad: 'King St W', toRoad: 'Wellington St W', startTime: '1780000000000', endTime: '1780500000000', description: 'ended' },
] });
const TTC_JSON = JSON.stringify({ routes: [
  { id: '77001', route: '504', stopStart: 'King St West at Strachan Ave', stopEnd: 'Dufferin St', headerText: '504 King: Diversion', effect: 'DETOUR', activePeriod: { start: '2026-10-03T12:00:00Z', end: '2026-10-04T12:00:00Z' } },
  { id: '76934', route: '1', stopStart: 'Vaughan', stopEnd: 'Finch West', headerText: 'Line 1', effect: 'REDUCED_SERVICE', activePeriod: { start: '2026-09-25T16:00:00Z', end: '2026-10-01T23:00:00Z' } },
] });
const BIA_HTML = '<body><main><h1>Give Me Liberty Street Party</h1><p>On Thursday, September 17th, 2026, the iconic Lamport Stadium parking lot (75 Fraser Avenue) will transform.</p></main></body>';

function fakeNet(routes) {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', headers: init.headers || {}, body: init.body });
    const route = typeof routes === 'function' ? routes(url, init) : routes[url];
    if (route === undefined) return { status: 404, body: 'not found' };
    if (route instanceof Error) throw route;
    return typeof route === 'string' ? { status: 200, body: route } : route;
  };
  return { fetcher, calls };
}

function fakeClock() {
  let t = Date.parse(NOW);
  const sleeps = [];
  return {
    clock: () => t,
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    },
    tick: (ms) => { t += ms; },
    sleeps,
  };
}

const baseRoutes = {
  'https://www.bmofield.com/robots.txt': 'User-agent: *\nDisallow:\n',
  'https://www.bmofield.com/events': BMO_HTML,
  'https://secure.toronto.ca/robots.txt': { status: 403, body: 'forbidden' },
  'https://secure.toronto.ca/opendata/cart/road_restrictions/v3?format=json': ROAD_JSON,
  'https://alerts.ttc.ca/robots.txt': { status: 404, body: '' },
  'https://alerts.ttc.ca/api/alerts/live-alerts': TTC_JSON,
  'https://www.libertyvillagebia.com/robots.txt': 'User-agent: *\nDisallow: /api/\n',
  'https://www.libertyvillagebia.com/events': BIA_HTML,
};

// ---------------------------------------------------------------------------
// Access primitives (§4.3)
// ---------------------------------------------------------------------------

test('classifyBlockedResponse: 401/402/403/406/429 and challenge bodies are blocked', () => {
  for (const status of [401, 402, 403, 406, 429]) assert.equal(classifyBlockedResponse(status, ''), 'blocked');
  assert.equal(classifyBlockedResponse(200, '<title>Just a moment...</title>'), 'blocked');
  assert.equal(classifyBlockedResponse(200, '<h1>Security Verification</h1>'), 'blocked');
  assert.equal(classifyBlockedResponse(200, '<script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1?ray=1" id="cf-chl-widget"></script>'), 'blocked');
  assert.equal(classifyBlockedResponse(200, '<p>Liberty Village news</p>'), null);
  assert.equal(classifyBlockedResponse(404, ''), null);
  assert.equal(classifyBlockedResponse(500, ''), null);
});

test('robotsAllows: longest match wins, Allow wins ties, product-specific group beats *', () => {
  const txt = 'User-agent: *\nDisallow: /api/\nAllow: /api/ui-extensions/\nDisallow: /*.pdf$\n\nUser-agent: LibertyVillageNewsPilot\nDisallow: /private/\n';
  assert.equal(robotsAllows('User-agent: *\nDisallow: /api/\nAllow: /api/ui-extensions/', 'https://x.ca/api/ui-extensions/a'), true);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /api/', 'https://x.ca/api/data'), false);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /*.pdf$', 'https://x.ca/a/report.pdf'), false);
  assert.equal(robotsAllows(txt, 'https://x.ca/api/data'), true, 'the specific group replaces *');
  assert.equal(robotsAllows(txt, 'https://x.ca/private/a'), false);
  assert.equal(robotsAllows('User-agent: ClaudeBot\nDisallow: /\n', 'https://x.ca/events'), true);
});

test('robots cache: one fetch per host; 4xx = no rules; 5xx or network error = disallow all', async () => {
  const seen = [];
  const bodies = { 'https://a.ca/robots.txt': { status: 200, body: 'User-agent: *\nDisallow: /no/' }, 'https://b.ca/robots.txt': { status: 404, body: '' },
    'https://c.ca/robots.txt': { status: 503, body: '' } };
  const cache = createRobotsCache({ fetchText: async (u) => { seen.push(u); if (u.startsWith('https://d.ca')) throw new Error('x'); return bodies[u]; } });
  assert.equal(await cache.allowed('https://a.ca/yes'), true);
  assert.equal(await cache.allowed('https://a.ca/no/x'), false);
  assert.equal(await cache.allowed('https://b.ca/anything'), true);
  assert.equal(await cache.allowed('https://c.ca/anything'), false);
  assert.equal(await cache.allowed('https://d.ca/anything'), false);
  assert.deepEqual(seen, ['https://a.ca/robots.txt', 'https://b.ca/robots.txt', 'https://c.ca/robots.txt', 'https://d.ca/robots.txt']);
});

test('host pacer: at most one request per host per interval; other hosts are not delayed', async () => {
  const c = fakeClock();
  const pacer = createHostPacer({ minIntervalMs: 2000, now: c.clock, sleep: c.sleep });
  await pacer.wait('https://a.ca/1');
  await pacer.wait('https://b.ca/1');
  c.tick(500);
  await pacer.wait('https://a.ca/2');
  assert.deepEqual(c.sleeps, [1500]);
});

// ---------------------------------------------------------------------------
// Collector
// ---------------------------------------------------------------------------

test('collector: identity sources become record-bound signals; feeds filtered to leads; snapshots 0600 content-addressed', async () => {
  const out = tmp();
  const net = fakeNet(baseRoutes);
  const c = fakeClock();
  const { signals, census, snapshots } = await collectRoundup({ out, now: NOW, env: {}, fetcher: net.fetcher, watchList: [],
    sources: ids('rv2-bmo-field', 'rv2-road-restrictions', 'rv2-ttc-alerts', 'rv2-lv-bia-events'), clock: c.clock, sleep: c.sleep, geography: null });

  const bmo = signals.filter((s) => s.sourceId === 'rv2-bmo-field');
  assert.equal(bmo.length, 2);
  for (const s of bmo) {
    assert.equal(s.records.length, 1);
    assert.equal(s.signalId, roundupSignalId('rv2-bmo-field', 'https://www.bmofield.com/events', s.records[0].recordId));
  }
  const road = signals.filter((s) => s.sourceId === 'rv2-road-restrictions');
  assert.deepEqual(road.map((s) => s.records[0].recordId), ['Tor-RD1S2026-975'], 'only LV-street leads that have not ended');
  const ttc = signals.filter((s) => s.sourceId === 'rv2-ttc-alerts');
  assert.deepEqual(ttc.map((s) => s.records[0].typed.route), ['504']);
  const bia = signals.filter((s) => s.sourceId === 'rv2-lv-bia-events');
  assert.equal(bia.length, 1);
  assert.equal(bia[0].signalId, roundupSignalId('rv2-lv-bia-events', 'https://www.libertyvillagebia.com/events', bia[0].records[0].recordId));

  assert.equal(census.sources['rv2-road-restrictions'].records, 3);
  assert.equal(census.sources['rv2-bmo-field'].status, 'ok');
  assert.equal(census.instagram.status, 'unavailable');
  assert.equal(census.serper.status, 'skipped');

  // Snapshots: every captured body, content-addressed and private.
  assert.equal(snapshots.length, 4);
  for (const s of snapshots) {
    const file = path.join(out, s.path);
    const body = fs.readFileSync(file);
    assert.equal(createHash('sha256').update(body).digest('hex'), s.sha256);
    assert.ok(s.path.endsWith(`${s.sha256}.${s.sourceId.includes('road') || s.sourceId.includes('ttc') ? 'json' : 'html'}`));
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  }
  assert.ok(road[0].snapshotSha256);
  for (const f of ['signals.jsonl', 'census.json']) assert.equal(fs.statSync(path.join(out, f)).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(path.join(out, 'signals.jsonl'), 'utf8').trim().split('\n').length, signals.length);
});

test('two BIA event sections become two independent record-bound signals and forms', async () => {
  const html = '<main><h2>Park opening</h2><p>Opening at 70 East Liberty St, Toronto on October 3, 2026.</p>' +
    '<h2>Stadium event</h2><p>Event at 75 Fraser Ave, Toronto on October 4, 2026.</p></main>';
  const c = fakeClock();
  const routes = { ...baseRoutes, 'https://www.libertyvillagebia.com/events': html };
  const { signals } = await collectRoundup({ out: tmp(), now: NOW, env: {}, fetcher: fakeNet(routes).fetcher,
    watchList: [], sources: ids('rv2-lv-bia-events'), clock: c.clock, sleep: c.sleep });
  assert.equal(signals.length, 2);
  assert.equal(new Set(signals.map((s) => s.signalId)).size, 2);
  assert.ok(signals.every((s) => s.records.length === 1));
});

test('road recall: the geography classifier decides when present; otherwise LV streets or frontage at an LV cross street', async () => {
  assert.equal(roadLeadByName({ road: 'Hanna Ave', fromRoad: 'Snooker St', toRoad: 'Liberty St' }), true);
  assert.equal(roadLeadByName({ road: 'Strachan Ave', fromRoad: 'Fleet St', toRoad: 'Fleet St' }), true);
  assert.equal(roadLeadByName({ road: 'Dufferin St', fromRoad: 'Wilson Ave', toRoad: 'Wilson Ave' }), false, 'Dufferin far north');
  assert.equal(roadLeadByName({ road: 'Lake Shore Blvd W', fromRoad: 'Yonge St', toRoad: 'Bay St' }), false);
  const asked = [];
  const geography = { classifySegment: (seg) => { asked.push(seg.road); return { verdict: seg.road === 'Don Valley Parkway S' ? 'adjacent' : 'not-LV' }; } };
  const c = fakeClock();
  const { signals } = await collectRoundup({ out: tmp(), now: NOW, env: {}, fetcher: fakeNet(baseRoutes).fetcher, watchList: [],
    sources: ids('rv2-road-restrictions'), clock: c.clock, sleep: c.sleep, geography });
  assert.deepEqual(signals.map((s) => s.records[0].recordId), ['12228824']);
  assert.deepEqual(asked, ['Hanna Ave', 'Don Valley Parkway S']);
});

test('collector ↔ verifier contract: re-extracting a snapshot yields the same recordIds and typed fields', async () => {
  const out = tmp();
  const net = fakeNet(baseRoutes);
  const c = fakeClock();
  const { signals, snapshots } = await collectRoundup({ out, now: NOW, env: {}, fetcher: net.fetcher, watchList: [],
    sources: ids('rv2-bmo-field', 'rv2-road-restrictions', 'rv2-lv-bia-events'), clock: c.clock, sleep: c.sleep });
  for (const s of signals) {
    const snap = snapshots.find((x) => x.sha256 === s.snapshotSha256);
    const fresh = extractRoundupRecords({ source: src(s.sourceId), url: s.url, body: fs.readFileSync(path.join(out, snap.path), 'utf8') });
    for (const r of s.records) {
      const again = fresh.find((f) => f.recordId === r.recordId);
      assert.ok(again, `${s.sourceId} ${r.recordId}`);
      assert.deepEqual(again.typed, r.typed);
      assert.ok(again.text.startsWith(r.text), 'signal text is a bounded prefix of the record');
    }
  }
});

test('robots.txt is fetched once per host and a disallowed path is never fetched', async () => {
  const net = fakeNet({ ...baseRoutes, 'https://www.bmofield.com/robots.txt': 'User-agent: *\nDisallow: /events\n' });
  const c = fakeClock();
  const projects = ids('rv2-city-project-34-hanna-park', 'rv2-city-project-liberty-st', 'rv2-city-project-liberty-for-all');
  const { census } = await collectRoundup({ out: tmp(), now: NOW, env: {}, fetcher: net.fetcher, watchList: [],
    sources: [...ids('rv2-bmo-field'), ...projects], clock: c.clock, sleep: c.sleep });
  assert.equal(census.sources['rv2-bmo-field'].status, 'robots-disallowed');
  assert.ok(!net.calls.some((x) => x.url === 'https://www.bmofield.com/events'), 'never fetched');
  const robotsCalls = net.calls.filter((x) => x.url.endsWith('/robots.txt')).map((x) => x.url);
  assert.deepEqual(robotsCalls, ['https://www.bmofield.com/robots.txt', 'https://www.toronto.ca/robots.txt'], 'once per host');
});

test('blocked: a 403 Cloudflare challenge is recorded blocked after exactly one request, with no retry', async () => {
  const challenge = { status: 403, body: '<html><title>Just a moment...</title><div id="cf-chl-widget"></div></html>' };
  const net = fakeNet({ ...baseRoutes, 'https://www.bmofield.com/events': challenge });
  const c = fakeClock();
  const { census, signals } = await collectRoundup({ out: tmp(), now: NOW, env: {}, fetcher: net.fetcher, watchList: [],
    sources: ids('rv2-bmo-field', 'rv2-lv-bia-events'), clock: c.clock, sleep: c.sleep });
  assert.equal(census.sources['rv2-bmo-field'].status, 'blocked');
  assert.equal(net.calls.filter((x) => x.url === 'https://www.bmofield.com/events').length, 1);
  assert.ok(signals.some((s) => s.sourceId === 'rv2-lv-bia-events'), 'other sources proceed');

  const soft = fakeNet({ ...baseRoutes, 'https://www.bmofield.com/events': { status: 200, body: '<h1>Security Verification</h1>' } });
  const r2 = await collectRoundup({ out: tmp(), now: NOW, env: {}, fetcher: soft.fetcher, watchList: [], sources: ids('rv2-bmo-field'), clock: c.clock, sleep: c.sleep });
  assert.equal(r2.census.sources['rv2-bmo-field'].status, 'blocked');
  assert.equal(r2.signals.length, 0);
});

test('politeness: same-host requests are at least 2 s apart', async () => {
  const net = fakeNet(() => '<body><h1>Project</h1><p>Open House Date: October 3, 2026</p></body>');
  const c = fakeClock();
  const stamps = [];
  const fetcher = async (url, init) => { stamps.push([new URL(url).host, c.clock()]); return net.fetcher(url, init); };
  await collectRoundup({ out: tmp(), now: NOW, env: {}, fetcher, watchList: [],
    sources: ids('rv2-city-project-34-hanna-park', 'rv2-city-project-liberty-st', 'rv2-city-project-liberty-for-all'), clock: c.clock, sleep: c.sleep });
  const times = stamps.filter(([h]) => h === 'www.toronto.ca').map(([, t]) => t);
  assert.equal(times.length, 4, 'robots + 3 pages');
  for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= COLLECT_LIMITS.minIntervalMs);
});

test('budgets: at most 80 page fetches (robots included) and at most 12 Serper calls; key stays out of outputs', async () => {
  const key = 'test-serper-key-123';
  let n = 0;
  const serper = (url, init) => {
    const q = JSON.parse(init.body).q;
    return { status: 200, body: JSON.stringify({ news: Array.from({ length: 10 }, () => ({ title: `Story ${n++} about ${q}`, link: `https://site${n}.example.com/story-${n}`, date: '1 day ago' })) }) };
  };
  const net = fakeNet((url, init) => (url === 'https://google.serper.dev/news' ? serper(url, init)
    : url.endsWith('/robots.txt') ? { status: 404, body: '' } : '<body><article><h1>Headline</h1><p>September 29, 2026 — something happened in Toronto.</p></article></body>'));
  const c = fakeClock();
  const { census, signals } = await collectRoundup({ out: tmp(), now: NOW, env: { SERPER_API_KEY: key }, fetcher: net.fetcher, watchList: [],
    sources: ids('rv2-serper-news'), clock: c.clock, sleep: c.sleep });
  const serperCalls = net.calls.filter((x) => x.url === 'https://google.serper.dev/news');
  assert.equal(serperCalls.length, 8, 'the fixed query set (≤12)');
  assert.ok(serperCalls.every((x) => x.headers['X-API-KEY'] === key && x.method === 'POST'));
  const pageCalls = net.calls.filter((x) => x.url !== 'https://google.serper.dev/news');
  assert.ok(pageCalls.length <= 80, `page fetches ${pageCalls.length}`);
  assert.equal(census.budget.fetches, pageCalls.length);
  assert.equal(census.budget.serperCalls, 8);
  assert.ok(census.serper.pageOutcomes.budget > 0, 'remaining results skipped once the budget is spent');
  assert.ok(!JSON.stringify({ census, signals }).includes(key));
});

test('Serper: missing key → unavailable; results group same-story pages from different publishers; instagram links never fetched', async () => {
  const noKey = await collectRoundup({ out: tmp(), now: NOW, env: {}, fetcher: fakeNet({}).fetcher, watchList: [], sources: ids('rv2-serper-news') });
  assert.equal(noKey.census.serper.status, 'unavailable');
  const news = [
    { title: 'New park coming to Hanna Avenue in Liberty Village', link: 'https://www.blogto.com/city/2026/09/park-hanna/' },
    { title: 'New park coming to Hanna Avenue, Liberty Village', link: 'https://www.cp24.com/news/park-hanna' },
    { title: 'Argos beat Lions at BMO Field', link: 'https://www.tsn.ca/argos' },
    { title: 'Photo', link: 'https://www.instagram.com/p/DdzsAfDS8GO/' },
  ];
  const net = fakeNet((url) => (url === 'https://google.serper.dev/news' ? { status: 200, body: JSON.stringify({ news }) }
    : url.endsWith('/robots.txt') ? { status: 404, body: '' } : '<body><article><h1>Story</h1><p>September 29, 2026 text.</p></article></body>'));
  const c = fakeClock();
  const { signals } = await collectRoundup({ out: tmp(), now: NOW, env: { SERPER_API_KEY: 'k' }, fetcher: net.fetcher, watchList: [],
    sources: ids('rv2-serper-news'), clock: c.clock, sleep: c.sleep });
  const byUrl = Object.fromEntries(signals.map((s) => [s.url, s]));
  assert.ok(byUrl[news[0].link].groupId);
  assert.equal(byUrl[news[0].link].groupId, byUrl[news[1].link].groupId);
  assert.equal(byUrl[news[2].link].groupId, undefined);
  assert.ok(!net.calls.some((x) => x.url.includes('instagram.com')));
  assert.equal(signals.length, 3, 'one signal per page (deduplicated across queries)');
  assert.ok(signals.every((s) => s.records.length === 1 &&
    s.signalId === roundupSignalId('rv2-serper-news', s.url, s.records[0].recordId)));
});

// ---------------------------------------------------------------------------
// Instagram through the collector (A2-IG provider failure, ownership, leads)
// ---------------------------------------------------------------------------

const WATCH = [
  { handle: 'questxochocolate', business: 'QUEST XO Creative Lab', canonicalVenueId: 'addr:25-liberty-st', ownDomain: 'questxo.com', provider: 'apify' },
  { handle: 'burgerdrops', business: 'Burger Drops', canonicalVenueId: 'addr:116-atlantic-ave', ownDomain: 'burgerdrops.com', provider: 'apify' },
];
const IG215 = { handle: 'questxochocolate', ownerUsername: 'questxochocolate', shortcode: 'DdzvxJJJLy9', url: 'https://www.instagram.com/p/DdzvxJJJLy9/',
  timestamp: '2026-09-27T23:07:57.000Z', caption: 'Chocolate Painting: Open Studio\n\n📅 This Wednesday at 6:30pm\n📍 QUEST XO Chocolate Creative Lab | Liberty Village', images: [], type: 'Image' };
const TAGGED = { ...IG215, ownerUsername: 'someoneelse', shortcode: 'DdzsAfDS8GO', url: 'https://www.instagram.com/p/DdzsAfDS8GO/', timestamp: '2026-09-27T22:51:24.000Z' };
const UNDATED = { ...IG215, handle: 'burgerdrops', ownerUsername: 'burgerdrops', shortcode: 'Dd12rA_ScQQ', url: 'https://www.instagram.com/p/Dd12rA_ScQQ/', timestamp: '2026-09-28T18:49:36.000Z', caption: 'Swipe for details 👉' };

test('Instagram: owned dated posts become signals with the post; tagged rows dropped; undated posts are leads', async () => {
  const calls = [];
  const igProvider = { name: 'apify', listRecentPosts: async (args) => { calls.push(args); return { rows: [IG215, TAGGED, UNDATED], unavailable: [] }; } };
  const c = fakeClock();
  const { signals, census } = await collectRoundup({ out: tmp(), now: NOW, env: {}, fetcher: fakeNet({}).fetcher, igProvider, watchList: WATCH,
    sources: [], clock: c.clock, sleep: c.sleep });
  assert.deepEqual(calls, [{ handles: ['questxochocolate', 'burgerdrops'], newerThan: '2026-09-07', limit: 20 }], 'window start (Mon Sep 28) − 21 days');
  assert.equal(signals.length, 1);
  const [s] = signals;
  assert.equal(s.sourceId, 'ig:questxochocolate');
  assert.equal(s.url, IG215.url);
  assert.deepEqual([s.post.shortcode, s.post.ownerUsername, s.post.timestamp, s.post.caption], [IG215.shortcode, IG215.ownerUsername, IG215.timestamp, IG215.caption]);
  assert.equal(s.records[0].typed.date, '2026-09-30');
  assert.equal(census.instagram.dropped['not-owned'], 1);
  assert.deepEqual(census.leads, [{ sourceId: 'ig:burgerdrops', shortcode: 'Dd12rA_ScQQ', reason: 'no-caption-date' }]);
});

test('Instagram provider failure or missing token → unavailable; every other source is unchanged', async () => {
  const run = async (opts) => {
    const c = fakeClock();
    return collectRoundup({ out: tmp(), now: NOW, fetcher: fakeNet(baseRoutes).fetcher, watchList: WATCH,
      sources: ids('rv2-bmo-field', 'rv2-lv-bia-events'), clock: c.clock, sleep: c.sleep, ...opts });
  };
  const ok = await run({ env: {}, igProvider: { name: 'apify', listRecentPosts: async () => ({ rows: [IG215], unavailable: [] }) } });
  const threw = await run({ env: {}, igProvider: { name: 'apify', listRecentPosts: async () => { throw Object.assign(new Error('boom'), { code: 'timeout' }); } } });
  const noToken = await run({ env: {} });
  assert.equal(ok.census.instagram.status, 'ok');
  for (const r of [threw, noToken]) {
    assert.equal(r.census.instagram.status, 'unavailable');
    assert.deepEqual(r.signals.map((s) => s.signalId), ok.signals.filter((s) => !s.sourceId.startsWith('ig:')).map((s) => s.signalId));
  }
  assert.equal(threw.census.instagram.reason, 'timeout');
  assert.equal(noToken.census.instagram.reason, 'missing-token');
});
