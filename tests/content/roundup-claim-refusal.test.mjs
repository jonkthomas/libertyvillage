// Decision B claim refusal (roundup-only civic-address / monetary-price ban).
//
// Negative fixture: the exact unattributed invented sentence passes unchanged
// lintPost and the base shared policy (the inherited hole), and is refused at
// the writer, submit, gate g1 and fixer after the patch. Positive fixture: an
// address/price-free 3-unit/1-anchor edition passes everywhere.
import test from 'node:test';
import assert from 'node:assert/strict';
import { lintPost } from '../../scripts/blog-lint.mjs';
import { checkRoundupDraftCopy, checkRoundupVisibleCopy, findRoundupBannedCopy } from '../../scripts/news-pilot/roundup-claims.mjs';
import { assembleRoundupPost, writeRoundup, WRITER_MAX_CALLS } from '../../scripts/news-pilot/roundup-write.mjs';
import { checkKindPolicy, checkRecordPolicy, checkRoundupRecordV2 } from '../../scripts/content/submit.mjs';
import { validateRecord } from '../../scripts/content/validate.mjs';
import { makeRowRepairValidator } from '../../scripts/content/repair-adapter.mjs';
import { buildFixture, unit } from './fixtures/roundup-v2.mjs';

const now = '2026-09-30T12:00:00.000Z';
const submitClock = Date.parse(now) + 60_000;
const SENTENCE = 'Admission is $999. The gathering is at 999 Imaginary Street.';
const BUSINESSES = [{ slug: 'example-cafe', name: 'Example Cafe', address: '40 Hanna Ave' }];
const threeUnits = () => [unit('a', { date: '2026-10-01' }), unit('b', { verdict: 'adjacent', date: '2026-10-02' }), unit('c', { verdict: 'adjacent', date: '2026-10-03' })];
const ctxFor = (fixture, extra = {}) => ({
  pipeline: 'structured-v2', now, temporalValidationNow: new Date(submitClock).toISOString(), isoWeek: fixture.isoWeek,
  weekStartUtc: '2026-09-28T00:00:00.000Z', units: fixture.pack.units, stillInEffect: fixture.pack.stillInEffect,
  roundupCoverage: fixture.coverage, ...extra,
});
const news = { imageExists: () => true };
const policy = (fixture, mutate) => {
  const copy = buildFixture({ now, units: threeUnits() });
  if (mutate) mutate(copy.post);
  return checkRoundupRecordV2({ item: { key: copy.slug }, record: copy.post, ctx: ctxFor(copy), news });
};

// ---------------------------------------------------------------------------
// Inherited hole, unchanged: unattributed specifics pass lintPost.
// ---------------------------------------------------------------------------
test('unchanged lintPost passes the exact unattributed invented sentence', () => {
  const post = { title: 'Weekend notes', description: SENTENCE, answerBlock: SENTENCE,
    content: SENTENCE, keyTakeaways: [SENTENCE], faqs: [{ question: 'Cost?', answer: SENTENCE }] };
  const result = lintPost(post, { businesses: BUSINESSES, now: new Date(now) });
  assert.deepEqual(result, { ok: true, findings: [] });
  const shared = checkRecordPolicy({ kind: 'roundup',
    item: { dataset: 'posts', key: 'k', op: 'insert', payload: { slug: 'k', title: 't' } },
    ctx: {}, live: { businesses: BUSINESSES }, deps: { validateRecord } });
  assert.ok(!shared.errors.join('; ').match(/refused/), 'shared business policy alone does not refuse it');
});

