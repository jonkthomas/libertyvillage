// Roundup editorial copy policy (John, 2026-09-30): a source-verified weekly
// roundup may state an event's street address or price. There is no blanket
// civic-address/price refusal in the writer, assembly, submit, gate g1 or
// fixer, and the inherited blog-lint directory comparisons
// (unsupported-address / unsupported-price) are skipped for roundups only: the
// business directory is not event-fact grounding. Every other lint rule, the
// private-person regeneration, the T_plan clock, citations, the 3/1 minimum
// and the source-pack checks are unchanged. Synthetic fixtures only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { lintPost } from '../../scripts/blog-lint.mjs';
import { assembleRoundupPost, writeRoundup, WRITER_MAX_CALLS } from '../../scripts/news-pilot/roundup-write.mjs';
import { runRoundupV2 } from '../../scripts/news-pilot/roundup-v2-run.mjs';
import { checkKindPolicy, checkRecordPolicy, checkRoundupRecordV2 } from '../../scripts/content/submit.mjs';
import { validateRecord } from '../../scripts/content/validate.mjs';
import { makeRowRepairValidator } from '../../scripts/content/repair-adapter.mjs';
import { buildFixture, unit } from './fixtures/roundup-v2.mjs';

const now = '2026-09-30T12:00:00.000Z';
const submitClock = Date.parse(now) + 60_000;
// Attributed to a directory business whose record disagrees (40 Hanna Ave, no
// price): ordinary blog lint refuses both specifics; a roundup may state them.
const SPECIFIC = 'Example Cafe hosts it at 999 Imaginary Street; tickets are $25.';
const BUSINESSES = [{ slug: 'example-cafe', name: 'Example Cafe', address: '40 Hanna Ave' }];
const HOURS = 'Example Cafe hosts it from 7 pm to 10 pm.';
const threeUnits = () => [unit('a', { date: '2026-10-01' }), unit('b', { verdict: 'adjacent', date: '2026-10-02' }), unit('c', { verdict: 'adjacent', date: '2026-10-03' })];
const ctxFor = (fixture, extra = {}) => ({
  pipeline: 'structured-v2', now, temporalValidationNow: new Date(submitClock).toISOString(), isoWeek: fixture.isoWeek,
  weekStartUtc: '2026-09-28T00:00:00.000Z', units: fixture.pack.units, stillInEffect: fixture.pack.stillInEffect,
  roundupCoverage: fixture.coverage, ...extra,
});
const news = { imageExists: () => true };
const withCopy = (copy, units = threeUnits()) => buildFixture({ now, units, mutatePost: (post) => {
  post.content = post.content.replace('in Liberty Village on October 1, 2026.', `in Liberty Village on October 1, 2026. ${copy}`);
} });
const rules = (findings) => findings.map((finding) => finding.rule);

// ---------------------------------------------------------------------------
// Lint: roundup mode skips exactly the two directory comparisons.
// ---------------------------------------------------------------------------
test('lintPost roundup mode skips only unsupported-address/price; non-roundup lint is unchanged', () => {
  const post = { title: 't', content: SPECIFIC };
  const plain = rules(lintPost(post, { businesses: BUSINESSES, now: new Date(now) }).findings);
  assert.ok(plain.includes('unsupported-address') && plain.includes('unsupported-price'), plain.join(','));
  assert.deepEqual(lintPost(post, { businesses: BUSINESSES, now: new Date(now), roundup: true }), { ok: true, findings: [] });
  // No whole-kind disable: hours, unrecorded businesses and holiday dates still fire.
  const kept = lintPost({ title: 't', publishedAt: '2025-10-08',
    content: `${HOURS} [Ghost Bar](/directory/ghost-bar) opens too. Thanksgiving Monday, October 12 is a holiday.` },
  { businesses: BUSINESSES, now: new Date('2025-10-08T15:00:00Z'), roundup: true });
  assert.deepEqual(new Set(rules(kept.findings)), new Set(['unsupported-hours', 'unrecorded-business', 'unsupported-date']));
});

