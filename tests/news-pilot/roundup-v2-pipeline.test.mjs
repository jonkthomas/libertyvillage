import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateRoundupForm, reasonRoundupSignals } from '../../scripts/news-pilot/roundup-reason.mjs';
import { checkRoundupDraft } from '../../scripts/news-pilot/roundup-write.mjs';
import { parseRoundupV2Args, runRoundupV2 } from '../../scripts/news-pilot/roundup-v2-run.mjs';

const signal = { signalId: 's1', sourceId: 'rv2-bmo-field', url: 'https://www.bmofield.com/events',
  records: [{ recordId: 'r1', text: 'Toronto FC on October 3, 2026 at BMO Field, Toronto.' }] };
const form = { signalId: 's1', recordId: 'r1', subject: 'Toronto FC', what: 'A match.', where_it_happens: 'BMO Field',
  when: { kind: 'event', date: '2026-10-03', endDate: null, startTime: null, endTime: null },
  who_is_affected: 'Fans', relevance_reason: 'Venue event', verdict: 'adjacent',
  evidence: [{ url: signal.url, recordId: 'r1', subject_quote: 'Toronto FC', place_quote: 'BMO Field', date_quote: 'October 3, 2026' }],
  item_type: 'sports', people: [], risk: { crime: false, election: false, private_individual: false,
    development_application: false, civic_controversy: false }, exclude_reason: null };

test('reasoner validates exact signal and record, and treats JSON parse wrapper correctly', async () => {
  assert.equal(validateRoundupForm(form, signal), true);
  assert.equal(validateRoundupForm({ ...form, recordId: 'other' }, signal), false);
  const result = await reasonRoundupSignals([signal], { resolved: { ok: true, provider: { id: 'mock' } },
    callModel: async () => ({ ok: true, text: JSON.stringify({ forms: [form] }) }) });
  assert.deepEqual(result.forms, [form]);
});

test('six-call model budget preserves IG even after a large road feed', async () => {
  const large = Array.from({ length: 70 }, (_, index) => ({ ...signal, signalId: `road-${index}`, sourceId: 'rv2-road-restrictions' }));
  large.push(...Array.from({ length: 20 }, (_, index) => ({ ...signal, signalId: `bmo-${index}`, sourceId: 'rv2-bmo-field' })));
  large.push({ ...signal, signalId: 'bia-last', sourceId: 'rv2-lv-bia-events' });
  large.push({ ...signal, signalId: 'ig-last', sourceId: 'ig:libertyvillagebia' });
  const offered = [];
  const result = await reasonRoundupSignals(large, { resolved: { ok: true, provider: { id: 'mock' } },
    callModel: async ({ userText }) => { offered.push(...JSON.parse(userText).map((s) => s.signalId));
      return { ok: true, text: '{"forms":[]}' }; } });
  assert.ok(offered.includes('ig-last'));
  assert.ok(offered.includes('bia-last'), 'one listing source must not starve other official sources');
  assert.equal(offered.length, 60);
  assert.equal(result.excluded.filter((e) => e.reason === 'reason-budget').length, 32);
});

test('writer post-check refuses unsupported impact and in/near mismatch', () => {
  const unit = { identityKey: 'occ:test', verdict: 'adjacent' };
  assert.deepEqual(checkRoundupDraft({ intro: 'Near Liberty Village.', units: [
    { unitId: 'occ:test', heading: 'Match', body: 'In Liberty Village, traffic congestion is expected on Oct 3.' },
  ] }, [unit]).sort(), ['unsupported-impact', 'wrong-place']);
});

test('direct pipeline hold is read-only and has no DB URL requirement', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rv2-dry-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'data'));
  const posts = '[{"slug":"existing"}]\n';
  fs.writeFileSync(path.join(root, 'data', 'posts.json'), posts);
  const args = { run: root, out: path.join(root, 'out'), root, now: '2026-09-29T15:00:00Z', dryRun: true };
  const { result } = await runRoundupV2(args, {
    signals: [signal], reasoned: { forms: [form], excluded: [] },
    verify: async () => ({ items: [], excluded: [{ signalId: 's1', reason: 'undated' }], verifyDigest: 'a'.repeat(64) }),
    plan: () => ({ decision: 'hold', units: 0, coreUnits: 0, coreAnchorUnits: 0, reasons: ['below-minimum'], countedItems: [] }),
  });
  assert.equal(result.pipeline, 'structured-v2');
  assert.equal(result.published, false);
  assert.equal(result.decision, 'hold');
  assert.equal(fs.readFileSync(path.join(root, 'data', 'posts.json'), 'utf8'), posts);
});

test('publish candidate passes real pre-attempt content policy without mutating posts in dry-run', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rv2-policy-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'data'));
  fs.mkdirSync(path.join(root, 'public/images/og'), { recursive: true });
  fs.writeFileSync(path.join(root, 'public/images/og/og-home.jpg'), 'fixture image');
  const before = '[]\n';
  fs.writeFileSync(path.join(root, 'data/posts.json'), before);
  const units = [
    { identityKey: 'occ:addr:75-fraser-ave:2026-10-03:15:00', verdict: 'core', itemType: 'sports', date: '2026-10-03', subject: 'Lamport match' },
    { identityKey: 'occ:addr:170-princes-blvd:2026-10-04:15:00', verdict: 'adjacent', itemType: 'event', date: '2026-10-04', subject: 'BMO event' },
    { identityKey: 'occ:addr:171-east-liberty-st#113:2026-10-02:17:00', verdict: 'core', itemType: 'class', date: '2026-10-02', subject: 'NRG class' },
  ].map((unit, i) => ({ ...unit, keys: [unit.identityKey], citations: [
    { url: `https://source.example/${i}`, publisher: 'Official source', recordId: `r${i}`, sourceId: `s${i}` }],
    evidence: [{ url: `https://source.example/${i}`, recordId: `r${i}`, subject_quote: unit.subject,
      place_quote: unit.subject, date_quote: unit.date }] }));
  const draft = { intro: 'Three local plans for the week.', units: units.map((unit, i) => ({ unitId: unit.identityKey,
    heading: unit.subject, body: `${i === 1 ? 'Near' : 'In'} Liberty Village: ${unit.subject} on ${unit.date}.` })) };
  const { result, post } = await runRoundupV2({ run: root, out: path.join(root, 'out'), root,
    now: '2026-09-29T15:00:00Z', dryRun: true }, {
    signals: [], reasoned: { forms: [] },
    verify: async () => ({ items: units, excluded: [], verifyDigest: 'a'.repeat(64) }),
    plan: () => ({ decision: 'publish', countedItems: units, stillInEffect: [], units: 3, coreUnits: 2, coreAnchorUnits: 1, reasons: [] }),
    write: async () => ({ draft, findings: [], refused: [], units }),
  });
  assert.equal(result.decision, 'publish', result.census.writerError);
  assert.equal(result.published, false);
  assert.equal(post.roundupCoverage.keys.length, 3);
  assert.equal(fs.readFileSync(path.join(root, 'data/posts.json'), 'utf8'), before);
});

test('CLI requires one phase and rejects runner-style dry-run during collection', () => {
  assert.throws(() => parseRoundupV2Args(['--out', '/tmp/out']), /requires/);
  assert.throws(() => parseRoundupV2Args(['--collect', '--out', '/tmp/out', '--dry-run']), /collect does not publish/);
});
