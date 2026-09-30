// Decision B boundary coverage: rendered-field policy (B1) and renderer
// link-adjacency fidelity (B2), against the real page renderer, shared policy
// and fixer validator. Synthetic fixtures only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdownContent } from '../../lib/markdown.ts';
import { checkRoundupVisibleCopy, findRoundupBannedCopy } from '../../scripts/news-pilot/roundup-claims.mjs';
import { checkKindPolicy, checkRecordPolicy, checkRoundupRecordV2 } from '../../scripts/content/submit.mjs';
import { validateRecord } from '../../scripts/content/validate.mjs';
import { makeRowRepairValidator } from '../../scripts/content/repair-adapter.mjs';
import { serialize } from '../../scripts/content/canonical.mjs';
import { buildFixture, unit } from '../content/fixtures/roundup-v2.mjs';

const now = '2026-09-30T12:00:00.000Z';
const submitClock = Date.parse(now) + 60_000;
const threeUnits = () => [unit('a', { date: '2026-10-01' }),
  unit('b', { verdict: 'adjacent', date: '2026-10-02' }),
  unit('c', { verdict: 'adjacent', date: '2026-10-03' })];
const ctxFor = (fixture, extra = {}) => ({
  pipeline: 'structured-v2', now, temporalValidationNow: new Date(submitClock).toISOString(), isoWeek: fixture.isoWeek,
  weekStartUtc: '2026-09-28T00:00:00.000Z', units: fixture.pack.units, stillInEffect: fixture.pack.stillInEffect,
  roundupCoverage: fixture.coverage, ...extra,
});
const news = { imageExists: () => true };
const stripTags = (html) => html.replace(/<[^>]*>/g, '');

// ---------------------------------------------------------------------------
// B1: rendered post-controlled fields refuse at every shared-policy layer,
// even in lintMode warn; opaque URLs/coverage/record IDs stay unscanned.
// ---------------------------------------------------------------------------

test('B1 author/tags/exploreCta/cross-link labels refuse at submit, g1-warn, seo/manual and round-trip', () => {
  const cases = [
    ['author', (post) => { post.author = 'LibertyVillage.co $999 Special'; }],
    ['tags', (post) => { post.tags = [...post.tags, 'tickets $25']; }],
    ['exploreCta.label', (post) => { post.exploreCta = { label: 'Meet at 999 Imaginary Street', href: '/about', description: 'See more.' }; }],
    ['exploreCta.description', (post) => { post.exploreCta = { label: 'Explore', href: '/about', description: 'Free admission inside.' }; }],
    ['crossLinks', (post) => { post.crossLinks = [{ type: 'service', slug: 'coffee', label: 'Deals at $5' }]; }],
  ];
  for (const [name, mutate] of cases) {
    const fixture = buildFixture({ now, units: threeUnits() });
    mutate(fixture.post);
    assert.match(checkRoundupVisibleCopy(fixture.post).join('; '), /refused/, `${name} scanner`);
    assert.match(checkRoundupRecordV2({ item: { key: fixture.slug }, record: fixture.post,
      ctx: ctxFor(fixture), news }).join('; '), /refused/, `${name} submit`);
    const g1 = checkKindPolicy({ kind: 'roundup',
      items: [{ dataset: 'posts', key: fixture.slug, op: 'insert', payload: fixture.post }],
      ctx: ctxFor(fixture), live: {}, deps: { validateRecord, news, lintMode: 'warn' } });
    assert.equal(g1.ok, false, `${name} g1 warn refuses`);
    assert.equal(g1.decision, 'validation', `${name} refusal is validation, never lint-bypassable`);
    // Canonical serialize/parse round-trip preserves the copy and the refusal.
    const roundTripped = JSON.parse(serialize('posts', [fixture.post])).find((p) => p.slug === fixture.slug);
    assert.match(checkRoundupVisibleCopy(roundTripped).join('; '), /refused/, `${name} round-trip`);
    // SEO and manual edits to the live roundup refuse the same copy.
    const pristine = buildFixture({ now, units: threeUnits() });
    const live = { posts: [pristine.post] };
    const edited = { ...pristine.post };
    mutate(edited);
    for (const kind of ['seo', 'manual']) {
      const result = checkRecordPolicy({ kind,
        item: { dataset: 'posts', key: pristine.slug, op: 'update', payload: edited },
        ctx: {}, live, deps: { validateRecord } });
      assert.match(result.errors.join('; '), /refused/, `${name} ${kind} edit`);
    }
  }
});

