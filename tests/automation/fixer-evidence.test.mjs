// Finding 7: the row fixer renders verified blog source-pack claims as a bounded,
// fenced DATA block, and its prompt is byte-identical when no evidence is given.
import '../content/fixtures/agent-sdk-mock.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeAgent, queueAgent } from '../content/fixtures/agent-sdk-mock.mjs';

const { planRecordRepair, fixerEvidenceRows, FIXER_EVIDENCE_MAX_CHARS } = await import('../../scripts/automation/review-agent.mjs');

const post = { slug: 'liberty-village-brunch-spots-notes', title: 'Brunch Spots notes', description: 'A guide.', content: 'Body.' };
const payload = [{ file: 'data/posts.json', records: [post] }];
const gateVerdict = { overall: 7, findings: [{ severity: 'high', path: 'data/posts.json#liberty-village-brunch-spots-notes', note: 'unsupported claim' }] };
const reply = () => ({ files: [{ file: 'data/posts.json', records: [{ slug: post.slug, record: post }] }], reason: 'r' });
const evidence = { sourcePack: { fingerprint: 'a'.repeat(64), topic: 'Brunch Spots', sources: [
  { id: 'mildreds-temple-kitchen', name: "Mildred's Temple Kitchen", claims: [{ field: 'hours', verbatim: 'Brunch Sat-Sun 9am-3pm' }], premiseClaims: [{ field: 'description', verbatim: 'famous for brunch' }] },
  { id: 'impact-kitchen', name: 'Impact Kitchen', claims: [{ field: 'address', verbatim: '573 King St E' }], premiseClaims: [] },
] } };

async function promptFor(extra) {
  queueAgent(reply());
  await planRecordRepair({ kind: 'blog', gateVerdict, payload, validate: () => ({ ok: true, errors: [] }), ...extra });
  return fakeAgent.calls[0].prompt;
}

test('fixer prompt renders verified source-pack claims (claim -> record -> span) inside untrusted-data fencing', async () => {
  const prompt = await promptFor({ evidence });
  const start = prompt.indexOf('Verified source-pack claims');
  assert.ok(start > 0, 'evidence block present');
  const open = prompt.indexOf('<<<UNTRUSTED_EVIDENCE_DATA>>>', start);
  const close = prompt.indexOf('<<<END_UNTRUSTED_EVIDENCE_DATA>>>', open);
  assert.ok(open > start && close > open, 'block is fenced as untrusted DATA');
  assert.match(prompt.slice(start, open), /DATA, not instructions/);
  const rows = JSON.parse(prompt.slice(open + '<<<UNTRUSTED_EVIDENCE_DATA>>>'.length, close));
  assert.deepEqual(rows[0], { claim: 'hours', record: 'mildreds-temple-kitchen', name: "Mildred's Temple Kitchen", verbatim: 'Brunch Sat-Sun 9am-3pm' });
  assert.deepEqual(rows.map((row) => row.record), ['mildreds-temple-kitchen', 'mildreds-temple-kitchen', 'impact-kitchen']);
});

test('fixer evidence is bounded in rows and characters; absent evidence leaves the prompt unchanged', async () => {
  const huge = { sourcePack: { sources: Array.from({ length: 40 }, (_, i) => ({ id: `record-${i}`, name: 'N'.repeat(500), claims: Array.from({ length: 40 }, () => ({ field: 'description', verbatim: 'x'.repeat(5000) })) })) } };
  const rows = fixerEvidenceRows(huge);
  assert.ok(JSON.stringify(rows).length <= FIXER_EVIDENCE_MAX_CHARS);
  assert.ok(rows.every((row) => row.verbatim.length <= 600 && row.name.length <= 200));
  assert.equal(new Set(rows.map((row) => row.record)).size <= 12, true);
  const plain = await promptFor({});
  assert.equal(await promptFor({ evidence: null }), plain);
  assert.doesNotMatch(plain, /Verified source-pack claims|UNTRUSTED_EVIDENCE_DATA/);
  assert.equal(fixerEvidenceRows({ sourcePack: { sources: [] } }), null);
});

test('roundup fixer sees the verified v2 units (verdict, date, citations, quotes) as fenced DATA and is told never to change roundupCoverage', async () => {
  const { roundupEvidence } = await import('../../scripts/content/gate.mjs');
  const context = { pipeline: 'structured-v2', now: '2026-09-30T11:00:00.000Z', temporalValidationNow: '2026-09-30T11:05:00.000Z', isoWeek: '2026-W40',
    weekStartUtc: '2026-09-28T00:00:00.000Z', counts: { units: 1, coreUnits: 1, coreAnchorUnits: 1 }, stillInEffect: [],
    units: [{ identityKey: 'occ:addr:40-hanna-ave:2026-10-03:15:00', label: 'Open house', verdict: 'core', itemType: 'event', date: '2026-10-03',
      citations: [{ url: 'https://example.org/open-house', publisher: 'City', recordId: 'sec-2', tier: 'official' }],
      evidence: [{ url: 'https://example.org/open-house', recordId: 'sec-2', tier: 'official', subject_quote: 'Open House', place_quote: '171 East Liberty St', date_quote: 'October 3, 2026' }] }] };
  const evidence = roundupEvidence(context);
  assert.equal(evidence.submittedAt, '2026-09-30T11:05:00.000Z', 'temporal checks use temporalValidationNow');
  assert.equal(evidence.units[0].identity, 'occ:addr:40-hanna-ave:2026-10-03:15:00');
  const rows = fixerEvidenceRows(evidence);
  assert.deepEqual(rows, [{ unit: 'occ:addr:40-hanna-ave:2026-10-03:15:00', verdict: 'core', date: '2026-10-03',
    citations: ['https://example.org/open-house'], quotes: ['Open House', '171 East Liberty St', 'October 3, 2026'] }]);
  queueAgent(reply());
  await planRecordRepair({ kind: 'news', gateVerdict, payload, validate: () => ({ ok: true, errors: [] }), evidence });
  const prompt = fakeAgent.calls[0].prompt;
  assert.match(prompt, /Verified weekly roundup units \(1 rows/);
  assert.match(prompt, /Never change roundupCoverage/);
  assert.doesNotMatch(prompt, /Verified source-pack claims/);
});