// ---------------------------------------------------------------------------
// Writer and assembly keep source-verified specifics.
// ---------------------------------------------------------------------------
const wunit = (id, extra = {}) => ({ identityKey: id, verdict: 'core', itemType: 'event', date: '2026-10-03',
  subject: `Subject ${id}`, when: { kind: 'event', date: '2026-10-03' },
  citations: [{ url: `https://source.example/${encodeURIComponent(id)}`, sourceId: 's', recordId: 'r1' }],
  evidence: [{ url: `https://source.example/${encodeURIComponent(id)}`, recordId: 'r1',
    subject_quote: `Subject ${id}`, place_quote: 'Liberty Village', date_quote: '2026-10-03' }], ...extra });
const draftFor = (ids, body = (id) => `In Liberty Village on October 3 for ${id}.`) =>
  ({ intro: 'Three local plans for the week.', units: ids.map((id) => ({ unitId: id, heading: `Subject ${id}`, body: body(id) })) });
const LINT_RETRY = /Resolve inherited lint/;
const env = { ANTHROPIC_API_KEY: 'test-only', DEEPSEEK_API_KEY: 'test-only' };
const resolved = { ok: true, provider: { id: 'anthropic' } };

test('writer keeps a source-verified address and price with no retry, even when the directory disagrees', async () => {
  const ids = ['occ:a', 'occ:b', 'occ:c'];
  const units = ids.map((id) => id === 'occ:a' ? wunit(id, { evidence: [{ url: 'https://source.example/occ%3Aa', recordId: 'r1',
    subject_quote: 'Subject occ:a, tickets $25', place_quote: '999 Imaginary Street', date_quote: '2026-10-03' }] }) : wunit(id));
  const body = (id) => id === 'occ:a' ? `In Liberty Village on October 3. ${SPECIFIC}` : `In Liberty Village on October 3 for ${id}.`;
  const seen = [];
  const callModel = async (req) => {
    seen.push(req.system || '');
    if (req.maxTokens === 256) return { ok: true, text: '{"ok":true}' };
    const text = req.userText || '';
    if (text.includes('"units"') && !text.includes('"draft"') && !text.includes('"findings"'))
      return { ok: true, text: JSON.stringify(draftFor(ids, body)) };
    return { ok: true, text: '{"findings":[]}' };
  };
  const out = await writeRoundup({ units, now }, { env, resolved, businesses: BUSINESSES, callModel });
  const copy = JSON.stringify(out.draft);
  assert.ok(copy.includes('999 Imaginary Street') && copy.includes('$25'), 'specifics survive the writer');
  assert.ok(!seen.some((system) => LINT_RETRY.test(system)), 'no retry is spent on authorized copy');
  assert.ok(!seen.some((system) => /civic|monetary price/i.test(system)), 'no omission instruction reaches the model');
  assert.ok(seen.length <= WRITER_MAX_CALLS, `calls=${seen.length}`);
});

test('assembly keeps address/price copy and the trusted citation label verbatim', () => {
  const units = threeUnits().map((entry, index) => index === 0
    ? { ...entry, citations: [{ ...entry.citations[0], publisher: 'New park at 34 Hanna Avenue' }] } : entry);
  const fixture = buildFixture({ now, units });
  const draft = { intro: 'Three local plans for the week.',
    units: fixture.pack.units.map((entry, index) => ({ unitId: entry.identityKey, heading: entry.label,
      body: `${entry.label} takes place ${entry.verdict === 'core' ? 'in' : 'near'} Liberty Village on ${entry.date}.${index === 0 ? ` ${SPECIFIC}` : ''}` })) };
  const post = assembleRoundupPost({ pack: fixture.pack, draft, image: '/images/og/og-home.jpg', imageExists: () => true });
  assert.ok(post.content.includes(SPECIFIC));
  assert.ok(post.content.includes('[New park at 34 Hanna Avenue](https://example.org/roundup/a)'), 'citation identity is unchanged');
});

