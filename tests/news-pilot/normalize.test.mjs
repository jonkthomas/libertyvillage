import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canonicalUrl,
  isGoogleGotoUrl,
  makeCandidate,
  normalizeSourceResult,
  parseRssItems,
  parseToIsoDate,
  publisherDomain,
  resolveArticleUrl,
  SNIPPET_MAX,
  stripTrackingParams,
  truncateSnippet,
} from '../../scripts/news-pilot/normalize.mjs';

test('tracking params are stripped from urls', () => {
  const raw =
    'https://www.Example.com/path/article?id=1&utm_source=rss&utm_medium=feed&fbclid=abc#section';
  assert.equal(
    stripTrackingParams(raw),
    'https://www.example.com/path/article?id=1',
  );
  assert.equal(canonicalUrl(raw), 'https://example.com/path/article?id=1');
  assert.equal(stripTrackingParams(raw).includes('utm_'), false);
  assert.equal(stripTrackingParams(raw).includes('fbclid'), false);
});

test('snippets are truncated and do not retain long third-party text', () => {
  const long = 'word '.repeat(200).trim();
  const snip = truncateSnippet(long);
  assert.ok(snip.length <= SNIPPET_MAX);
  assert.ok(snip.endsWith('…'));
  assert.ok(!snip.includes(long));
});

test('RSS parser extracts CBC-style items with attributes on item tag', () => {
  const xml = `<?xml version="1.0"?>
  <rss><channel>
    <item cbc:type="story">
      <title><![CDATA[Liberty Village park consultation opens]]></title>
      <link>https://www.cbc.ca/news/lv-park?cmp=rss</link>
      <pubDate>Fri, 07 Aug 2026 12:00:00 EDT</pubDate>
      <description><![CDATA[<p>Residents invited to a <b>consultation</b> about a park near East Liberty.</p>]]></description>
      <guid>guid-1</guid>
    </item>
  </channel></rss>`;
  const items = parseRssItems(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Liberty Village park consultation opens');
  assert.match(items[0].link, /cbc\.ca/);
  assert.equal(items[0].description.includes('<'), false);
  assert.match(items[0].description, /consultation/i);
});

test('malformed payload does not throw and yields no candidates', () => {
  const source = { id: 'x', tier: 'lead', type: 'rss' };
  assert.doesNotThrow(() => {
    const a = normalizeSourceResult(source, null);
    const b = normalizeSourceResult(source, { ok: true, data: { kind: 'rss', xml: null } });
    const c = normalizeSourceResult(source, { ok: true, data: { kind: 'serper', news: 'nope' } });
    const d = normalizeSourceResult(
      { id: 's', tier: 'lead', type: 'serpapi' },
      { ok: true, data: { kind: 'serpapi', news_results: null } },
    );
    const e = normalizeSourceResult(source, { ok: false, error: 'boom' });
    assert.deepEqual(a, []);
    assert.deepEqual(b, []);
    assert.deepEqual(c, []);
    assert.deepEqual(d, []);
    assert.deepEqual(e, []);
  });
});

test('makeCandidate strips tracking and truncates snippet', () => {
  const c = makeCandidate({
    sourceId: 'serper-q',
    sourceTier: 'lead',
    title: '  Hello Liberty  ',
    url: 'https://www.cp24.com/story?utm_campaign=x&id=9',
    publishedAt: '3 hours ago',
    snippet: 'y '.repeat(400),
    rawTextSample: 'raw',
    nowMs: Date.parse('2026-08-07T18:00:00.000Z'),
  });
  assert.ok(c);
  assert.equal(c.title, 'Hello Liberty');
  assert.equal(c.url.includes('utm_'), false);
  assert.equal(c.canonicalUrl.includes('utm_'), false);
  assert.ok(c.snippet.length <= SNIPPET_MAX);
  assert.ok(c.publishedAt);
  assert.match(c.publishedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(c.dateConfidence, 'approximate');
  // Approximate dates are day-granularity (UTC midnight), not ms-precise now-deltas.
  assert.match(c.publishedAt, /T00:00:00\.000Z$/);
  assert.equal(c.urlUsable, true);
});

test('relative dates are approximate; RSS-style absolute dates are exact', () => {
  const nowMs = Date.parse('2026-08-07T18:30:45.123Z');
  const rel = parseToIsoDate('1 month ago', { nowMs });
  assert.equal(rel.confidence, 'approximate');
  assert.equal(rel.iso, '2026-07-08T00:00:00.000Z');

  const abs = parseToIsoDate('Fri, 07 Aug 2026 12:00:00 EDT', { nowMs });
  assert.equal(abs.confidence, 'exact');
  assert.ok(abs.iso);

  const missing = parseToIsoDate(null);
  assert.equal(missing.confidence, 'unknown');
  assert.equal(missing.iso, null);
});

test('google.com/goto redirect URLs are marked unusable', () => {
  const goto =
    'https://www.google.com/goto?url=CAESrAEB7keqTdcGqPRBhNEkKz9QRcGehvP4P4hfsSPzb1uPdAO5FzWd0jp8ZYzOg5I5RT6UqkFdWrkuUV7wAYScZDsiwnZMJ6SpL2zrJ_wVCo-HDFTfNmfm-PT9zdl3iT7NLsNaaV6a9ChqDSAG_7OwVXu_hruFzzjsQxMNH-ZM7PUCdU0QpsRESiC75pbx3Y66TlGf6uDKyop6YXDLCiZ18PToh5nW5wRnfb6P5HGh';
  assert.equal(isGoogleGotoUrl(goto), true);
  const resolved = resolveArticleUrl(goto);
  assert.equal(resolved.urlUsable, false);
  assert.equal(publisherDomain(goto), '');

  const c = makeCandidate({
    sourceId: 'serper-q',
    sourceTier: 'lead',
    title: 'Carpet Factory tower',
    url: goto,
    publishedAt: '3 weeks ago',
    snippet: 'A tower above the Carpet Factory.',
  });
  assert.equal(c.urlUsable, false);
  assert.equal(c.publisherDomain, '');
});

test('normalize serper payload maps news items and flags goto urls', () => {
  const source = { id: 'serper-q-liberty-village', tier: 'lead', type: 'serper' };
  const out = normalizeSourceResult(source, {
    ok: true,
    data: {
      kind: 'serper',
      news: [
        {
          title: 'Around the 6ix - Liberty Village',
          link: 'https://www.cp24.com/video/x?utm_source=google',
          date: '3 hours ago',
          snippet: 'Host visits must-see places.',
          source: 'CP24',
        },
        {
          title: 'Ontario Line tunnelling',
          link: 'https://www.google.com/goto?url=CAESABC',
          date: '2 weeks ago',
          snippet: 'Tunnelling from Liberty Village.',
          source: 'UrbanToronto',
        },
      ],
    },
  });
  assert.equal(out.length, 2);
  assert.equal(out[0].sourceId, 'serper-q-liberty-village');
  assert.equal(out[0].url.includes('utm_'), false);
  assert.equal(out[0].urlUsable, true);
  assert.match(out[0].title, /Liberty Village/);
  assert.equal(out[1].urlUsable, false);
  assert.equal(out[1].dateConfidence, 'approximate');
});

test('publisherDomain strips www and common subdomains', () => {
  assert.equal(publisherDomain('https://www.cbc.ca/news/a'), 'cbc.ca');
  assert.equal(publisherDomain('https://news.cbc.ca/a'), 'cbc.ca');
  assert.equal(publisherDomain('https://torontolife.com/city/x'), 'torontolife.com');
  assert.equal(publisherDomain('https://www.google.com/goto?url=CAES'), '');
});
