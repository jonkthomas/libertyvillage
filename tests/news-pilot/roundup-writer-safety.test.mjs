import test from 'node:test';
import assert from 'node:assert/strict';
import { checkRoundupDraft, writeRoundup, WRITER_MAX_CALLS } from '../../scripts/news-pilot/roundup-write.mjs';
import { createIgProvider, IG_LIMITS, IgProviderError } from '../../scripts/news-pilot/ig-provider.mjs';

const unit = (id, verdict = 'core') => ({ identityKey: id, verdict, itemType: 'event', date: '2026-10-03',
  subject: `Subject ${id}`, when: { kind: 'event', date: '2026-10-03' },
  citations: [{ url: `https://source.example/${encodeURIComponent(id)}`, sourceId: 's', recordId: 'r1' }],
  evidence: [{ url: `https://source.example/${encodeURIComponent(id)}`, recordId: 'r1',
    subject_quote: `Subject ${id}`, place_quote: 'Liberty Village', date_quote: '2026-10-03' }] });
const draftFor = (ids, body = (id) => `In Liberty Village on October 3 for ${id}.`) =>
  ({ intro: 'Three local plans for the week.', units: ids.map((id) => ({ unitId: id, heading: `Subject ${id}`, body: body(id) })) });

// Scripted reviewer probe + writer sequence: probe, draft, fact review, risk review.
const scriptedCalls = (riskFindings, draftIds = ['occ:a', 'occ:b', 'occ:c']) => {
  const calls = [];
  return { calls, callModel: async (req) => {
    calls.push(req);
    if (req.maxTokens === 256) return { ok: true, text: '{"ok":true}' };
    const text = req.userText || '';
    if (text.includes('"units"') && !text.includes('"draft"') && !text.includes('"findings"'))
      return { ok: true, text: JSON.stringify({ intro: 'Three local plans for the week.',
        units: draftIds.map((id) => ({ unitId: id, heading: `Subject ${id}`, body: `In Liberty Village on October 3 for ${id}.` })) }) };
    if (text.includes('fact reviewer') || req.system?.includes('fact reviewer')) return { ok: true, text: '{"findings":[]}' };
    return { ok: true, text: JSON.stringify({ findings: riskFindings }) };
  } };
};

test('unknown-ID private-individual finding fails the whole writer (fail-closed HOLD)', async () => {
  const units = [unit('occ:a'), unit('occ:b'), unit('occ:c')];
  const badIds = [{ unitId: '2', person: 'Jane Resident', problem: 'private-individual' }];
  const { callModel } = scriptedCalls(badIds);
  await assert.rejects(
    writeRoundup({ units }, { env: { ANTHROPIC_API_KEY: 'test-only', DEEPSEEK_API_KEY: 'test-only' }, resolved: { ok: true, provider: { id: 'anthropic' } }, callModel }),
    /roundup_writer_failed:unknown-private-individual-unit/);
  const nullId = [{ person: 'Jane Resident', problem: 'private-individual' }];
  const second = scriptedCalls(nullId);
  await assert.rejects(
    writeRoundup({ units }, { env: { ANTHROPIC_API_KEY: 'test-only', DEEPSEEK_API_KEY: 'test-only' }, resolved: { ok: true, provider: { id: 'anthropic' } }, callModel: second.callModel }),
    /roundup_writer_failed:unknown-private-individual-unit/);
});

test('valid private-individual refusal removes exactly those units', async () => {
  const units = [unit('occ:a'), unit('occ:b'), unit('occ:c')];
  const risk = [{ unitId: 'occ:b', person: 'Jane Resident', problem: 'private-individual' }];
  const { callModel, calls } = scriptedCalls(risk);
  const out = await writeRoundup({ units }, { env: { ANTHROPIC_API_KEY: 'test-only', DEEPSEEK_API_KEY: 'test-only' }, resolved: { ok: true, provider: { id: 'anthropic' } }, callModel });
  assert.deepEqual(out.refused, ['occ:b']);
  assert.deepEqual(out.units.map((u) => u.identityKey), ['occ:a', 'occ:c']);
  assert.deepEqual(out.draft.units.map((e) => e.unitId), ['occ:a', 'occ:c']);
  assert.ok(calls.length <= WRITER_MAX_CALLS);
  assert.equal(out.modelCalls, calls.length);
});

const criticCase = async (factFindings, riskFindings) => {
  const units = [unit('occ:a'), unit('occ:b'), unit('occ:c')];
  let calls = 0;
  const callModel = async ({ system }) => {
    calls += 1;
    if (system.includes('Independent fact reviewer')) return { ok: true, text: JSON.stringify({ findings: factFindings }) };
    if (system.includes('Independent locality')) return { ok: true, text: JSON.stringify({ findings: riskFindings }) };
    return { ok: true, text: JSON.stringify(draftFor(units.map((entry) => entry.identityKey))) };
  };
  const output = await writeRoundup({ units }, { resolved: { ok: true, provider: { id: 'anthropic' } },
    reviewer: { ok: true, provider: { id: 'deepseek' } }, callModel });
  return { output, calls };
};

