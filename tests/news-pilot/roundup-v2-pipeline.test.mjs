import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateRoundupForm, reasonRoundupSignals } from '../../scripts/news-pilot/roundup-reason.mjs';
import { checkRoundupDraft, writeRoundup } from '../../scripts/news-pilot/roundup-write.mjs';
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
  const result = await reasonRoundupSignals([signal], { now: '2026-09-30T01:20:00Z',
    resolved: { ok: true, provider: { id: 'mock' } },
    callModel: async ({ userText }) => {
      assert.equal(JSON.parse(userText).referenceDateToronto, '2026-09-29');
      return { ok: true, text: JSON.stringify({ forms: [form] }) };
    } });
  assert.deepEqual(result.forms, [form]);
});

test('reasoner narrows a paraphrased title only to a same-record verbatim quote', async () => {
  const modelForm = { ...form, subject: 'Open House – New Park at 34 Hanna Avenue',
    evidence: [{ ...form.evidence[0], subject_quote: 'Toronto FC' }] };
  const opts = { resolved: { ok: true, provider: { id: 'mock' } },
    callModel: async () => ({ ok: true, text: JSON.stringify({ forms: [modelForm] }) }) };
  const result = await reasonRoundupSignals([signal], opts);
  assert.equal(result.forms[0].subject, 'Toronto FC');
  const unanchored = { ...modelForm, evidence: [{ ...modelForm.evidence[0], subject_quote: 'No such title' }] };
  const bad = await reasonRoundupSignals([signal], { ...opts,
    callModel: async () => ({ ok: true, text: JSON.stringify({ forms: [unanchored] }) }) });
  assert.equal(bad.forms[0].subject, modelForm.subject, 'never replace a title with an uncaptured quote');
  const city = { ...signal, records: [{ recordId: 'r1', text:
    'Open House\nDate: October 3, 2026\nLocation: Liberty Market Building, 171 East Liberty St., Suite 232' }] };
  const cityForm = { ...modelForm, evidence: [{ ...modelForm.evidence[0], subject_quote: 'Open House',
    place_quote: 'Liberty Market Building, 171 East Liberty St., Suite 232' }] };
  const normalized = await reasonRoundupSignals([city], { ...opts,
    callModel: async () => ({ ok: true, text: JSON.stringify({ forms: [cityForm] }) }) });
  assert.equal(normalized.forms[0].subject, 'Open House');
  assert.equal(normalized.forms[0].evidence[0].place_quote,
    'Location: Liberty Market Building, 171 East Liberty St., Suite 232');
});

test('six-call model budget preserves IG even after a large road feed', async () => {
  const large = Array.from({ length: 70 }, (_, index) => ({ ...signal, signalId: `road-${index}`, sourceId: 'rv2-road-restrictions' }));
  large.push(...Array.from({ length: 20 }, (_, index) => ({ ...signal, signalId: `bmo-${index}`, sourceId: 'rv2-bmo-field' })));
  large.push({ ...signal, signalId: 'bia-last', sourceId: 'rv2-lv-bia-events' });
  large.push({ ...signal, signalId: 'ig-last', sourceId: 'ig:libertyvillagebia' });
  const offered = [];
  const result = await reasonRoundupSignals(large, { now: '2026-09-29T19:10:00Z',
    resolved: { ok: true, provider: { id: 'mock' } },
    callModel: async ({ userText }) => { offered.push(...JSON.parse(userText).signals.map((s) => s.signalId));
      return { ok: true, text: '{"forms":[]}' }; } });
  assert.ok(offered.includes('ig-last'));
  assert.ok(offered.includes('bia-last'), 'one listing source must not starve other official sources');
  assert.equal(offered.length, 30);
  assert.equal(result.excluded.filter((e) => e.reason === 'reason-budget').length, 62);
});