// ---------------------------------------------------------------------------
// New scanner: every visible field, labels not URLs, rendering variants.
// ---------------------------------------------------------------------------
test('scanner refuses civic/price copy in every visible field', () => {
  assert.ok(findRoundupBannedCopy(SENTENCE).some((span) => span.kind === 'price'));
  assert.ok(findRoundupBannedCopy(SENTENCE).some((span) => span.kind === 'civic-address'));
  assert.ok(findRoundupBannedCopy('admission is $999. the gathering is at 999 imaginary street.').length === 2, 'case variant');
  assert.ok(findRoundupBannedCopy('999 Imaginary\\ Street, see you there.').length, 'markdown escape variant');
  assert.ok(findRoundupBannedCopy('Free admission this week.').some((span) => span.kind === 'price'), 'free admission');
  assert.ok(findRoundupBannedCopy('Tickets are 20 dollars.').length, 'currency word');
  const clean = checkRoundupVisibleCopy({ title: 'Liberty Village + Exhibition Place this week: Sep 28–Oct 4, 2026',
    description: 'What is happening in and near Liberty Village this week.', answerBlock: 'What is happening.',
    content: '## 1. Park match\n\nIn Liberty Village on October 1, 2026.\n\nSource: [Example Org](https://example.org/roundup/a)',
    keyTakeaways: ['Community event a'], faqs: [] });
  assert.deepEqual(clean, [], clean.join('; '));
  for (const field of ['title', 'description', 'answerBlock', 'content']) {
    const errors = checkRoundupVisibleCopy({ title: 't', description: 'd', answerBlock: 'a', content: 'c', [field]: SENTENCE });
    assert.match(errors.join('; '), /roundup (civic-address|price) copy is refused in/, field);
  }
  assert.match(checkRoundupVisibleCopy({ content: 'x', keyTakeaways: [SENTENCE] }).join('; '), /keyTakeaways\[0\]/);
  assert.match(checkRoundupVisibleCopy({ content: 'x', faqs: [{ question: 'Cost?', answer: SENTENCE }] }).join('; '), /faqs\[0\]\.answer/);
  assert.match(checkRoundupVisibleCopy(
    { content: '[Example Org, record 999 Imaginary Street](https://example.org/x)' }).join('; '), /refused in content/);
  assert.deepEqual(checkRoundupVisibleCopy({ content: 'See [details](https://example.org/?price=$999) today.' }), [],
    'URL target itself is not prose');
  assert.ok(findRoundupBannedCopy('Tickets are &#36;999 tonight.').some((span) => span.kind === 'price'), 'decimal entity');
  assert.ok(findRoundupBannedCopy('Tickets are &#x24;999 tonight.').some((span) => span.kind === 'price'), 'hex entity');
  assert.ok(findRoundupBannedCopy('Tickets are &dollar;999 tonight.').some((span) => span.kind === 'price'), 'named entity');
  assert.ok(findRoundupBannedCopy('Tickets are &Dollar;999 tonight.').some((span) => span.kind === 'entity-encoded'), 'unknown entity fails closed');
  assert.deepEqual(checkRoundupVisibleCopy({ content: 'Fish & chips and Q&A near Liberty Village.' }), [],
    'bare ampersands are not entities');
  assert.deepEqual(new Set(checkRoundupDraftCopy({ intro: SENTENCE, units: [] })), new Set(['banned-civic-address', 'banned-price']),
    'draft codes carry no snippets');
});

// ---------------------------------------------------------------------------
// Submit: refused in each assembled field; clean edition passes.
// ---------------------------------------------------------------------------
test('submit refuses banned copy in title/description/answerBlock/body/heading/faq/takeaway/still/label', () => {
  assert.deepEqual(policy(null), []);
  assert.match(policy(null, (post) => { post.title += ` ${SENTENCE}`; }).join('; '), /refused in title/);
  assert.match(policy(null, (post) => { post.description += ` ${SENTENCE}`; }).join('; '), /refused in description/);
  assert.match(policy(null, (post) => { post.answerBlock += ` ${SENTENCE}`; }).join('; '), /refused in answerBlock/);
  assert.match(policy(null, (post) => { post.content += `\n\n${SENTENCE}`; }).join('; '), /refused in content/);
  assert.match(policy(null, (post) => { post.content = post.content.replace('## 1.', '## 1. Meet at 999 Imaginary Street,'); }).join('; '), /refused in content/);
  assert.match(policy(null, (post) => { post.content += '\n\nConcerts at 999 Imaginary Street: A, B and C.'; }).join('; '), /refused in content/, 'aggregate line');
  assert.match(policy(null, (post) => { post.content += '\n\n### Still in effect\n\nFree admission continues.'; }).join('; '), /refused in content/, 'still text');
  assert.match(policy(null, (post) => { post.content = post.content.replaceAll('[Example Org]', '[Example Org, record 999 Imaginary Street]'); }).join('; '),
    /refused in content/, 'visible source label');
  assert.match(policy(null, (post) => { post.keyTakeaways[0] += ' at 999 Imaginary Street'; }).join('; '), /refused in keyTakeaways/);
  assert.match(policy(null, (post) => { post.faqs = [{ question: 'What does it cost?', answer: SENTENCE }]; }).join('; '), /refused in faqs/);
});

