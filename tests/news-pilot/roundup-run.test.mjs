import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runRoundup, temporalWindow, parseRoundupArgs } from '../../scripts/news-pilot/roundup-run.mjs';
import { roundupPackDigest } from '../../scripts/news-pilot/roundup-evidence.mjs';
import { checkRoundupRecord } from '../../scripts/content/submit.mjs';

const NOW = '2026-09-30T12:00:00.000Z';
const DATE = '2026-09-29T10:00:00Z';
const body = (id) => `Liberty Village Community Association announced the ${id} event at Hanna Avenue in Liberty Village. Residents can attend the ${id} event at the local community space. Organizers shared the event details with local residents and published a schedule for visitors. The ${id} event is open to neighbours this week.`;
const html = (id, date = DATE, changed = false) => `<html><head>${date ? `<meta property="article:published_time" content="${date}">` : ''}<meta property="og:site_name" content="Local Publisher"></head><body><article><h1>Liberty Village ${id} event</h1><p>${body(id)}${changed ? ' The venue changed.' : ''}</p></article></body></html>`;
const candidate = (id, overrides = {}) => ({
  id, clusterId: id, title: `Liberty Village ${id} event`,
  snippet: `${id} event in Liberty Village`, canonicalUrl: `https://example.org/${id}`,
  sourceTier: 'official', publisherDomain: 'example.org', urlUsable: true,
  fingerprint: `event-${id}`, category: 'community', isClusterRepresentative: true,
  ...overrides,
});

function fixture(candidates, posts = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'roundup-writer-'));
  const run = path.join(root, 'run');
  const out = path.join(root, 'out');
  fs.mkdirSync(run);
  fs.mkdirSync(path.join(root, 'data'));
  fs.mkdirSync(path.join(root, 'public', 'images', 'og'), { recursive: true });
  fs.writeFileSync(path.join(root, 'public', 'images', 'og', 'og-home.jpg'), 'neutral');
  fs.writeFileSync(path.join(root, 'data', 'posts.json'), `${JSON.stringify(posts, null, 2)}\n`);
  fs.writeFileSync(path.join(run, 'candidates.json'), JSON.stringify({ candidates }));
  return { root, run, out, postsFile: path.join(root, 'data', 'posts.json') };
}

async function execute(f, pages = {}, extra = {}) {
  const seen = new Map();
  const fetch = async (url) => {
    const count = (seen.get(url) || 0) + 1;
    seen.set(url, count);
    const supplied = pages[url];
    const value = typeof supplied === 'function' ? supplied(count) : supplied;
    return { ok: true, status: 200, rawText: value || html(new URL(url).pathname.slice(1)), contentType: 'text/html' };
  };
  const args = { run: f.run, out: f.out, root: f.root, now: NOW, ...extra.args };
  const output = await runRoundup(args, { fetch, model: () => { throw new Error('model must not supply evidence'); }, ...extra.deps });
  return { ...output, seen, diskResult: JSON.parse(fs.readFileSync(path.join(f.out, 'result.json'))),
    diskPack: JSON.parse(fs.readFileSync(path.join(f.out, 'pack.json'))) };
}

test('CLI parses the documented arguments', () => {
  const args = parseRoundupArgs(['--run=a', '--out=b', '--root=c', '--now=' + NOW, '--dry-run', '--vault=/dev/null', '--image=/images/og/og-home.jpg']);
  assert.deepEqual([args.run, args.out, args.root, args.now, args.dryRun, args.vault, args.image],
    ['a', 'b', 'c', NOW, true, '/dev/null', '/images/og/og-home.jpg']);
});

test('two verified items append one news roundup with submit-compatible evidence', async () => {
  const f = fixture([candidate('alpha'), candidate('beta')]);
  const { diskResult, diskPack, seen } = await execute(f);
  assert.equal(diskResult.decision, 'roundup');
  assert.equal(diskResult.published, 1);
  assert.equal(diskResult.slug, 'liberty-village-news-week-2026-w40');
  assert.equal(diskResult.packDigest, roundupPackDigest(diskPack));
  assert.equal(diskPack.items.length, 2);
  assert.equal(seen.get('https://example.org/alpha'), 2);
  const posts = JSON.parse(fs.readFileSync(f.postsFile));
  assert.equal(posts.length, 1);
  assert.equal(posts[0].slug, diskResult.slug);
  assert.equal(posts[0].category, 'news');
  assert.match(posts[0].title, /news roundup/);
  assert.deepEqual(checkRoundupRecord({ item: { key: diskResult.slug }, record: posts[0],
    ctx: { isoWeek: diskResult.isoWeek, weekStartUtc: '2026-09-28T00:00:00.000Z', now: diskResult.now, items: diskPack.items },
    live: { posts: [] }, news: { root: f.root, imageExists: () => true } }), []);
});

test('one eligible item appends an honestly labelled weekly update', async () => {
  const f = fixture([candidate('alpha')]);
  const { diskResult } = await execute(f);
  const post = JSON.parse(fs.readFileSync(f.postsFile))[0];
  assert.equal(diskResult.decision, 'single-update');
  assert.equal(diskResult.published, 1);
  assert.match(post.title, /weekly update/);
  assert.doesNotMatch(post.title, /roundup/);
});