for (const [name, fact, risk, error] of [
  ['null in fact findings', [null], [], /roundup_fact_review_invalid/],
  ['empty object in fact findings', [{}], [], /roundup_fact_review_invalid/],
  ['null in risk findings', [], [null], /roundup_risk_review_invalid/],
  ['empty object in risk findings', [], [{}], /roundup_risk_review_invalid/],
  ['unknown fact finding', [{ unitId: 'occ:a', sentence: 'x', problem: 'not-a-problem', fix: 'y' }], [], /roundup_fact_review_invalid/],
  ['unknown risk finding', [], [{ unitId: 'occ:a', problem: 'not-a-problem', fix: 'y' }], /roundup_risk_review_invalid/],
  ['unknown fact unit', [{ unitId: 'occ:unknown', sentence: 'x', problem: 'unsupported', fix: 'y' }], [], /roundup_fact_review_invalid/],
  ['unknown non-private risk unit', [], [{ unitId: 'occ:unknown', problem: 'tone', fix: 'y' }], /roundup_risk_review_invalid/],
  ['missing fact sentence', [{ unitId: 'occ:a', problem: 'unsupported', fix: 'y' }], [], /roundup_fact_review_invalid/],
  ['missing private person', [], [{ unitId: 'occ:a', problem: 'private-individual' }], /roundup_risk_review_invalid/],
]) test(`schema-invalid ${name} fails closed before publishable copy`, async () => {
  await assert.rejects(criticCase(fact, risk), error);
});

test('two empty findings arrays are valid independent reviews', async () => {
  const { output, calls } = await criticCase([], []);
  assert.equal(output.draft.units.length, 3);
  assert.equal(output.findings.length, 2);
  assert.equal(calls, 3);
});

test('reviewer probe counts inside the six-call writer ceiling; budget overrun is writer-failed', async () => {
  assert.equal(WRITER_MAX_CALLS, 6);
  const units = [unit('occ:a'), unit('occ:b'), unit('occ:c')];
  // Probe (1) + draft + repair + fact + fact-revise + risk already fills the
  // ceiling, so the final risk-revision call must fail closed, not run free.
  let n = 0;
  const hungry = async (req) => {
    n += 1;
    if (req.maxTokens === 256) return { ok: true, text: '{"ok":true}' };
    if (n === 2) return { ok: true, text: JSON.stringify({ intro: 'x', units: [] }) }; // draft-shape error
    if (n === 3) return { ok: true, text: JSON.stringify(draftFor(['occ:a', 'occ:b', 'occ:c'])) };
    if (n === 4) return { ok: true, text: '{"findings":[{"unitId":"occ:a","sentence":"s","problem":"unsupported","fix":"f"}]}' };
    if (n === 5) return { ok: true, text: JSON.stringify(draftFor(['occ:a', 'occ:b', 'occ:c'])) };
    if (n === 6) return { ok: true, text: '{"findings":[{"unitId":"occ:a","person":"P","problem":"tone","fix":"f"}]}' };
    return { ok: true, text: JSON.stringify(draftFor(['occ:a', 'occ:b', 'occ:c'])) };
  };
  await assert.rejects(writeRoundup({ units },
    { env: { ANTHROPIC_API_KEY: 'test-only', DEEPSEEK_API_KEY: 'test-only' }, resolved: { ok: true, provider: { id: 'anthropic' } }, callModel: hungry }),
  /roundup_writer_failed:writer-budget/);
  assert.equal(n, 6);
});

test('one deterministic-repair retry only: repeated failure is writer-failed, not retried', async () => {
  const units = [unit('occ:a')];
  let n = 0;
  const alwaysBad = async (req) => {
    n += 1;
    if (req.maxTokens === 256) return { ok: true, text: '{"ok":true}' };
    return { ok: true, text: JSON.stringify({ intro: 'x', units: [] }) };
  };
  await assert.rejects(writeRoundup({ units },
    { env: { ANTHROPIC_API_KEY: 'test-only', DEEPSEEK_API_KEY: 'test-only' }, resolved: { ok: true, provider: { id: 'anthropic' } }, callModel: alwaysBad }),
  /roundup_writer_failed:draft-shape/);
  assert.equal(n, 3, 'probe + draft + exactly one repair retry');
});

test('control/bidi/zero-width copy is rejected; tabs and newlines still pass', () => {
  const units = [unit('occ:a')];
  const good = draftFor(['occ:a'], () => 'In Liberty Village\twith tab\nand newline October 3.');
  assert.deepEqual(checkRoundupDraft(good, units), []);
  for (const [name, ch] of [['bidi', '\u202E'], ['zero-width', '\u200B'], ['bel', '\u0007'], ['ffff', '\uFFFF']]) {
    const bad = draftFor(['occ:a'], () => `In Liberty Village ${ch} October 3.`);
    assert.ok(checkRoundupDraft(bad, units).includes('unsafe-control-chars'), name);
  }
  const badIntro = { ...draftFor(['occ:a']), intro: 'Intro \u202E spoof' };
  assert.ok(checkRoundupDraft(badIntro, units).includes('unsafe-control-chars'));
});

test('stalled body after headers hits the provider timeout; oversize body is bounded', async () => {
  const stalled = createIgProvider({ token: 't', timeoutMs: 50,
    fetcher: async () => ({ status: 200, text: () => new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('x'), { name: 'AbortError' })), 500)) }) });
  await assert.rejects(stalled.listRecentPosts({ handles: ['questxochocolate'], newerThan: '2026-09-07' }),
    (e) => e instanceof IgProviderError && e.code === 'timeout');
  const big = createIgProvider({ token: 't', fetcher: async () => ({ status: 200, text: async () => `[${'x'.repeat(IG_LIMITS.maxBodyBytes)}]` }) });
  await assert.rejects(big.listRecentPosts({ handles: ['questxochocolate'], newerThan: '2026-09-07' }),
    (e) => e instanceof IgProviderError && e.code === 'too-large');
});

test('provider errors never carry the token value', async () => {
  const secret = 'apify_secret_TOKEN_VALUE';
  const p = createIgProvider({ token: secret, fetcher: async () => ({ status: 500, json: async () => [] }) });
  try {
    await p.listRecentPosts({ handles: ['questxochocolate'], newerThan: '2026-09-07' });
    assert.fail('must throw');
  } catch (e) {
    assert.ok(!String(e.message).includes(secret));
  }
});
