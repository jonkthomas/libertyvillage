import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  checkIgTimestamp, createIgProvider, filterOwnedPosts, IG_LIMITS, IgProviderError, normalizeApifyPost, shortcodeCreatedMs,
} from '../../scripts/news-pilot/ig-provider.mjs';
import { packInstagramShortcodes, parseIgRefetchArgs, runIgRefetch } from '../../scripts/news-pilot/ig-refetch.mjs';

const TOKEN = 'apify_api_TESTTOKEN';

function jsonResponse(status, value) {
  return { status, json: async () => value };
}

function fakeApify(items, status = 201) {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init, input: JSON.parse(init.body) });
    if (items instanceof Error) throw items;
    return jsonResponse(status, typeof items === 'function' ? items(JSON.parse(init.body)) : items);
  };
  return { fetcher, calls };
}

const item = (over = {}) => ({
  shortCode: 'DdzvxJJJLy9', ownerUsername: 'questxochocolate', timestamp: '2026-09-27T23:07:57.000Z', caption: 'This Wednesday at 6:30pm',
  type: 'Image', displayUrl: 'https://cdn.example/x.jpg', alt: 'Photo by QUEST XO on September 27, 2026.', childPosts: [],
  inputUrl: 'https://www.instagram.com/questxochocolate/', ...over,
});

// ---------------------------------------------------------------------------
// Shortcode timestamp band (§4.4)
// ---------------------------------------------------------------------------

test('shortcode decodes to the upload time; trial IG214 lags its encoded time by ~20 min', () => {
  const encoded = shortcodeCreatedMs('DdzsAfDS8GO');
  const lagMin = (Date.parse('2026-09-27T22:51:24.000Z') - encoded) / 60000;
  assert.ok(lagMin > 20 && lagMin < 21, `lag ${lagMin}`);
  assert.equal(shortcodeCreatedMs('bad!'), null);
  assert.equal(shortcodeCreatedMs('DdzsAfDS8GOabcdefghijklmnop'), encoded, 'private-post suffix ignored');
});

test('timestamp band: +20 min and +50 h pass; −3 min and +4 days are unverifiable', () => {
  const code = 'DdzsAfDS8GO';
  const at = (ms) => new Date(shortcodeCreatedMs(code) + ms).toISOString();
  assert.equal(checkIgTimestamp(code, at(20 * 60000)).ok, true);
  assert.equal(checkIgTimestamp(code, at(50 * 3600000)).ok, true);
  assert.equal(checkIgTimestamp(code, at(-3 * 60000)).ok, false);
  assert.equal(checkIgTimestamp(code, at(4 * 86400000)).ok, false);
  assert.equal(checkIgTimestamp(code, 'not a date').ok, false);
});

// ---------------------------------------------------------------------------
// Apify adapter
// ---------------------------------------------------------------------------

test('apify listRecentPosts: public profile URLs only, token in a header (never the URL), caps passed to the platform', async () => {
  const net = fakeApify([item(), { inputUrl: 'https://www.instagram.com/leftfieldbrewery/', username: 'leftfieldbrewery', error: 'Restricted profile', isRestrictedProfile: true }]);
  const provider = createIgProvider({ provider: 'apify', token: TOKEN, fetcher: net.fetcher });
  const res = await provider.listRecentPosts({ handles: ['questxochocolate', 'leftfieldbrewery'], newerThan: '2026-09-07', limit: 20 });
  assert.equal(net.calls.length, 1);
  const [call] = net.calls;
  assert.ok(call.url.startsWith('https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items?'));
  assert.ok(!call.url.includes(TOKEN), 'token never in the URL');
  assert.equal(call.init.headers.Authorization, `Bearer ${TOKEN}`);
  const params = new URL(call.url).searchParams;
  assert.equal(params.get('maxItems'), '40');
  assert.equal(params.get('maxTotalChargeUsd'), '1');
  assert.deepEqual(call.input, { directUrls: ['https://www.instagram.com/questxochocolate/', 'https://www.instagram.com/leftfieldbrewery/'],
    resultsType: 'posts', resultsLimit: 20, onlyPostsNewerThan: '2026-09-07', addParentData: false });
  assert.ok(!('cookies' in call.input) && !('loginCookies' in call.input) && !JSON.stringify(call.input).includes('session'));
  assert.equal(res.rows.length, 1);
  assert.deepEqual(Object.keys(res.rows[0]).sort(), ['caption', 'handle', 'images', 'isPinned', 'ownerUsername', 'shortcode', 'timestamp', 'type', 'url']);
  assert.equal(res.rows[0].handle, 'questxochocolate');
  assert.deepEqual(res.unavailable, [{ handle: 'leftfieldbrewery', reason: 'private' }]);
});