test('first-party core leads outrank adjacent/search leads under the hard model budget', async () => {
  const adjacent = Array.from({ length: 65 }, (_, i) => ({ ...signal, signalId: `adj-${i}`, sourceId: 'rv2-coliseum' }));
  const search = Array.from({ length: 30 }, (_, i) => ({ ...signal, signalId: `search-${i}`, sourceId: 'rv2-serper-news' }));
  const coreIg = { ...signal, signalId: 'ig-oct3-core', sourceId: 'ig:burgerdrops',
    post: { shortcode: 'DdzsAfDS8GO', timestamp: '2026-09-27T22:51:24Z' } };
  const city = { ...signal, signalId: 'city-oct3-core', sourceId: 'rv2-city-project-34-hanna-park' };
  const offered = [];
  const result = await reasonRoundupSignals([...adjacent, ...search, coreIg, city], {
    now: '2026-09-29T19:10:00Z', resolved: { ok: true, provider: { id: 'mock' } },
    callModel: async ({ userText }) => {
      offered.push(...JSON.parse(userText).signals.map((s) => s.signalId));
      return { ok: true, text: '{"forms":[]}' };
    },
  });
  assert.equal(offered.length, 30);
  assert.ok(offered.includes(coreIg.signalId));
  assert.ok(offered.includes(city.signalId));
  assert.ok(offered.some((id) => id.startsWith('adj-')));
  assert.ok(offered.some((id) => id.startsWith('search-')));
  assert.equal(result.excluded.filter((e) => e.reason === 'reason-budget').length, 67);
  assert.ok(result.excluded.filter((e) => e.reason === 'reason-budget').every((e) => e.priority.startsWith('other-')));
});

test('future-dated first-party core event outranks stale first-party posts when that tier overflows', async () => {
  const stale = Array.from({ length: 65 }, (_, i) => ({ ...signal, signalId: `stale-ig-${i}`,
    sourceId: 'ig:burgerdrops', post: { timestamp: '2026-09-09T12:00:00Z' },
    records: [{ recordId: 'r1', text: 'Yesterday: September 8, 2026' }] }));
  const upcoming = { ...signal, signalId: 'oct3-core-ig', sourceId: 'ig:burgerdrops',
    post: { timestamp: '2026-09-27T22:51:24Z' },
    records: [{ recordId: 'r1', kind: 'ig-event', text: 'October 3 at 116 Atlantic Ave', typed: { date: '2026-10-03' } }] };
  const offered = [];
  const result = await reasonRoundupSignals([...stale, upcoming, signal], {
    now: '2026-09-29T19:10:00Z', resolved: { ok: true, provider: { id: 'mock' } },
    callModel: async ({ userText }) => {
      offered.push(...JSON.parse(userText).signals.map((s) => s.signalId));
      return { ok: true, text: '{"forms":[]}' };
    },
  });
  assert.equal(offered[0], upcoming.signalId);
  assert.equal(offered.length, 30);
  assert.ok(offered.includes(signal.signalId), 'a current adjacent event outranks stale IG posts, not the current core event');
  assert.ok(result.excluded.some((e) => e.priority === 'first-party-core-lead-other' && e.signalId.startsWith('stale-ig-')));
});

test('reasoner retries one timed-out core batch within six calls; exhaustion is a technical failure, not a HOLD', async (t) => {
  const core = { ...signal, sourceId: 'ig:burgerdrops', post: { timestamp: '2026-09-27T22:51:24Z' } };
  const opts = { now: '2026-09-29T19:10:00Z', resolved: { ok: true, provider: { id: 'mock' } } };
  let calls = 0;
  const recovered = await reasonRoundupSignals([core], { ...opts, callModel: async ({ timeoutMs }) => {
    calls++;
    assert.equal(timeoutMs, 180_000);
    return calls === 1 ? { ok: false, error: 'timeout_after_180000ms' }
      : { ok: true, text: JSON.stringify({ forms: [form] }) };
  } });
  assert.equal(calls, 2);
  assert.equal(recovered.technicalFailure, false);
  assert.equal(recovered.modelCalls, 2);
  assert.equal(recovered.forms.length, 1);
  const failed = await reasonRoundupSignals([core], { ...opts,
    callModel: async () => { calls++; return { ok: false, error: 'timeout_after_180000ms' }; } });
  assert.equal(failed.technicalFailure, true);
  assert.equal(failed.modelCalls, 2);
  assert.equal(failed.excluded[0].reason, 'reason-failed');
  assert.equal(failed.excluded[0].modelFailure, 'timeout_after_180000ms');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rv2-technical-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'data'));
  fs.writeFileSync(path.join(root, 'data/posts.json'), '[]\n');
  const { result } = await runRoundupV2({ run: root, out: path.join(root, 'out'), root,
    now: opts.now, dryRun: true }, { signals: [core], reasoned: failed,
    verify: async () => ({ items: [], excluded: [], verifyDigest: 'a'.repeat(64) }),
    plan: () => ({ decision: 'hold', units: 0, coreUnits: 0, coreAnchorUnits: 0,
      reasons: ['below-minimum'], countedItems: [] }) });
  assert.equal(result.decision, 'technical-failure');
  assert.equal(result.technicalFailure, true);
  assert.ok(result.reasons.includes('reason-model-failed'));
  assert.ok(result.census.excluded.some((e) => e.reason === 'reason-failed'));
  assert.equal(result.published, false);
});

