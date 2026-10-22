import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildEvidencePack } from '../../scripts/news-pilot/draft-evidence.mjs';
import { evaluateEvidenceGate } from '../../scripts/news-pilot/draft-gate.mjs';
import { evaluateSourceQuality } from '../../scripts/news-pilot/publish-gate.mjs';
import { findCorroboratingMembers, runPublish } from '../../scripts/news-pilot/publish.mjs';

const title = 'Liberty Village road closure on Atlantic Avenue begins October 23';
const original = 'Atlantic Avenue will close for maintenance on October 23. Our reporter spoke directly with the city project team about the schedule. The work takes place near Liberty Street in Liberty Village. The maintenance crew described how access to the shops would continue while workers complete the scheduled repairs.';
const independent = 'A visit to the neighbourhood found crews preparing barriers for upcoming utility repairs. Officials answered questions about deliveries to nearby businesses. Starting October 23, traffic on Atlantic Avenue is being redirected. Residents we interviewed described alternative walking routes and plans for access along the local commercial block.';
const member = (url) => ({ id: url, title, publishedAt: '2026-10-22T10:00:00Z', url, canonicalUrl: url, urlUsable: true, sourceTier: 'lead', snippet: 'Maintenance update for the neighbourhood.', score: { total: 0.6, riskFlags: [] } });
async function packFor(rows) {
  const members = rows.map(([url]) => member(url));
  return buildEvidencePack({ representative: members[0], members, clusterId: 'independence', nowMs: Date.parse('2026-10-22T12:00:00Z'), fetchFn: async (url) => ({ ok: true, status: 200, rawText: rows.find(([u]) => u === url)[1] }) });
}

async function searchPublish(t, url, { snippet = independent, body = independent } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-d2-search-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'data'));
  fs.writeFileSync(path.join(root, 'data/posts.json'), '[]');
  const candidate = { ...member('https://origin.example/story'), clusterId: 'D2', isClusterRepresentative: true };
  fs.writeFileSync(path.join(root, 'candidates.json'), JSON.stringify({ candidates: [candidate] }));
  const fetchFn = async (fetchedUrl) => ({ ok: true, status: 200, rawText: `<article>${fetchedUrl === candidate.url ? original : body}</article>` });
  const solo = await buildEvidencePack({ representative: candidate, members: [candidate], clusterId: 'D2', nowMs: Date.parse('2026-10-22T12:00:00Z'), fetchFn });
  assert.equal(evaluateEvidenceGate(solo).code, 'single_lead_consequential');
  const result = await runPublish({ root, run: root, out: path.join(root, 'out'), now: '2026-10-22T12:00:00Z', dryRun: true, skipGenerate: true, vault: '/dev/null' }, {
    env: { SERPER_API_KEY: 'fixture' }, log: { log() {} }, fetchFn,
    findCorroboratingMembers: (lead, opts) => findCorroboratingMembers(lead, { ...opts, search: async () => ({ ok: true, data: { kind: 'serper', news: [{ title, link: url, date: '2026-10-22', snippet }] } }) }),
  });
  const pack = JSON.parse(fs.readFileSync(path.join(root, 'out/evidence-D2.json'), 'utf8'));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'data/posts.json'), 'utf8')), []);
  return { result, pack };
}

test('D2: search-found unattributed paraphrase cannot make a consequential story publishable', async (t) => {
  const { result, pack } = await searchPublish(t, 'https://rewrite.example/story');
  assert.equal(result.status, 'no_eligible_candidate');
  assert.equal(pack.independentPublisherCount, 1);
  assert.equal(evaluateEvidenceGate(pack).code, 'single_lead_consequential');
  assert.equal(evaluateSourceQuality(pack).ok, false);
});

test('D2: allowlisted newsroom corroboration of the same event remains eligible', async (t) => {
  const { result, pack } = await searchPublish(t, 'https://www.cbc.ca/news/toronto/atlantic');
  assert.equal(result.status, 'eligible_skip_generate');
  assert.equal(pack.independentPublisherCount, 2);
  assert.equal(evaluateEvidenceGate(pack).ok, true);
  assert.equal(evaluateSourceQuality(pack).ok, true);
  assert.equal(pack.sources[1].sourceTier, 'lead');
});

test('D2: registry-recognized official corroborators retain their search tier', async (t) => {
  const { result, pack } = await searchPublish(t, 'https://www.toronto.ca/news/atlantic');
  assert.equal(result.status, 'eligible_skip_generate');
  assert.equal(pack.independentPublisherCount, 2);
  assert.equal(pack.sources[1].sourceTier, 'lead');
});

test('D2: newsroom lookalike domains cannot supply search corroboration', async (t) => {
  const { result, pack } = await searchPublish(t, 'https://cbc.ca.rewrite.example/story');
  assert.equal(result.status, 'no_eligible_candidate');
  assert.equal(pack.independentPublisherCount, 1);
});

test('D2: allowlisted search results still require original substantive reporting', async (t) => {
  for (const body of [original, `Originally published by Origin News. ${independent}`, 'Atlantic Avenue update.']) {
    const { result, pack } = await searchPublish(t, 'https://www.cbc.ca/news/toronto/atlantic', { body });
    assert.equal(result.status, 'no_eligible_candidate');
    assert.equal(pack.independentPublisherCount, 1);
  }
});

test('D2: a similar headline about a different location cannot corroborate the event', async (t) => {
  const { result, pack } = await searchPublish(t, 'https://www.cbc.ca/news/toronto/king', { snippet: 'King Street road closure in Liberty Village begins October 23.', body: independent.replaceAll('Atlantic Avenue', 'King Street') });
  assert.equal(result.status, 'no_eligible_candidate');
  assert.equal(pack.independentPublisherCount, 1);
});

test('D2: an allowlisted headline alone cannot establish event identity', async (t) => {
  const { result, pack } = await searchPublish(t, 'https://www.cbc.ca/news/toronto/atlantic', { snippet: '' });
  assert.equal(result.status, 'no_eligible_candidate');
  assert.equal(pack.independentPublisherCount, 1);
});

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

test('D2 follow-up: UrbanToronto boilerplate is not article syndication', async () => {
  const html = `<article>${original} This service provided by this web site includes neighbourhood reporting.</article><footer>First published terms: service provided by this web site.</footer><script>const terms = 'content provided by a third party';</script>`;
  const pack = await packFor([['https://urbantoronto.ca/news/local', html], ['https://independent.example/report', `<article>${independent}</article>`]]);
  assert.equal(pack.sources[0].syndicated, false);
  assert.equal(pack.independentPublisherCount, 2);
  assert.equal(evaluateEvidenceGate(pack).ok, true);
  assert.equal(evaluateSourceQuality(pack).ok, true);
});

test('D2 follow-up: genuine story and content syndication attributions remain excluded', async () => {
  for (const attribution of ['Story provided by The Canadian Press.', 'Content provided by Reuters.', 'Originally published by Origin News.']) {
    const pack = await packFor([['https://origin.example/story', `<article>${original}</article>`], ['https://copy.example/report', `<article>${attribution} ${independent}</article>`]]);
    assert.equal(pack.sources[1].syndicated, true);
    assert.equal(pack.independentPublisherCount, 1);
    assert.equal(evaluateEvidenceGate(pack).ok, false);
    assert.equal(evaluateSourceQuality(pack).ok, false);
  }
});