// ---------------------------------------------------------------------------
// Trusted policy: submit, gate g1, fixer and later edits.
// ---------------------------------------------------------------------------
test('submit, gate g1 and fixer accept source-verified address/price roundup copy (directory mismatch, lint fail mode)', () => {
  const fixture = withCopy(SPECIFIC);
  assert.ok(fixture.post.content.includes(SPECIFIC));
  const live = { businesses: BUSINESSES };
  const deps = { validateRecord, news, lintMode: 'fail' };
  assert.deepEqual(checkRoundupRecordV2({ item: { key: fixture.slug }, record: fixture.post, ctx: ctxFor(fixture), news }), []);
  const item = { dataset: 'posts', key: fixture.slug, op: 'insert', payload: fixture.post };
  const record = checkRecordPolicy({ kind: 'roundup', item, ctx: ctxFor(fixture), live, deps });
  assert.deepEqual([...record.errors, ...record.lint], []);
  const g1 = checkKindPolicy({ kind: 'roundup', items: [item], ctx: ctxFor(fixture), live, deps });
  assert.equal(g1.ok, true, g1.errors.join('; '));
  const pristine = buildFixture({ now, units: threeUnits() });
  const validate = makeRowRepairValidator({ kind: 'roundup',
    candidates: [{ dataset: 'posts', key: pristine.slug, op: 'insert', payload: pristine.post }],
    ctx: ctxFor(pristine), live, deps });
  const repaired = validate({ plan_type: 'record-repair', reason: 'roundup copy fix',
    files: [{ file: 'data/posts.json', records: [{ key: pristine.slug, record: fixture.post }] }] });
  assert.equal(repaired.ok, true, repaired.errors.join('; '));
  for (const kind of ['seo', 'manual']) {
    const edit = checkRecordPolicy({ kind, item: { dataset: 'posts', key: pristine.slug, op: 'update', payload: fixture.post },
      ctx: {}, live: { ...live, posts: [pristine.post] }, deps: { validateRecord } });
    assert.deepEqual(edit.errors, [], kind);
  }
});

test('roundup submit still refuses other lint (hours) and non-roundup kinds keep address/price lint', () => {
  const hours = withCopy(HOURS);
  const result = checkRecordPolicy({ kind: 'roundup', item: { dataset: 'posts', key: hours.slug, op: 'insert', payload: hours.post },
    ctx: ctxFor(hours), live: { businesses: BUSINESSES }, deps: { validateRecord, news, lintMode: 'fail' } });
  assert.match(result.lint.join('; '), /\[unsupported-hours\]/);
  const plain = { slug: 'plain-post', title: 'Weekend notes', description: 'd', answerBlock: 'a', content: SPECIFIC };
  for (const kind of ['blog', 'news']) {
    const other = checkRecordPolicy({ kind, item: { dataset: 'posts', key: 'plain-post', op: 'insert', payload: plain },
      ctx: {}, live: { businesses: BUSINESSES }, deps: { validateRecord, news, lintMode: 'fail' } });
    assert.match(other.lint.join('; '), /\[unsupported-address\]/, kind);
    assert.match(other.lint.join('; '), /\[unsupported-price\]/, kind);
    // The roundup marker cannot be borrowed by another kind to skip lint.
    const smuggled = checkRecordPolicy({ kind, item: { dataset: 'posts', key: 'plain-post', op: 'insert',
      payload: { ...plain, roundupCoverage: hours.coverage } }, ctx: {}, live: { businesses: BUSINESSES }, deps: { validateRecord, news, lintMode: 'fail' } });
    assert.match(smuggled.errors.join('; '), /roundup-only trusted metadata/, kind);
  }
});