test('a timeout retry consumes one of six model attempts and defers unreasoned current core leads', async () => {
  const coreSignals = Array.from({ length: 30 }, (_, i) => ({ ...signal, signalId: `core-${i}`,
    sourceId: 'ig:burgerdrops', post: { timestamp: '2026-09-27T22:51:24Z' },
    records: [{ recordId: 'r1', text: 'October 3 at 116 Atlantic Ave', typed: { date: '2026-10-03' } }] }));
  let calls = 0;
  const result = await reasonRoundupSignals(coreSignals, { now: '2026-09-29T19:10:00Z',
    resolved: { ok: true, provider: { id: 'mock' } }, callModel: async ({ userText }) => {
      calls++;
      assert.ok(JSON.parse(userText).signals.length <= 5);
      return calls === 1 ? { ok: false, error: 'timeout_after_180000ms' }
        : { ok: true, text: '{"forms":[]}' };
    } });
  assert.equal(calls, 6);
  assert.equal(result.modelCalls, 6);
  assert.equal(result.excluded.filter((e) => e.reason === 'reason-budget').length, 5);
  assert.equal(result.technicalFailure, true, 'deferred current core leads cannot masquerade as a complete census');
});

test('reasoner can prefer an explicitly configured available provider without changing the default', async () => {
  let provider;
  await reasonRoundupSignals([signal], {
    now: '2026-09-29T19:10:00Z',
    env: { ROUNDUP_REASON_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'test-only', ANTHROPIC_API_KEY: 'test-only' },
    callModel: async ({ resolved }) => {
      provider = resolved.provider.id;
      return { ok: true, text: '{"forms":[]}' };
    },
  });
  assert.equal(provider, 'deepseek');
});

test('source-only credentials never enter reasoner or writer model requests', async () => {
  const env = { APIFY_API_TOKEN: 'apify-synthetic-secret', SERPER_API_KEY: 'serper-synthetic-secret' };
  const captured = [];
  const resolved = { ok: true, provider: { id: 'fixture' } };
  await reasonRoundupSignals([signal], { env, resolved, callModel: async (request) => {
    captured.push(request); return { ok: true, text: JSON.stringify({ forms: [form] }) }; } });
  const unit = { identityKey: 'occ:fixture', verdict: 'adjacent', itemType: 'event', date: '2026-10-03',
    subject: 'Match', citations: [{ url: signal.url, sourceId: signal.sourceId, recordId: 'r1' }], evidence: form.evidence };
  const responses = [{ intro: 'One local event.', units: [{ unitId: unit.identityKey,
    heading: 'Match', body: 'Near Liberty Village on 2026-10-03.' }] }, { findings: [] }, { findings: [] }];
  await writeRoundup({ units: [unit] }, { env, resolved, reviewer: { ok: true, provider: { id: 'independent-fixture' } }, callModel: async (request) => {
    captured.push(request); return { ok: true, text: JSON.stringify(responses.shift()) }; } });
  assert.equal(captured.length, 4);
  assert.ok(!JSON.stringify(captured).includes(env.APIFY_API_TOKEN));
  assert.ok(!JSON.stringify(captured).includes(env.SERPER_API_KEY));
});

test('writer uses a distinct available reviewer and never silently self-reviews', async () => {
  const unit = { identityKey: 'occ:fixture', verdict: 'core', itemType: 'event', date: '2026-10-03',
    subject: 'Park open house', citations: [{ url: 'https://source.example/open-house', sourceId: 'city', recordId: 'r1' }] };
  const responses = [{ intro: 'A park open house.', units: [{ unitId: unit.identityKey,
    heading: 'Park open house', body: 'In Liberty Village on October 3.' }] }, { findings: [] }, { findings: [] }];
  const providers = [];
  const env = { ANTHROPIC_API_KEY: 'test-only', DEEPSEEK_API_KEY: 'test-only' };
  await writeRoundup({ units: [unit] }, { env,
    resolved: { ok: true, provider: { id: 'anthropic' } }, callModel: async ({ resolved }) => {
    providers.push(resolved.provider.id);
    return { ok: true, text: JSON.stringify(responses.shift()) };
  } });
  assert.deepEqual(providers, ['anthropic', 'deepseek', 'deepseek']);
  await assert.rejects(writeRoundup({ units: [unit] }, { env: { ANTHROPIC_API_KEY: 'test-only' },
    resolved: { ok: true, provider: { id: 'anthropic' } },
    reviewer: { ok: true, provider: { id: 'anthropic' } },
    callModel: async () => { throw new Error('same-provider reviewer must not run'); },
  }), /roundup_independent_reviewer_unavailable/);
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