test('refusal errors carry rule+field+count only, never generated copy', () => {
  const errors = policy(null, (post) => { post.content += `\n\n${SENTENCE}`; });
  assert.match(errors.join('; '), /refused in content/);
  assert.ok(!errors.join('; ').includes('999 Imaginary'), 'no claim snippet retained');
  assert.ok(!errors.join('; ').includes('$999'), 'no price snippet retained');
});

test('positive fixture: address/price-free 3-unit/1-anchor edition passes submit, lint and scanner', () => {
  const fixture = buildFixture({ now, units: threeUnits() });
  assert.deepEqual(checkRoundupRecordV2({ item: { key: fixture.slug }, record: fixture.post, ctx: ctxFor(fixture), news }), []);
  assert.deepEqual(checkRoundupVisibleCopy(fixture.post), []);
  const lint = lintPost(fixture.post, { businesses: [], now: new Date(now) });
  assert.deepEqual(lint.findings, [], lint.findings.map((finding) => finding.claim).join('; '));
});

// ---------------------------------------------------------------------------
// Unchanged contracts: attributed specifics still fail lint; blog/news byte-identical.
// ---------------------------------------------------------------------------
test('attributed address/price still refused by unchanged lintPost', () => {
  const result = lintPost({ title: 't', content: 'Example Cafe admission is $999 at 999 Imaginary Street.' },
    { businesses: BUSINESSES, now: new Date(now) });
  assert.ok(result.findings.some((finding) => finding.rule === 'unsupported-address'), JSON.stringify(result.findings));
  assert.ok(result.findings.some((finding) => finding.rule === 'unsupported-price'), JSON.stringify(result.findings));
});

test('ordinary blog/news/manual posts are byte-identical: no new refusal', () => {
  const plain = { title: 'Weekend notes', description: SENTENCE, answerBlock: SENTENCE, content: SENTENCE };
  for (const kind of ['blog', 'news', 'manual', 'seo']) {
    const result = checkRecordPolicy({ kind, item: { dataset: 'posts', key: 'plain-post', op: 'insert', payload: plain },
      ctx: {}, live: {}, deps: { validateRecord } });
    assert.ok(![...result.errors, ...result.lint].join('; ').match(/refused/), kind);
  }
});

test('seo/manual edits to a roundup are recognized by slug+coverage/live identity', () => {
  const fixture = buildFixture({ now, units: threeUnits() });
  const live = { posts: [fixture.post] };
  const check = (kind, payload) => checkRecordPolicy({ kind,
    item: { dataset: 'posts', key: fixture.slug, op: 'update', payload }, ctx: {}, live, deps: { validateRecord } });
  const clean = { ...fixture.post, description: `${fixture.post.description} Updated.` };
  assert.ok(!check('seo', clean).errors.join('; ').match(/refused/), 'clean roundup edit keeps no refusal');
  assert.ok(!check('manual', clean).errors.join('; ').match(/refused/), 'clean roundup edit keeps no refusal');
  assert.match(check('seo', { ...clean, content: `${clean.content}\n\n${SENTENCE}` }).errors.join('; '), /roundup (civic-address|price) copy is refused/);
  assert.match(check('manual', { ...clean, answerBlock: SENTENCE }).errors.join('; '), /roundup (civic-address|price) copy is refused/);
});

// ---------------------------------------------------------------------------
// Gate g1 and fixer validation replay the same refusal.
// ---------------------------------------------------------------------------
test('gate g1 (checkKindPolicy) refuses banned copy as validation', () => {
  const fixture = buildFixture({ now, units: threeUnits() });
  const banned = { ...fixture.post, content: `${fixture.post.content}\n\n${SENTENCE}` };
  const items = [{ dataset: 'posts', key: fixture.slug, op: 'insert', payload: banned }];
  const result = checkKindPolicy({ kind: 'roundup', items, ctx: ctxFor(fixture),
    live: {}, deps: { validateRecord, news, lintMode: 'fail' } });
  assert.equal(result.ok, false);
  assert.equal(result.decision, 'validation');
  assert.match(result.errors.join('; '), /roundup (civic-address|price) copy is refused/);
});