test('zero eligible items hold without a miss alert or post, and submit rejects the empty pack', async () => {
  const f = fixture([candidate('undated')]);
  const before = fs.readFileSync(f.postsFile);
  const { diskResult, diskPack } = await execute(f, { 'https://example.org/undated': html('undated', null) });
  assert.equal(diskResult.decision, 'hold');
  assert.equal(diskResult.published, 0);
  assert.equal(diskResult.hold.reason, 'zero-eligible-now');
  assert.equal(diskResult.census.byReason.undated, 1);
  assert.equal(Object.hasOwn(diskResult, 'alert'), false);
  assert.doesNotMatch(fs.readFileSync(path.join(f.out, 'result.json'), 'utf8'), /WEEKLY_NEWS_MISSED/);
  assert.deepEqual(diskPack, { items: [] });
  assert.deepEqual(fs.readFileSync(f.postsFile), before);
  const errors = checkRoundupRecord({ item: { key: diskResult.slug }, record: { slug: diskResult.slug, category: 'news', content: '' },
    ctx: { isoWeek: diskResult.isoWeek, weekStartUtc: '2026-09-28T00:00:00.000Z', now: diskResult.now, items: [] },
    live: { posts: [] }, news: { root: f.root, imageExists: () => true } });
  assert.ok(errors.includes('roundup pack has no accepted items'));
});

test('writer accepts a future planner hold decision without forwarding an alert', async () => {
  const f = fixture([]);
  const { diskResult } = await execute(f, {}, { deps: { planRoundup: () => ({
    decision: 'hold', items: [], census: {}, alert: { kind: 'WEEKLY_NEWS_MISSED' },
  }) } });
  assert.equal(diskResult.decision, 'hold');
  assert.equal(Object.hasOwn(diskResult, 'alert'), false);
  assert.equal(diskResult.published, 0);
});

test('stale, risky, changed, existing URL and daily news duplicates are counted and excluded', async () => {
  const f = fixture([
    candidate('stale'), candidate('risky', { category: 'crime' }), candidate('changed'),
    candidate('live'), candidate('daily'),
  ], [
    { slug: 'old-story', category: 'blog', content: '[Story](https://example.org/live)' },
    { slug: 'daily-story', category: 'news', content: '[Story](https://example.org/daily)' },
  ]);
  const before = fs.readFileSync(f.postsFile);
  const pages = {
    'https://example.org/stale': html('stale', '2025-01-02T10:00:00Z'),
    'https://example.org/changed': (count) => html('changed', DATE, count > 1),
  };
  const { diskResult, diskPack } = await execute(f, pages);
  assert.equal(diskResult.decision, 'hold');
  assert.deepEqual(diskPack.items, []);
  assert.equal(diskResult.census.byReason.stale, 1);
  assert.equal(diskResult.census.byReason.risky, 1);
  assert.equal(diskResult.census.byReason['source-changed-rebuild'], 1);
  assert.equal(diskResult.census.byReason.duplicate, 2);
  assert.deepEqual(fs.readFileSync(f.postsFile), before);
});

test('candidate-claimed date cannot substitute for a fetched publication instant', async () => {
  const f = fixture([candidate('claimed', { publishedAt: DATE, dateConfidence: 'exact' })]);
  const { diskResult } = await execute(f, { 'https://example.org/claimed': html('claimed', null) });
  assert.equal(diskResult.census.byReason.undated, 1);
  assert.equal(diskResult.published, 0);
});

test('existing roundup slug and dry run leave posts byte-identical', async () => {
  const slug = 'liberty-village-news-week-2026-w40';
  const f = fixture([candidate('alpha')], [{ slug, category: 'news', content: 'old roundup' }]);
  const before = fs.readFileSync(f.postsFile);
  const output = await execute(f);
  assert.equal(output.diskResult.published, 0);
  assert.equal(output.diskResult.hold.reason, 'slug-exists');
  assert.deepEqual(fs.readFileSync(f.postsFile), before);
  const dry = fixture([candidate('alpha')]);
  const dryBefore = fs.readFileSync(dry.postsFile);
  const dryOutput = await execute(dry, {}, { args: { dryRun: true } });
  assert.equal(dryOutput.diskResult.published, 0);
  assert.equal(dryOutput.diskResult.hold.reason, 'dry-run');
  assert.deepEqual(fs.readFileSync(dry.postsFile), dryBefore);
});

test('append failure after mutation rolls back posts bytes', async () => {
  const f = fixture([candidate('alpha')]);
  const before = fs.readFileSync(f.postsFile);
  await assert.rejects(execute(f, {}, { deps: { appendPostToPostsJson: (root, post) => {
    fs.writeFileSync(path.join(root, 'data', 'posts.json'), `${JSON.stringify([post], null, 2)}\n`);
    throw new Error('injected-after-write');
  } } }), /injected-after-write/);
  assert.deepEqual(fs.readFileSync(f.postsFile), before);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.out, 'result.json'))).published, 0);
});

describe('temporal policy (pending spec addendum)', () => {
  test('current default accepts only verified announcements inside the UTC ISO week', () => {
    const nowMs = Date.parse(NOW);
    assert.equal(temporalWindow({ nowMs, item: { announcedAt: DATE, announcedAtVerified: true } }), null);
    assert.equal(temporalWindow({ nowMs, item: { announcedAt: '2026-09-27T23:59:59Z', announcedAtVerified: true } }), 'stale');
    assert.equal(temporalWindow({ nowMs, item: { announcedAt: DATE, announcedAtVerified: false } }), 'undated');
  });
});
