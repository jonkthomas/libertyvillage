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