test('fixer validator refuses a banned repair and accepts a clean one', () => {
  const fixture = buildFixture({ now, units: threeUnits() });
  const candidates = [{ dataset: 'posts', key: fixture.slug, op: 'insert', payload: fixture.post }];
  const validate = makeRowRepairValidator({ kind: 'roundup', candidates, ctx: ctxFor(fixture),
    live: {}, deps: { validateRecord, news, lintMode: 'fail' } });
  const plan = (record) => ({ plan_type: 'record-repair', reason: 'roundup copy fix',
    files: [{ file: 'data/posts.json', records: [{ key: fixture.slug, record }] }] });
  const bad = validate(plan({ ...fixture.post, content: `${fixture.post.content}\n\n${SENTENCE}` }));
  assert.equal(bad.ok, false);
  assert.match(bad.errors.join('; '), /roundup (civic-address|price) copy is refused/);
  const good = validate(plan({ ...fixture.post, description: `${fixture.post.description} Clarified.` }));
  assert.equal(good.ok, true, good.errors.join('; '));
});

// ---------------------------------------------------------------------------
// Writer: one bounded omission retry, then HOLD; exhaustion holds without an extra call.
// ---------------------------------------------------------------------------
const wunit = (id) => ({ identityKey: id, verdict: 'core', itemType: 'event', date: '2026-10-03',
  subject: `Subject ${id}`, when: { kind: 'event', date: '2026-10-03' },
  citations: [{ url: `https://source.example/${encodeURIComponent(id)}`, sourceId: 's', recordId: 'r1' }],
  evidence: [{ url: `https://source.example/${encodeURIComponent(id)}`, recordId: 'r1',
    subject_quote: `Subject ${id}`, place_quote: 'Liberty Village', date_quote: '2026-10-03' }] });
const draftFor = (ids, body = (id) => `In Liberty Village on October 3 for ${id}.`) =>
  ({ intro: 'Three local plans for the week.', units: ids.map((id) => ({ unitId: id, heading: `Subject ${id}`, body: body(id) })) });
const bannedBody = (id) => id === 'occ:a' ? `In Liberty Village on October 3 for ${id}. ${SENTENCE}` : `In Liberty Village on October 3 for ${id}.`;

test('writer omission retry cleans banned copy within budget; repeat failure holds', async () => {
  const units = [wunit('occ:a'), wunit('occ:b'), wunit('occ:c')];
  const scripted = (retryText) => {
    let n = 0;
    return { count: () => n, callModel: async (req) => {
      n += 1;
      if (req.maxTokens === 256) return { ok: true, text: '{"ok":true}' };
      if (/Omit every civic/.test(req.system || '')) return { ok: true, text: JSON.stringify(retryText) };
      const text = req.userText || '';
      if (text.includes('"units"') && !text.includes('"draft"') && !text.includes('"findings"'))
        return { ok: true, text: JSON.stringify(draftFor(['occ:a', 'occ:b', 'occ:c'], bannedBody)) };
      return { ok: true, text: '{"findings":[]}' };
    } };
  };
  const env = { ANTHROPIC_API_KEY: 'test-only', DEEPSEEK_API_KEY: 'test-only' };
  const resolved = { ok: true, provider: { id: 'anthropic' } };
  const first = scripted(draftFor(['occ:a', 'occ:b', 'occ:c']));
  const out = await writeRoundup({ units }, { env, resolved, callModel: first.callModel });
  assert.deepEqual(checkRoundupDraftCopy(out.draft), []);
  assert.ok(first.count() <= WRITER_MAX_CALLS, `calls=${first.count()}`);
  assert.equal(out.modelCalls, first.count());
  const second = scripted(draftFor(['occ:a', 'occ:b', 'occ:c'], bannedBody));
  await assert.rejects(writeRoundup({ units }, { env, resolved, callModel: second.callModel }), /roundup_writer_failed:banned-/);
  assert.equal(second.count(), 3, 'probe + draft + exactly one omission retry');
});

