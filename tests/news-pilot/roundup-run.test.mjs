import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runRoundup, temporalWindow, parseRoundupArgs, contextParagraph } from '../../scripts/news-pilot/roundup-run.mjs';
import { roundupPackDigest } from '../../scripts/news-pilot/roundup-evidence.mjs';
import { checkRoundupRecord } from '../../scripts/content/submit.mjs';
import { appendPostToPostsJson } from '../../scripts/news-pilot/publish.mjs';

const NOW = '2026-09-30T12:00:00.000Z';
const DATE = '2026-09-29T10:00:00Z';
const body = (id, date) => `Liberty Village Community Association reported the ${id} event at Hanna Avenue in Liberty Village. Residents can find the ${id} event details at the local community space. Organizers shared a schedule for local visitors.${date ? ` This update is dated ${date.slice(0, 10)}.` : ''} The ${id} event is open to neighbours.${date ? '' : ' The article does not state a publication date.'}`;
const html = (id, date = DATE, changed = false) => `<html><head>${date ? `<meta property="article:published_time" content="${date}">` : ''}<meta property="og:site_name" content="Local Publisher"></head><body><article><h1>Liberty Village ${id} event</h1><p>${body(id, date)}${changed ? ' The venue changed.' : ''}</p></article></body></html>`;
const eventTimeText = (start) => {
  if (!start.includes('T')) return '';
  if (/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?$/.test(start)) {
    const hour = Number(start.slice(11, 13));
    return ` at ${hour % 12 || 12}:${start.slice(14, 16)} ${hour < 12 ? 'AM' : 'PM'}`;
  }
  return ' at ' + new Intl.DateTimeFormat('en-US', { timeZone: 'America/Toronto', hour: 'numeric',
    minute: '2-digit', hour12: true }).format(Date.parse(start));
};
const eventHtml = (id, { announced = '2026-09-09T10:00:00Z', start = '2026-10-14T11:00:00Z',
  end = null, venue = 'Liberty Village community space', name = `Liberty Village ${id} event`, passage = true, showTime = true } = {}) =>
  `<html><head>${announced ? `<meta property="article:published_time" content="${announced}">` : ''}` +
  `<script type="application/ld+json">${JSON.stringify({ '@type': 'Event', name, location: { name: venue },
    startDate: start, ...(end ? { endDate: end } : {}) })}</script></head><body><article><h1>${name}</h1>` +
  `<p>Liberty Village Community Association scheduled the ${id} event at ${venue}. ` +
  `Residents can find details for the ${id} event in Liberty Village. ` +
  `${passage ? `The event is scheduled for ${start.slice(0, 10)}${showTime ? eventTimeText(start) : ''} at ${venue}.` : 'The page does not state an event date.'} ` +
  `${announced ? `The page was published ${announced.slice(0, 10)}.` : ''}</p></article></body></html>`;
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
  for (const item of diskPack.items) {
    assert.equal(item.announcedAtVerified, true);
    const own = item.sources.find((source) => source.canonicalUrl === item.announcedAtSourceUrl);
    assert.ok(own?.excerpt.includes(item.announcedAtSpan));
    assert.equal(Object.hasOwn(item, 'temporalCategory'), false);
    assert.ok(item.claims[0].span.endsWith('.'));
    assert.ok(item.claims[0].span.length <= 320);
    assert.ok(item.claims[0].text.includes(`"${item.claims[0].span}"`));
  }
  assert.equal(seen.get('https://example.org/alpha'), 2);
  const posts = JSON.parse(fs.readFileSync(f.postsFile));
  assert.equal(posts.length, 1);
  assert.equal(posts[0].slug, diskResult.slug);
  assert.equal(posts[0].category, 'news');
  assert.match(posts[0].title, /news roundup/);
  assert.match(posts[0].content, /Local Publisher published this update on September 29, 2026\. It concerns Liberty Village Community Association in Liberty Village\./);
  assert.doesNotMatch(posts[0].content, /newly announced|this week/i);
  const policy = (record) => checkRoundupRecord({ item: { key: diskResult.slug }, record,
    ctx: { isoWeek: diskResult.isoWeek, weekStartUtc: '2026-09-28T00:00:00.000Z', now: diskResult.now, items: diskPack.items },
    live: { posts: [] }, news: { root: f.root, imageExists: () => true } });
  assert.deepEqual(policy(posts[0]), []);
  const concealedDate = { ...posts[0], content: posts[0].content.replaceAll('September 29, 2026', 'recently').replaceAll('2026-09-29', 'recently') };
  assert.ok(policy(concealedDate).includes('roundup item actual date missing'));
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