test('address/price copy does not relax the 3/1 minimum, dates or pack-only citations', () => {
  const policy = (fixture) => checkRoundupRecordV2({ item: { key: fixture.slug }, record: fixture.post, ctx: ctxFor(fixture), news });
  assert.match(policy(withCopy(SPECIFIC, threeUnits().slice(0, 2))).join('; '), /requires 3-12 counted units/);
  const noDate = withCopy(SPECIFIC);
  noDate.post.content = noDate.post.content.replace('on October 3, 2026', 'this week');
  assert.match(policy(noDate).join('; '), /actual date/);
  const outside = withCopy(`${SPECIFIC} See [elsewhere](https://example.net/other).`);
  assert.match(policy(outside).join('; '), /outside the verified pack/);
});

test('runner dry-run publishes a candidate with source-verified address/price copy despite a directory mismatch', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rv2-copy-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'data'));
  fs.mkdirSync(path.join(root, 'public/images/og'), { recursive: true });
  fs.writeFileSync(path.join(root, 'public/images/og/og-home.jpg'), 'fixture image');
  fs.writeFileSync(path.join(root, 'data/posts.json'), '[]\n');
  fs.writeFileSync(path.join(root, 'data/businesses.json'), JSON.stringify(BUSINESSES));
  const units = [
    { identityKey: 'occ:addr:75-fraser-ave:2026-10-03:15:00', verdict: 'core', itemType: 'sports', date: '2026-10-03', subject: 'Lamport match' },
    { identityKey: 'occ:addr:170-princes-blvd:2026-10-04:15:00', verdict: 'adjacent', itemType: 'event', date: '2026-10-04', subject: 'BMO event' },
    { identityKey: 'occ:addr:171-east-liberty-st#113:2026-10-02:17:00', verdict: 'core', itemType: 'class', date: '2026-10-02', subject: 'NRG class' },
  ].map((entry, i) => ({ ...entry, keys: [entry.identityKey], citations: [
    { url: `https://source.example/${i}`, publisher: 'Official source', recordId: `r${i}`, sourceId: `s${i}` }],
    evidence: [{ url: `https://source.example/${i}`, recordId: `r${i}`, subject_quote: entry.subject,
      place_quote: entry.subject, date_quote: entry.date }] }));
  const draft = { intro: 'Three local plans for the week.', units: units.map((entry, i) => ({ unitId: entry.identityKey,
    heading: entry.subject, body: `${i === 1 ? 'Near' : 'In'} Liberty Village: ${entry.subject} on ${entry.date}.${i === 0 ? ` ${SPECIFIC}` : ''}` })) };
  const { result, post } = await runRoundupV2({ run: root, out: path.join(root, 'out'), root,
    now: '2026-09-29T15:00:00Z', dryRun: true }, {
    signals: [], reasoned: { forms: [] },
    verify: async () => ({ items: units, excluded: [], verifyDigest: 'a'.repeat(64) }),
    plan: () => ({ decision: 'publish', countedItems: units, stillInEffect: [], units: 3, coreUnits: 2, coreAnchorUnits: 1, reasons: [] }),
    write: async () => ({ draft, findings: [], refused: [], units }),
  });
  assert.equal(result.decision, 'publish', result.census.writerError);
  assert.equal(result.published, false);
  assert.ok(post.content.includes(SPECIFIC));
});

