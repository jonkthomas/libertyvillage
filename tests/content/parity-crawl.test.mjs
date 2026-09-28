import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ALL } from '../../scripts/content/canonical.mjs';
import { compare, crawl } from '../../scripts/content/parity-crawl.mjs';

test('parity crawl records and reports meta, JSON-LD, href and sitemap loc changes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-crawl-'));
  let changed = false;
  fs.mkdirSync(path.join(root, 'data'));
  for (const dataset of ALL) {
    const value = dataset === 'guide-hub' ? {} : dataset === 'topic-queue' ? { version: 1, topics: [] }
      : dataset === 'discovery-seen' ? {} : [];
    fs.writeFileSync(path.join(root, 'data', `${dataset}.json`), JSON.stringify(value));
  }
  const server = http.createServer((request, response) => {
    if (request.url === '/sitemap.xml') {
      response.setHeader('content-type', 'application/xml');
      response.end(`<urlset><url><loc>https://libertyvillage.co/${changed ? 'changed' : 'original'}</loc><lastmod>2026-09-${changed ? '29' : '28'}</lastmod></url></urlset>`);
      return;
    }
    response.setHeader('content-type', 'text/html');
    response.end(`<html><head><title>Same title</title><meta name="description" content="${changed ? 'changed' : 'original'}"><meta property="og:title" content="Same title"><link rel="canonical" href="https://libertyvillage.co/guide"><script type="application/ld+json">{"name":"${changed ? 'changed' : 'original'}"}</script></head><body><main>Same text</main><a href="/${changed ? 'changed' : 'original'}">Read</a></body></html>`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const before = await crawl({ base, root });
    changed = true;
    const after = await crawl({ base, root });
    assert.deepEqual(before.pages['/guide'].metaLinks.some((item) => item.includes('description')), true);
    assert.equal(before.pages['/guide'].jsonLd.length, 1);
    assert.deepEqual(before.pages['/guide'].hrefs, ['/original']);
    assert.deepEqual(before.sitemap.locs, ['https://libertyvillage.co/original']);
    const result = compare(before, after);
    assert.equal(result.match, false);
    assert.deepEqual(new Set(result.diffs.map((diff) => diff.class)), new Set(['metaLinks', 'jsonLd', 'hrefs', 'sitemap']));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