test('B1 fixer refuses a banned tags repair and accepts a clean one', () => {
  const fixture = buildFixture({ now, units: threeUnits() });
  const candidates = [{ dataset: 'posts', key: fixture.slug, op: 'insert', payload: fixture.post }];
  const validate = makeRowRepairValidator({ kind: 'roundup', candidates, ctx: ctxFor(fixture),
    live: {}, deps: { validateRecord, news, lintMode: 'warn' } });
  const plan = (record) => ({ plan_type: 'record-repair', reason: 'roundup copy fix',
    files: [{ file: 'data/posts.json', records: [{ key: fixture.slug, record }] }] });
  const bad = validate(plan({ ...fixture.post, tags: [...fixture.post.tags, 'tickets $25'] }));
  assert.equal(bad.ok, false);
  assert.match(bad.errors.join('; '), /refused in tags/);
  const good = validate(plan({ ...fixture.post, tags: [...fixture.post.tags, 'weekend'] }));
  assert.equal(good.ok, true, good.errors.join('; '));
});

// ---------------------------------------------------------------------------
// B2: the scanner preserves renderer inline-link adjacency; URL targets are
// never prose. Errors are deterministic rule+field+count, no generated text.
// ---------------------------------------------------------------------------

test('B2 split-word inline links refuse through scanner, policy and fixer; renderer joins them', () => {
  for (const [copy, kind, rendered] of [
    ['Tickets are 20 dol[lars](/about) tonight.', 'price', '20 dollars'],
    ['Meet at 999 Imaginary Str[eet](/about).', 'civic-address', '999 Imaginary Street'],
  ]) {
    assert.ok(findRoundupBannedCopy(copy).some((span) => span.kind === kind), `scanner: ${copy}`);
    assert.ok(stripTags(renderMarkdownContent(copy)).includes(rendered), `renderer joins: ${rendered}`);
    const fixture = buildFixture({ now, units: threeUnits() });
    const tainted = { ...fixture.post, content: `${fixture.post.content}\n\n${copy}` };
    assert.match(checkRoundupRecordV2({ item: { key: fixture.slug }, record: tainted,
      ctx: ctxFor(fixture), news }).join('; '), /refused in content/, `submit: ${copy}`);
    const candidates = [{ dataset: 'posts', key: fixture.slug, op: 'insert', payload: fixture.post }];
    const validate = makeRowRepairValidator({ kind: 'roundup', candidates, ctx: ctxFor(fixture),
      live: {}, deps: { validateRecord, news, lintMode: 'fail' } });
    const result = validate({ plan_type: 'record-repair', reason: 'roundup copy fix',
      files: [{ file: 'data/posts.json', records: [{ key: fixture.slug, record: tainted }] }] });
    assert.equal(result.ok, false, `fixer: ${copy}`);
    assert.match(result.errors.join('; '), /refused in content/, `fixer: ${copy}`);
    assert.ok(!result.errors.join('; ').includes(rendered), 'no generated claim text retained');
  }
  // Relative link targets alone are never scanned.
  assert.deepEqual(findRoundupBannedCopy('See [details](/about) today.'), []);
  assert.deepEqual(checkRoundupVisibleCopy({ content: 'See [details](https://example.org/?price=$999) today.' }), []);
});
