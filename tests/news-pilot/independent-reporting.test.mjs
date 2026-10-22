import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEvidencePack } from '../../scripts/news-pilot/draft-evidence.mjs';
import { evaluateEvidenceGate } from '../../scripts/news-pilot/draft-gate.mjs';
import { evaluateSourceQuality } from '../../scripts/news-pilot/publish-gate.mjs';

const title = 'Liberty Village road closure on Atlantic Avenue begins October 23';
const original = 'Atlantic Avenue will close for maintenance on October 23. Our reporter spoke directly with the city project team about the schedule. The work takes place near Liberty Street in Liberty Village. The maintenance crew described how access to the shops would continue while workers complete the scheduled repairs.';
const independent = 'A visit to the neighbourhood found crews preparing barriers for upcoming utility repairs. Officials answered questions about deliveries to nearby businesses. Starting October 23, traffic on Atlantic Avenue is being redirected. Residents we interviewed described alternative walking routes and plans for access along the local commercial block.';
const member = (url) => ({ id: url, title, publishedAt: '2026-10-22T10:00:00Z', url, canonicalUrl: url, urlUsable: true, sourceTier: 'lead', snippet: 'Maintenance update for the neighbourhood.', score: { total: 0.6, riskFlags: [] } });
async function packFor(rows) {
  const members = rows.map(([url]) => member(url));
  return buildEvidencePack({ representative: members[0], members, clusterId: 'independence', nowMs: Date.parse('2026-10-22T12:00:00Z'), fetchFn: async (url) => ({ ok: true, status: 200, rawText: rows.find(([u]) => u === url)[1] }) });
}

test('D2: identical and near-duplicate scraper bodies never provide independent corroboration', async () => {
  for (const copy of [original, `${original} More details will follow later.`]) {
    const pack = await packFor([['https://origin.example/story', `<article>${original}</article>`], ['https://copy.example/story', `<article>${copy}</article>`]]);
    assert.equal(pack.independentPublisherCount, 1);
    assert.equal(evaluateEvidenceGate(pack).ok, false);
    assert.equal(evaluateSourceQuality(pack).ok, false);
  }
});

test('D2: aggregators, syndication attribution and shared canonical origin stay blocked', async () => {
  for (const [url, html] of [
    ['https://www.msn.com/story', `<article>${independent}</article>`],
    ['https://news.yahoo.com/story', `<article>${independent}</article>`],
    ['https://local.origin.example/story', `<article>${independent}</article>`],
    ['https://copy.example/story', `<article>Originally published by Origin News. ${independent}</article>`],
    ['https://copy.example/story', `<link rel="canonical" href="https://origin.example/story"><article>${independent}</article>`],
  ]) {
    const pack = await packFor([['https://origin.example/story', `<article>${original}</article>`], [url, html]]);
    assert.equal(pack.independentPublisherCount, 1, url);
    assert.equal(evaluateEvidenceGate(pack).ok, false, url);
    assert.equal(evaluateSourceQuality(pack).ok, false, url);
  }
});

test('D2: distinct reporting passes, forged publisher counts do not, and an official primary can stand alone', async () => {
  const pack = await packFor([['https://origin.example/story', `<article>${original}</article>`], ['https://independent.example/report', `<article>${independent}</article>`]]);
  assert.equal(evaluateEvidenceGate(pack).ok, true); assert.equal(evaluateSourceQuality(pack).ok, true);
  const solo = { ...pack, sources: [pack.sources[0]], independentPublisherCount: 99 };
  assert.equal(evaluateEvidenceGate(solo).ok, false); assert.equal(evaluateSourceQuality(solo).ok, false);
  const official = { ...solo, sources: [{ ...solo.sources[0], sourceTier: 'official' }] };
  assert.equal(evaluateEvidenceGate(official).ok, true); assert.equal(evaluateSourceQuality(official).ok, true);
});