test('apify budget caps are enforced before any call: 34 handles × 20 results, US$1', async () => {
  const net = fakeApify([item()]);
  const provider = createIgProvider({ token: TOKEN, fetcher: net.fetcher });
  const handles = Array.from({ length: IG_LIMITS.maxHandles + 1 }, (_, i) => `acct${i}`);
  await assert.rejects(provider.listRecentPosts({ handles, newerThan: '2026-09-07' }), (e) => e.code === 'budget');
  await assert.rejects(provider.listRecentPosts({ handles: ['a'], newerThan: '2026-09-07', limit: 21 }), (e) => e.code === 'budget');
  const rich = createIgProvider({ token: TOKEN, fetcher: net.fetcher, budgetUsd: 5 });
  await assert.rejects(rich.listRecentPosts({ handles: ['a'], newerThan: '2026-09-07' }), (e) => e.code === 'budget');
  assert.equal(net.calls.length, 0);
});

test('apify failures are IgProviderError: missing token, HTTP error, timeout/network, malformed and empty responses', async () => {
  const args = { handles: ['questxochocolate'], newerThan: '2026-09-07' };
  const cases = [
    [createIgProvider({ token: '', fetcher: fakeApify([item()]).fetcher }), 'missing-token'],
    [createIgProvider({ token: TOKEN, fetcher: fakeApify([], 500).fetcher }), 'http'],
    [createIgProvider({ token: TOKEN, fetcher: fakeApify(Object.assign(new Error('x'), { name: 'AbortError' })).fetcher }), 'timeout'],
    [createIgProvider({ token: TOKEN, fetcher: fakeApify({ not: 'array' }).fetcher }), 'malformed'],
    [createIgProvider({ token: TOKEN, fetcher: fakeApify([]).fetcher }), 'empty'],
    [createIgProvider({ provider: 'meta' }), 'not-configured'],
  ];
  for (const [provider, code] of cases) {
    await assert.rejects(provider.listRecentPosts(args), (e) => e instanceof IgProviderError && e.code === code, code);
  }
});

test('apify getPosts returns exactly the requested shortcodes with ok / missing / private status', async () => {
  const net = fakeApify([
    item(),
    { inputUrl: 'https://www.instagram.com/p/DcqiKakmwQF/', error: 'Restricted profile', isRestrictedProfile: true },
    { inputUrl: 'https://www.instagram.com/p/Dd12rA_ScQQ/', error: 'not_found', errorDescription: 'Post does not exist' },
  ]);
  const provider = createIgProvider({ token: TOKEN, fetcher: net.fetcher });
  const rows = await provider.getPosts(['DdzvxJJJLy9', 'DcqiKakmwQF', 'Dd12rA_ScQQ']);
  assert.deepEqual(rows.map((r) => [r.shortcode, r.status]), [['DdzvxJJJLy9', 'ok'], ['DcqiKakmwQF', 'private'], ['Dd12rA_ScQQ', 'missing']]);
  assert.equal(rows[0].caption, 'This Wednesday at 6:30pm');
  assert.deepEqual(net.calls[0].input.directUrls, ['https://www.instagram.com/p/DdzvxJJJLy9/', 'https://www.instagram.com/p/DcqiKakmwQF/', 'https://www.instagram.com/p/Dd12rA_ScQQ/']);
});