test('writer holds without an extra call when the budget is exhausted', async () => {
  const units = [wunit('occ:a'), wunit('occ:b'), wunit('occ:c')];
  let n = 0;
  const seen = [];
  const callModel = async (req) => {
    n += 1;
    seen.push(req.system || '');
    if (req.maxTokens === 256) return { ok: true, text: '{"ok":true}' };
    if (/Omit every civic/.test(req.system || '')) return { ok: true, text: JSON.stringify(draftFor(['occ:a', 'occ:b', 'occ:c'], bannedBody)) };
    if (/fact reviewer/i.test(req.system || ''))
      return { ok: true, text: '{"findings":[{"unitId":"occ:a","sentence":"s","problem":"unsupported","fix":"f"}]}' };
    if (/Independent locality/i.test(req.system || ''))
      return { ok: true, text: '{"findings":[{"unitId":"occ:a","problem":"tone","fix":"remove hype"}]}' };
    if ((req.userText || '').includes('"findings"')) {
      const banned = (req.userText || '').includes('"tone"');
      return { ok: true, text: JSON.stringify(draftFor(['occ:a', 'occ:b', 'occ:c'], banned ? bannedBody : undefined)) };
    }
    return { ok: true, text: JSON.stringify(draftFor(['occ:a', 'occ:b', 'occ:c'])) };
  };
  // Probe + draft + fact + fact-revise + risk + risk-revise fill the ceiling;
  // the banned draft surfaces at the final check with no call left, so the
  // writer holds instead of retrying.
  const error = await writeRoundup({ units },
    { env: { ANTHROPIC_API_KEY: 'test-only', DEEPSEEK_API_KEY: 'test-only' },
      resolved: { ok: true, provider: { id: 'anthropic' } }, callModel }).then(
    () => { throw new Error('writer must hold'); }, (failure) => failure);
  assert.match(error.message, /roundup_writer_failed:banned-/);
  assert.equal(n, WRITER_MAX_CALLS, `calls=${n}`);
  assert.ok(!seen.some((system) => /Omit every civic/.test(system)), 'no retry call is spent when exhausted');
});

test('assembled post with banned derived takeaway holds instead of dropping identity', () => {
  const fixture = buildFixture({ now, units: threeUnits() });
  const draft = { intro: 'Three local plans for the week.',
    units: fixture.pack.units.map((entry) => ({ unitId: entry.identityKey, heading: entry.label,
      body: `${entry.label} takes place ${entry.verdict === 'core' ? 'in' : 'near'} Liberty Village on ${entry.date}.` })) };
  assert.ok(assembleRoundupPost({ pack: fixture.pack, draft, image: '/images/og/og-home.jpg', imageExists: () => true }).slug);
  const tainted = { ...draft, units: draft.units.map((entry, index) => index === 0
    ? { ...entry, body: `${entry.body} ${SENTENCE}` } : entry) };
  assert.throws(() => assembleRoundupPost({ pack: fixture.pack, draft: tainted, image: '/images/og/og-home.jpg', imageExists: () => true }),
    /roundup_banned_copy/);
});

test('trusted citation publisher with address renders a faithful host label, keeping URL and record', () => {
  const units = threeUnits().map((entry, index) => index === 0
    ? { ...entry, citations: [{ url: entry.citations[0].url, publisher: 'New park at 34 Hanna Avenue', recordId: 'rec-a', sourceId: 'rv2-city-projects' }] }
    : entry);
  const fixture = buildFixture({ now, units });
  const draft = { intro: 'Three local plans for the week.',
    units: fixture.pack.units.map((entry) => ({ unitId: entry.identityKey, heading: entry.label,
      body: `${entry.label} takes place ${entry.verdict === 'core' ? 'in' : 'near'} Liberty Village on ${entry.date}.` })) };
  const post = assembleRoundupPost({ pack: fixture.pack, draft, image: '/images/og/og-home.jpg', imageExists: () => true });
  assert.ok(post.content.includes('[example.org]('), 'display falls back to the cited host');
  assert.ok(post.content.includes('https://example.org/roundup/a'), 'citation target preserved');
  assert.deepEqual(checkRoundupVisibleCopy(post), []);
});