// ---------------------------------------------------------------------------
// Retained safety: T_plan clock, single bounded lint retry, private refusal.
// ---------------------------------------------------------------------------
test('R2 draft lint uses T_plan: correct 2025 Thanksgiving date needs no retry, wrong one retries then holds', async () => {
  const planNow = '2025-10-08T15:00:00.000Z';
  const ids = ['occ:a', 'occ:b', 'occ:c'];
  const units = ids.map((id) => wunit(id));
  const bodyFor = (date) => (id) => id === 'occ:a'
    ? `Thanksgiving Monday, October ${date} gathering in Liberty Village.`
    : `In Liberty Village on October 3 for ${id}.`;
  const scripted = (date) => {
    let n = 0;
    const seen = [];
    return { count: () => n, seen, callModel: async (req) => {
      n += 1;
      seen.push(req.system || '');
      if (req.maxTokens === 256) return { ok: true, text: '{"ok":true}' };
      if (LINT_RETRY.test(req.system || '')) return { ok: true, text: JSON.stringify(draftFor(ids, bodyFor(date))) };
      const text = req.userText || '';
      if (text.includes('"units"') && !text.includes('"draft"') && !text.includes('"findings"'))
        return { ok: true, text: JSON.stringify(draftFor(ids, bodyFor(date))) };
      return { ok: true, text: '{"findings":[]}' };
    } };
  };
  // October 13 is Thanksgiving Monday 2025 (Oct 12 in 2026): pinned T_plan
  // lint passes, so no retry is spent.
  const good = scripted('13');
  await writeRoundup({ units, now: planNow }, { env, resolved, businesses: [], callModel: good.callModel });
  assert.ok(!good.seen.some((system) => LINT_RETRY.test(system)), 'correct T_plan date needs no retry');
  assert.ok(good.count() <= WRITER_MAX_CALLS, `calls=${good.count()}`);
  // October 12 is wrong for 2025: the draft lint still flags it, spends the
  // single retry, then holds.
  const bad = scripted('12');
  const error = await writeRoundup({ units, now: planNow }, { env, resolved, businesses: [], callModel: bad.callModel }).then(
    () => { throw new Error('writer must hold'); }, (failure) => failure);
  assert.match(error.message, /roundup_writer_failed:lint unsupported-date/);
  assert.equal(bad.seen.filter((system) => LINT_RETRY.test(system)).length, 1, 'exactly one retry');
});

test('F6 writer lint retry: business-attributed hours claim retries within budget, holds when exhausted', async () => {
  const businesses = [{ slug: 'left-field-brewery', name: 'Left Field Brewery' }];
  const ids = ['occ:a', 'occ:b', 'occ:c'];
  const units = ids.map((id) => wunit(id));
  const lintBody = (id) => id === 'occ:a'
    ? 'Left Field Brewery hosts it from 7 pm to 10 pm on October 1.'
    : `In Liberty Village on October 3 for ${id}.`;
  const cleanBody = (id) => `In Liberty Village on October 3 for ${id}.`;
  let retrySystem = null;
  let n = 0;
  const callModel = async (req) => {
    n += 1;
    if (req.maxTokens === 256) return { ok: true, text: '{"ok":true}' };
    if (LINT_RETRY.test(req.system || '')) {
      retrySystem = req.system || '';
      return { ok: true, text: JSON.stringify(draftFor(ids, cleanBody)) };
    }
    const text = req.userText || '';
    if (text.includes('"units"') && !text.includes('"draft"') && !text.includes('"findings"'))
      return { ok: true, text: JSON.stringify(draftFor(ids, lintBody)) };
    return { ok: true, text: '{"findings":[]}' };
  };
  const out = await writeRoundup({ units }, { env, resolved, businesses, callModel });
  assert.ok(retrySystem && /lint unsupported-hours/.test(retrySystem), `retry names the lint rule, got: ${retrySystem}`);
  assert.ok(!/7 pm to 10 pm/.test(retrySystem), 'retry prompt carries rule+field+count, not the claim');
  assert.ok(!/7 pm to 10 pm/.test(JSON.stringify(out.draft)), 'retried draft drops the unsupported claim');
  assert.ok(n <= WRITER_MAX_CALLS, `calls=${n}`);
  // Exhausted budget: fact + fact-revise + risk + risk-revise fill six calls, so a
  // final lint violation holds without spending a second retry.
  let m = 0;
  const seen = [];
  const exhausted = async (req) => {
    m += 1;
    seen.push(req.system || '');
    if (req.maxTokens === 256) return { ok: true, text: '{"ok":true}' };
    if (LINT_RETRY.test(req.system || '')) return { ok: true, text: JSON.stringify(draftFor(ids, cleanBody)) };
    if (/fact reviewer/i.test(req.system || ''))
      return { ok: true, text: '{"findings":[{"unitId":"occ:a","sentence":"s","problem":"unsupported","fix":"f"}]}' };
    if (/Independent locality/i.test(req.system || ''))
      return { ok: true, text: '{"findings":[{"unitId":"occ:a","problem":"tone","fix":"remove hype"}]}' };
    if ((req.userText || '').includes('"findings"')) {
      const tone = (req.userText || '').includes('"tone"');
      return { ok: true, text: JSON.stringify(draftFor(ids, tone ? lintBody : undefined)) };
    }
    return { ok: true, text: JSON.stringify(draftFor(ids)) };
  };
  const error = await writeRoundup({ units }, { env, resolved, businesses, callModel: exhausted }).then(
    () => { throw new Error('writer must hold'); }, (failure) => failure);
  assert.match(error.message, /roundup_writer_failed:lint unsupported-hours/);
  assert.ok(!error.message.includes('7 pm'), 'hold diagnostic carries no generated claim text');
  assert.equal(m, WRITER_MAX_CALLS, `calls=${m}`);
  assert.ok(!seen.some((system) => LINT_RETRY.test(system)), 'no retry call is spent when exhausted');
});