test('owned filter: owner must equal the watch handle; old/pinned and out-of-band rows dropped', () => {
  const rows = [
    normalizeApifyPost(item(), 'questxochocolate'),
    normalizeApifyPost(item({ ownerUsername: 'motzburger' }), 'questxochocolate'),
    normalizeApifyPost(item({ shortCode: 'DcqiKakmwQF', timestamp: '2026-08-30T12:40:21.000Z', isPinned: true }), 'questxochocolate'),
    normalizeApifyPost(item({ timestamp: '2026-10-05T12:00:00.000Z' }), 'questxochocolate'),
  ];
  const { kept, dropped } = filterOwnedPosts(rows, { handles: ['questxochocolate'], newerThanMs: Date.parse('2026-09-07T00:00:00Z') });
  assert.deepEqual(kept.map((r) => r.shortcode), ['DdzvxJJJLy9']);
  assert.deepEqual(dropped, { 'not-owned': 1, 'too-old': 1, 'timestamp-band': 1 });
});

// ---------------------------------------------------------------------------
// ig-refetch.mjs (N1 source-only submit helper)
// ---------------------------------------------------------------------------

const PACK = { signals: [
  { sourceId: 'ig:questxochocolate', post: { shortcode: 'DdzvxJJJLy9' } },
  { sourceId: 'ig:burgerdrops', post: { shortcode: 'DdzsAfDS8GO' } },
  { sourceId: 'ig:burgerdrops', post: { shortcode: 'DdzsAfDS8GO' } },
  { sourceId: 'rv2-bmo-field', post: { shortcode: 'NOTINSTAGRAM' } },
] };

test('ig-refetch writes exactly the pack shortcodes with status and fetchedAt, mode 0600', async () => {
  assert.deepEqual(packInstagramShortcodes(PACK), ['DdzsAfDS8GO', 'DdzvxJJJLy9']);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-refetch-'));
  fs.writeFileSync(path.join(dir, 'pack.json'), JSON.stringify(PACK));
  let asked = null;
  const igProvider = { name: 'apify', getPosts: async (codes) => {
    asked = codes;
    return [{ shortcode: 'DdzvxJJJLy9', ownerUsername: 'questxochocolate', timestamp: '2026-09-27T23:07:57.000Z', caption: 'c', status: 'ok' },
      { shortcode: 'DdzsAfDS8GO', ownerUsername: null, timestamp: null, caption: null, status: 'private' }];
  } };
  const out = path.join(dir, 'ig-refetch.json');
  await runIgRefetch({ pack: path.join(dir, 'pack.json'), out }, { igProvider, clock: () => Date.parse('2026-10-01T12:00:00Z') });
  assert.deepEqual(asked, ['DdzsAfDS8GO', 'DdzvxJJJLy9']);
  assert.equal(fs.statSync(out).mode & 0o777, 0o600);
  const file = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(file.fetchedAt, '2026-10-01T12:00:00.000Z');
  assert.equal(file.provider, 'apify');
  assert.deepEqual(file.rows.map((r) => [r.shortcode, r.status]), [['DdzsAfDS8GO', 'private'], ['DdzvxJJJLy9', 'ok']]);
  assert.deepEqual(Object.keys(file.rows[1]).sort(), ['caption', 'ownerUsername', 'shortcode', 'status', 'timestamp']);
});

test('ig-refetch: a row the provider omits is `missing`; a provider failure writes no file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-refetch-'));
  fs.writeFileSync(path.join(dir, 'pack.json'), JSON.stringify(PACK));
  const out = path.join(dir, 'ig-refetch.json');
  await runIgRefetch({ pack: path.join(dir, 'pack.json'), out }, { igProvider: { name: 'apify', getPosts: async () => [] } });
  assert.deepEqual(JSON.parse(fs.readFileSync(out, 'utf8')).rows.map((r) => r.status), ['missing', 'missing']);
  const out2 = path.join(dir, 'ig-refetch-2.json');
  await assert.rejects(runIgRefetch({ pack: path.join(dir, 'pack.json'), out: out2 }, { env: {} }), (e) => e.code === 'missing-token');
  assert.equal(fs.existsSync(out2), false);
  assert.throws(() => parseIgRefetchArgs(['--pack', 'p.json']), /--pack and --out/);
});