test('metadata without a literal date passage is held; sidebar time does not prove publication', async () => {
  const f = fixture([candidate('claimed')]);
  const noPassage = `<html><head><meta property="article:published_time" content="${DATE}"></head>` +
    `<body><article><p>${body('claimed', null)}</p></article></body></html>`;
  const { diskResult, diskPack } = await execute(f, { 'https://example.org/claimed': noPassage });
  assert.equal(diskResult.census.byReason.undated, 1);
  assert.deepEqual(diskPack.items, []);
  const sidebar = fixture([candidate('claimed')]);
  const sidebarHtml = `<html><body><aside><time datetime="${DATE}">2026-09-29</time></aside>` +
    `<article><p>${body('claimed', DATE)}</p></article></body></html>`;
  const second = await execute(sidebar, { 'https://example.org/claimed': sidebarHtml });
  assert.equal(second.diskResult.census.byReason.undated, 1);
});

test('yearless and mismatched publication passages are held despite metadata', async () => {
  for (const passage of ['This update is dated Sept 29.', 'This update is dated 2026-09-28.']) {
    const f = fixture([candidate('mismatch')]);
    const page = `<html><head><meta property="article:published_time" content="${DATE}"></head>` +
      `<body><article><p>Liberty Village Community Association reported an event at Hanna Avenue in Liberty Village. ` +
      `Residents can read details from the association. Organizers shared a full schedule with local visitors at the community space. ${passage}</p></article></body></html>`;
    const { diskResult, diskPack } = await execute(f, { 'https://example.org/mismatch': page });
    assert.equal(diskResult.census.byReason.undated, 1);
    assert.deepEqual(diskPack.items, []);
  }
});

test('published=1 is written only after the append returns', async () => {
  const f = fixture([candidate('alpha')]);
  let pending;
  const { diskResult } = await execute(f, {}, { deps: { appendPostToPostsJson: (root, post) => {
    pending = JSON.parse(fs.readFileSync(path.join(f.out, 'result.json')));
    return appendPostToPostsJson(root, post);
  } } });
  assert.equal(pending.published, 0);
  assert.equal(pending.hold.reason, 'pending-append');
  assert.equal(diskResult.published, 1);
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

test('failure writing the final published result rolls back the appended post', async () => {
  const f = fixture([candidate('alpha')]);
  const before = fs.readFileSync(f.postsFile);
  let resultWrites = 0;
  const io = Object.create(fs);
  io.writeFileSync = (file, value, encoding) => {
    if (file === path.join(f.out, 'result.json') && ++resultWrites === 2) throw new Error('injected-result-write');
    return fs.writeFileSync(file, value, encoding);
  };
  await assert.rejects(execute(f, {}, { deps: { fs: io } }), /injected-result-write/);
  assert.deepEqual(fs.readFileSync(f.postsFile), before);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.out, 'result.json'))).published, 0);
});

test('source-swapped claim is rejected by the unchanged submit policy', async () => {
  const f = fixture([candidate('alpha')]);
  const { diskResult, diskPack } = await execute(f);
  const post = JSON.parse(fs.readFileSync(f.postsFile))[0];
  const altered = { ...diskPack.items[0], claims: [{ ...diskPack.items[0].claims[0], sourceUrl: 'https://elsewhere.example/story' }] };
  const errors = checkRoundupRecord({ item: { key: diskResult.slug }, record: post,
    ctx: { isoWeek: diskResult.isoWeek, weekStartUtc: '2026-09-28T00:00:00.000Z', now: diskResult.now, items: [altered] },
    live: { posts: [] }, news: { root: f.root, imageExists: () => true } });
  assert.ok(errors.includes('roundup pack has no accepted items'));
});