test('B3 private refusal discards the contaminated draft and regenerates from safe units only', async () => {
  // Scripted 4-unit case: risk refuses one unit as private-individual and
  // flags tone on another. The original intro carries the refused story; the
  // regenerated draft is clean. Explicit reviewer (no probe) so regenerate +
  // fresh fact/risk reviews fit the six-call ceiling.
  const personUnit = (id, person) => ({ ...wunit(id),
    people: person ? [{ name: person, role: 'private-person' }] : [],
    evidence: [{ url: `https://source.example/${encodeURIComponent(id)}`, recordId: 'r1',
      subject_quote: person ? `${person} hosts Subject ${id}` : `Subject ${id}`,
      place_quote: 'Liberty Village', date_quote: '2026-10-03' }] });
  const ids = ['occ:a', 'occ:b', 'occ:c', 'occ:d'];
  const units = [personUnit('occ:a', null), personUnit('occ:b', null),
    personUnit('occ:c', null), personUnit('occ:d', 'Alex Example')];
  const contaminated = { intro: 'Four local plans. Alex Example shared a personal-finances story.',
    units: ids.map((id) => ({ unitId: id, heading: `Subject ${id}`,
      body: `In Liberty Village on October 3 for ${id}.` })) };
  const regenerated = { intro: 'Three local plans for the week.',
    units: ['occ:a', 'occ:b', 'occ:c'].map((id) => ({ unitId: id, heading: `Subject ${id}`,
      body: `In Liberty Village on October 3 for ${id}.` })) };
  const seen = [];
  let unitsCalls = 0;
  const callModel = async (req) => {
    seen.push(req);
    const text = req.userText || '';
    if (text.includes('"units"') && !text.includes('"draft"') && !text.includes('"findings"')) {
      unitsCalls += 1;
      return { ok: true, text: JSON.stringify(unitsCalls === 1 ? contaminated : regenerated) };
    }
    if (/fact reviewer/i.test(req.system || '')) return { ok: true, text: '{"findings":[]}' };
    if (/Independent locality/i.test(req.system || '')) {
      const rounds = seen.filter((r) => /Independent locality/i.test(r.system || '')).length;
      if (rounds > 1) {
        assert.ok((req.userText || '').includes('Three local plans for the week.'), 'second risk review sees the fresh draft');
        assert.ok(!(req.userText || '').includes('Alex Example'), 'second risk review never sees the refused person');
        return { ok: true, text: '{"findings":[]}' };
      }
      return { ok: true, text: '{"findings":[{"unitId":"occ:d","person":"Alex Example","problem":"private-individual"},{"unitId":"occ:a","problem":"tone","fix":"remove hype"}]}' };
    }
    throw new Error(`unexpected model call: ${req.system}`);
  };
  const out = await writeRoundup({ units },
    { resolved: { ok: true, provider: { id: 'anthropic' } },
      reviewer: { ok: true, provider: { id: 'deepseek' } }, callModel });
  assert.deepEqual(out.refused, ['occ:d']);
  assert.deepEqual(out.draft.units.map((e) => e.unitId), ['occ:a', 'occ:b', 'occ:c']);
  assert.ok(!JSON.stringify(out.draft).includes('Alex Example'), 'refused story cannot persist in the final draft');
  assert.equal(out.findings.length, 4, 'fresh fact AND risk reviews execute on the regenerated draft');
  assert.ok(seen.length <= WRITER_MAX_CALLS, `calls=${seen.length}`);
  // Every author-bound payload after the first risk review excludes the
  // refused unit, the person, the original draft and the old findings.
  const firstRisk = seen.findIndex((r) => /Independent locality/i.test(r.system || ''));
  for (const req of seen.slice(firstRisk + 1)) {
    if (/reviewer|locality/i.test(req.system || '')) continue;
    const payload = req.userText || '';
    assert.ok(!payload.includes('occ:d'), 'no refused ID in later author calls');
    assert.ok(!payload.includes('Alex Example'), 'no refused person in later author calls');
    assert.ok(!payload.includes('personal-finances'), 'no refused story in later author calls');
    assert.ok(!payload.includes('"findings"'), 'no old findings in later author calls');
  }
  const regen = seen.find((r) => (r.userText || '').includes('"units"') && !(r.userText || '').includes('"draft"')
    && seen.indexOf(r) > firstRisk);
  assert.ok(regen, 'the author regenerates after the refusal');
  assert.ok(!(regen.userText || '').includes('occ:d') && (regen.userText || '').includes('occ:a'), 'regenerate uses safe units only');
});

test('B3 private refusal after a spent lint retry holds when re-review cannot fit the budget', async () => {
  // The first draft also carries a lint violation: the shared lint retry fires
  // first, so regenerate + fresh reviews no longer fit even without a probe.
  const businesses = [{ slug: 'left-field-brewery', name: 'Left Field Brewery' }];
  const ids = ['occ:a', 'occ:b', 'occ:c', 'occ:d'];
  const units = ids.map((id) => wunit(id));
  const tainted = (story) => ({ intro: `Four local plans. Alex Example shared a personal-finances story. ${story}`,
    units: ids.map((id) => ({ unitId: id, heading: `Subject ${id}`,
      body: `In Liberty Village on October 3 for ${id}.` })) });
  const cleanSafe = { intro: 'Three local plans for the week.',
    units: ['occ:a', 'occ:b', 'occ:c'].map((id) => ({ unitId: id, heading: `Subject ${id}`,
      body: `In Liberty Village on October 3 for ${id}.` })) };
  let unitsCalls = 0;
  const callModel = async (req) => {
    if (LINT_RETRY.test(req.system || '')) return { ok: true, text: JSON.stringify(tainted('Cleaned.')) };
    const text = req.userText || '';
    if (text.includes('"units"') && !text.includes('"draft"') && !text.includes('"findings"')) {
      unitsCalls += 1;
      return { ok: true, text: JSON.stringify(unitsCalls === 1 ? tainted('Left Field Brewery hosts it from 7 pm to 10 pm.') : cleanSafe) };
    }
    if (/fact reviewer/i.test(req.system || '')) return { ok: true, text: '{"findings":[]}' };
    if (/Independent locality/i.test(req.system || ''))
      return { ok: true, text: '{"findings":[{"unitId":"occ:d","person":"Alex Example","problem":"private-individual"}]}' };
    throw new Error(`unexpected model call: ${req.system}`);
  };
  const error = await writeRoundup({ units },
    { resolved: { ok: true, provider: { id: 'anthropic' } },
      reviewer: { ok: true, provider: { id: 'deepseek' } }, businesses, callModel }).then(
    () => { throw new Error('writer must hold'); }, (failure) => failure);
  assert.match(error.message, /roundup_writer_failed:(writer-budget|all-units-refused|regenerated-)/, 'fail-closed HOLD');
});