describe('approved rolling and upcoming temporal policy', () => {
  test('news at 6d23h passes and 7d+1s fails; news wins over a distant future event', () => {
    const nowMs = Date.parse(NOW);
    const news = { announcedAtVerified: true, announcedAtSpan: 'September 23, 2026 at 9:00 a.m.', eventStartVerified: true,
      eventStart: new Date(nowMs + 20 * 86_400_000).toISOString() };
    assert.equal(temporalWindow({ nowMs, item: { ...news,
      announcedAt: new Date(nowMs - (6 * 24 + 23) * 3_600_000).toISOString() } }).category, 'news-update');
    assert.equal(temporalWindow({ nowMs, item: { ...news,
      announcedAt: new Date(nowMs - 7 * 86_400_000 - 1_000).toISOString() } }).reason, 'stale');
    assert.equal(temporalWindow({ nowMs, item: { announcedAt: DATE, announcedAtVerified: false } }).reason, 'undated');
  });

  test('upcoming event bounds are strict, and an already started or ended event fails', () => {
    const nowMs = Date.parse(NOW);
    const old = { announcedAt: new Date(nowMs - 21 * 86_400_000).toISOString(), announcedAtVerified: true,
      eventStartVerified: true };
    assert.equal(temporalWindow({ nowMs, item: { ...old,
      eventStart: new Date(nowMs + (13 * 24 + 23) * 3_600_000).toISOString() } }).category, 'upcoming-event');
    assert.equal(temporalWindow({ nowMs, item: { ...old,
      eventStart: new Date(nowMs + 14 * 86_400_000).toISOString() } }).reason, 'stale');
    assert.equal(temporalWindow({ nowMs, item: { ...old, eventStart: NOW } }).reason, 'concluded');
    assert.equal(temporalWindow({ nowMs, item: { ...old, eventStart: '2026-10-02T23:00:00.000Z',
      eventEnd: '2026-09-29T00:00:00.000Z' } }).reason, 'concluded');
  });

  test('date-only today is excluded, future whole Toronto date qualifies, and local timed start converts', () => {
    const nowMs = Date.parse(NOW);
    assert.equal(temporalWindow({ nowMs, item: { eventStartDate: '2026-09-30', eventStartVerified: true } }).reason, 'concluded');
    assert.deepEqual(temporalWindow({ nowMs, item: { eventStartDate: '2026-10-02', eventStartVerified: true } }), {
      category: 'upcoming-event', reason: null,
      evidence: { eventStartDate: '2026-10-02', timezone: 'America/Toronto' },
    });
  });

  test('writer publishes prior-week news within the rolling seven-day window', async () => {
    const f = fixture([candidate('prior')]);
    const prior = '2026-09-27T10:00:00Z';
    const { diskResult, diskPack } = await execute(f, { 'https://example.org/prior': html('prior', prior) });
    assert.equal(diskResult.decision, 'single-update');
    assert.equal(diskResult.published, 1);
    assert.equal(diskResult.hold, undefined);
    assert.equal(diskResult.census.temporalCategories['news-update'], 1);
    assert.equal(diskPack.items.length, 1);
    assert.equal(diskPack.items[0].announcedAt, '2026-09-27T10:00:00.000Z');
    assert.equal(JSON.parse(fs.readFileSync(f.postsFile)).length, 1);
  });

  test('old announcement with verified +13d23h event publishes a weekly update', async () => {
    const f = fixture([candidate('future', { eventStart: '2026-10-14T11:00:00Z' })]);
    const { diskResult, diskPack } = await execute(f, { 'https://example.org/future': eventHtml('future') });
    assert.equal(diskResult.decision, 'single-update');
    assert.equal(diskResult.published, 1);
    assert.equal(diskResult.hold, undefined);
    assert.equal(diskResult.census.temporalCategories['upcoming-event'], 1);
    assert.equal(diskPack.items.length, 1);
    const item = diskPack.items[0];
    assert.equal(item.eventStartVerified, true);
    assert.equal(item.eventStart, '2026-10-14T11:00:00.000Z');
    assert.ok(item.sources.find((source) => source.canonicalUrl === item.eventStartSourceUrl).excerpt.includes(item.eventStartSpan));
    assert.equal(Object.hasOwn(item, 'temporalCategory'), false);
    const paragraph = contextParagraph(item, 'upcoming-event');
    assert.match(paragraph, /According to example\.org, it is scheduled for October 14, 2026 at 7:00 a\.m\. EDT at Liberty Village community space\./);
    assert.doesNotMatch(paragraph, /https?:|newly announced|this week/i);
    assert.equal(JSON.parse(fs.readFileSync(f.postsFile)).length, 1);
  });

  test('claims use Toronto dates across UTC midnight, and conflicting claim dates fail submit policy', async () => {
    const event = fixture([candidate('night-event', { eventStart: '2026-10-08T20:30:00-04:00' })]);
    const timed = await execute(event, { 'https://example.org/night-event': eventHtml('night-event', {
      announced: null, start: '2026-10-08T20:30:00-04:00',
    }) });
    assert.equal(timed.diskResult.published, 1);
    assert.match(timed.diskPack.items[0].claims[0].text, /lists the event for 2026-10-08:/);
    assert.doesNotMatch(timed.diskPack.items[0].claims[0].text, /for 2026-10-09/);
    const news = fixture([candidate('night-news')]);
    const published = await execute(news, { 'https://example.org/night-news': html('night-news', '2026-09-28T22:30:00-04:00') });
    assert.equal(published.diskResult.published, 1);
    const original = published.diskPack.items[0];
    assert.match(original.claims[0].text, /published this update on 2026-09-28:/);
    const badClaim = { ...original.claims[0], text: original.claims[0].text.replace('on 2026-09-28:', 'on 2026-09-29:') };
    const post = JSON.parse(fs.readFileSync(news.postsFile))[0];
    const errors = checkRoundupRecord({ item: { key: published.diskResult.slug },
      record: { ...post, content: post.content.replace(original.claims[0].text, badClaim.text) },
      ctx: { isoWeek: published.diskResult.isoWeek, weekStartUtc: '2026-09-28T00:00:00.000Z',
        now: published.diskResult.now, items: [{ ...original, claims: [badClaim] }] },
      live: { posts: [] }, news: { root: news.root, imageExists: () => true } });
    assert.ok(errors.includes('roundup claim date conflicts with verified Toronto date'));
  });

  test('one valid item publishes even when another metadata time cannot prove its old date', async () => {
    const f = fixture([candidate('alpha'), candidate('beta')]);
    const { diskResult, diskPack } = await execute(f, { 'https://example.org/alpha': html('alpha'),
      'https://example.org/beta': html('beta', '2026-09-23T20:00:00-04:00') });
    assert.equal(diskResult.decision, 'single-update');
    assert.equal(diskResult.published, 1);
    assert.equal(diskPack.items.length, 1);
    assert.equal(diskPack.items[0].title, 'Liberty Village alpha event');
    assert.equal(diskResult.census.byReason.stale, 1);
  });

  test('timestamp metadata cannot invent a time absent from the verified event passage', async () => {
    const f = fixture([candidate('dateonly', { eventStart: '2026-10-02T19:30:00Z' })]);
    const { diskPack, diskResult } = await execute(f, { 'https://example.org/dateonly': eventHtml('dateonly', {
      announced: null, start: '2026-10-02T19:30:00Z', showTime: false,
    }) });
    assert.equal(diskPack.items[0].eventStartDate, '2026-10-02');
    assert.equal(Object.hasOwn(diskPack.items[0], 'eventStart'), false);
    assert.equal(diskResult.published, 1);
    const nearCutoff = fixture([candidate('nearcutoff', { eventStart: '2026-10-14T11:00:00Z' })]);
    const result = await execute(nearCutoff, { 'https://example.org/nearcutoff': eventHtml('nearcutoff', { showTime: false }) });
    assert.equal(result.diskResult.decision, 'hold');
    assert.equal(result.diskResult.published, 0);
  });

  test('event at +14d is excluded; date-only future and Toronto local timed starts are parsed without guessing hours', async () => {
    const cutoff = fixture([candidate('cutoff', { eventStart: '2026-10-14T12:00:00Z' })]);
    const rejected = await execute(cutoff, { 'https://example.org/cutoff': eventHtml('cutoff', { start: '2026-10-14T12:00:00Z' }) });
    assert.equal(rejected.diskResult.census.byReason.stale, 1);
    const dated = fixture([candidate('dated', { eventStartDate: '2026-10-02' })]);
    const accepted = await execute(dated, { 'https://example.org/dated': eventHtml('dated', { announced: null, start: '2026-10-02' }) });
    assert.equal(accepted.diskPack.items[0].eventStartDate, '2026-10-02');
    assert.equal(Object.hasOwn(accepted.diskPack.items[0], 'eventStart'), false);
    assert.equal(accepted.diskResult.decision, 'single-update');
    assert.equal(accepted.diskResult.published, 1);
    const timed = fixture([candidate('timed', { eventStart: '2026-10-02T19:30:00' })]);
    const timedOutput = await execute(timed, { 'https://example.org/timed': eventHtml('timed', { announced: null, start: '2026-10-02T19:30:00' }) });
    assert.equal(timedOutput.diskPack.items[0].eventStart, '2026-10-02T23:30:00.000Z');
    assert.equal(timedOutput.diskResult.published, 1);
  });

  test('recent news is selected before upcoming-event even when its event is more than 14 days away', async () => {
    const f = fixture([candidate('distant', { eventStart: '2026-10-20T10:00:00Z' })]);
    const { diskResult, diskPack } = await execute(f, { 'https://example.org/distant': eventHtml('distant', {
      announced: DATE, start: '2026-10-20T10:00:00Z',
    }) });
    assert.equal(diskResult.decision, 'single-update');
    assert.equal(diskResult.published, 1);
    assert.equal(diskResult.census.temporalCategories['news-update'], 1);
    assert.equal(diskPack.items[0].eventStartVerified, true);
    const post = JSON.parse(fs.readFileSync(f.postsFile))[0];
    assert.match(post.content, /published this update on September 29, 2026/);
    assert.doesNotMatch(post.content, /upcoming|newly announced/i);
  });

  test('unrelated listing Event and city-wide venue cannot prove an LV start', async () => {
    const f = fixture([candidate('local', { eventStart: '2026-10-02T19:30:00Z' })]);
    const page = eventHtml('local', { name: 'Unrelated Toronto event', venue: 'Toronto City Hall', start: '2026-10-02T19:30:00Z' });
    const { diskResult, diskPack } = await execute(f, { 'https://example.org/local': page });
    assert.equal(diskResult.census.byReason['invalid-event'], 1);
    assert.deepEqual(diskPack.items, []);
  });

  test('prior-week item is excluded when an existing post cites its own URL', async () => {
    const prior = '2026-09-27T10:00:00Z';
    const f = fixture([candidate('prior')], [{ slug: 'earlier-coverage', category: 'news',
      content: '[Earlier story](https://example.org/prior)' }]);
    const { diskResult, diskPack } = await execute(f, { 'https://example.org/prior': html('prior', prior) });
    assert.equal(diskResult.census.byReason.duplicate, 1);
    assert.deepEqual(diskPack.items, []);
  });

  test('election and crime are refused even with verified upcoming dates', async () => {
    const f = fixture([candidate('election', { category: 'election', eventStart: '2026-10-02T19:30:00Z' }),
      candidate('crime', { category: 'crime', eventStart: '2026-10-02T19:30:00Z' })]);
    const pages = { 'https://example.org/election': eventHtml('election', { start: '2026-10-02T19:30:00Z' }),
      'https://example.org/crime': eventHtml('crime', { start: '2026-10-02T19:30:00Z' }) };
    const { diskResult, diskPack } = await execute(f, pages);
    assert.equal(diskResult.census.byReason.risky, 2);
    assert.deepEqual(diskPack.items, []);
  });

  test('current-week event adds verified local context and passes submit policy', async () => {
    const f = fixture([candidate('near', { eventStart: '2026-10-02T19:30:00' })]);
    const { diskResult, diskPack } = await execute(f, { 'https://example.org/near': eventHtml('near', {
      announced: DATE, start: '2026-10-02T19:30:00',
    }) });
    assert.equal(diskResult.decision, 'single-update');
    assert.equal(diskResult.published, 1);
    const item = diskPack.items[0];
    assert.equal(item.eventStartVerified, true);
    assert.equal(item.eventStart, '2026-10-02T23:30:00.000Z');
    assert.ok(item.sources.find((source) => source.canonicalUrl === item.eventStartSourceUrl).excerpt.includes(item.eventStartSpan));
    const post = JSON.parse(fs.readFileSync(f.postsFile))[0];
    assert.match(post.content, /published this update on September 29, 2026/);
    assert.match(post.content, /It concerns Liberty Village Community Association in Liberty Village community space/);
    assert.doesNotMatch(post.content, /newly announced|this week/i);
    assert.deepEqual(checkRoundupRecord({ item: { key: diskResult.slug }, record: post,
      ctx: { isoWeek: diskResult.isoWeek, weekStartUtc: '2026-09-28T00:00:00.000Z', now: diskResult.now, items: diskPack.items },
      live: { posts: [] }, news: { root: f.root, imageExists: () => true } }), []);
  });
});
