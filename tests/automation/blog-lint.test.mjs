// Fixtures for the fail-closed claim linter.
//
// Two families, both from real evidence:
//   * the #97 class — a business's location asserted as an intersection, a bare
//     street, or a bearing off a landmark. It is exactly as specific as a civic
//     address and exactly as unverifiable, and the linter used to return ok:true.
//   * generic bold — headings, table labels and emphasis. Bold is the site's
//     emphasis mark, not an assertion that a business exists, and treating it as one
//     flagged most of the historical corpus on strings like "Best For" and "Pool".
//
// Plus the deterministic attribution formats the generator is required to emit, so
// coverage of an unbolded business comes from LOOKING THE NAME UP in the repository
// rather than from guessing which capitalised prose is a company.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { comparable, extractReferencedBusinesses, isBusinessMention, lintPost, resolveLintMode } from '../../scripts/blog-lint.mjs';

const BUSINESSES = [
  {
    slug: 'balzacs-coffee-liberty-village',
    name: "Balzac's Coffee Roasters",
    address: '171 East Liberty St Unit 130, Toronto, ON M6K 3P6',
    hours: 'Mon-Fri 7:00 AM - 7:00 PM',
    priceRange: '$',
  },
  {
    slug: 'mildreds-temple-kitchen',
    name: "Mildred's Temple Kitchen",
    address: '85 Hanna Ave #104, Toronto, ON M6K 3S3',
    hours: 'Sat-Sun 9:00 AM - 3:00 PM',
    priceRange: '$$$',
  },
];

const post = (over) => ({
  slug: 'liberty-village-guide',
  title: 'A Liberty Village guide',
  publishedAt: '2026-09-13T11:00:00.000Z',
  ...over,
});

const lint = (over) => lintPost(post(over), { businesses: BUSINESSES });
const rules = (over) => lint(over).findings.map((finding) => finding.rule);

// ---------------------------------------------------------------------------
// The #97 class: geography that is not a street number.
// ---------------------------------------------------------------------------
test('an intersection a record does not support is refused (the #97 reproducer)', () => {
  const result = lint({ content: "**Balzac's Coffee Roasters** sits where Hanna Ave meets Wellington St W." });
  assert.equal(result.ok, false, 'the linter must not return ok:true for fabricated intersection geography');
  assert.ok(result.findings.some((finding) => finding.rule === 'unsupported-address'));
  assert.match(result.findings[0].claim, /Hanna Ave/);
});

test('every unsupported geography shape a business can be given is refused', () => {
  const shapes = [
    "**Balzac's Coffee Roasters** is on Wellington Street West.",
    "**Balzac's Coffee Roasters** sits at the corner of Hanna Ave and Wellington St W.",
    "**Balzac's Coffee Roasters** is just north of the Metrolinx rail corridor.",
    "**Balzac's Coffee Roasters** is a two-minute walk from BMO Field.",
    "**Balzac's Coffee Roasters** is on the south side of Liberty Village Park.",
  ];
  for (const content of shapes) {
    assert.ok(rules({ content }).includes('unsupported-address'), `must refuse: ${content}`);
  }
});

test('geography the record does contain still passes, however it is spelled', () => {
  // The record says "171 East Liberty St"; the draft spells the street out. Same
  // fact, different typography — refusing that would be noise, not grounding.
  for (const content of [
    "**Balzac's Coffee Roasters** is at 171 East Liberty St Unit 130.",
    "**Balzac's Coffee Roasters** is on East Liberty Street.",
    "**Balzac's Coffee Roasters** opens 7 AM to 7 PM, Mon-Fri.",
  ]) {
    assert.deepEqual(lint({ content }).findings, [], `must accept: ${content}`);
  }
  assert.equal(comparable('171 East Liberty Street'), comparable('171 East Liberty St'));
  assert.equal(comparable('7:00 AM - 7:00 PM'), comparable('7 AM to 7 PM'));
});

test('an unattributed number belongs to no record and is not adjudicated', () => {
  assert.deepEqual(lint({ content: 'A TTC fare is $3.35 and the park covers 4,900 m².' }).findings, []);
});

// ---------------------------------------------------------------------------
// Generic bold is structure or emphasis, never a business claim.
// ---------------------------------------------------------------------------
test('bold headings, table labels and emphasis are not unrecorded businesses', () => {
  const corpus = [
    '**Getting there**\n\nTake the 504 King streetcar.',
    '| **Venue** | **Best For** | **Day Pass** |\n| --- | --- | --- |\n| Somewhere | Brunch | Yes |',
    'This is **Really Worth It** for anyone visiting.',
    '**Address**: 171 East Liberty St',
    '## **Where to start**',
    '**Pool**, **WiFi** and **Meeting Rooms** are all included.',
    '**Total: $950-1,500/month**',
    '**Post-July 2026**',
  ];
  for (const content of corpus) {
    assert.deepEqual(lint({ content }).findings, [], `generic bold must not be a business claim: ${content}`);
  }
});

test('a business-shaped bold name the repository has never recorded still fails closed', () => {
  assert.ok(rules({ content: '**Not In Records Cafe** is the neighbourhood favourite.' }).includes('unrecorded-business'));
  assert.ok(rules({ content: "**Dua's Delight** opened last spring." }).includes('unrecorded-business'));
  assert.equal(isBusinessMention('Not In Records Cafe', { line: '**Not In Records Cafe** is good.' }), true);
  assert.equal(isBusinessMention('Best For', { line: '| **Best For** |' }), false);
  assert.equal(isBusinessMention('Getting there', { line: '**Getting there**' }), false);
});

// ---------------------------------------------------------------------------
// Deterministic attribution: links, declared slugs, and recorded names.
// ---------------------------------------------------------------------------
test('a /directory/<slug> link attributes the claim and the slug must resolve', () => {
  const good = lint({ content: "[Balzac's](/directory/balzacs-coffee-liberty-village) is at 171 East Liberty St Unit 130." });
  assert.deepEqual(good.findings, []);

  const wrong = lint({ content: "[Balzac's](/directory/balzacs-coffee-liberty-village) is at 25 Hanna Ave." });
  assert.ok(wrong.findings.some((finding) => finding.rule === 'unsupported-address'),
    'a linked business is attributed, so its fabricated address is caught');

  const missing = lint({ content: '[Somewhere](/directory/no-such-business) is lovely.' });
  assert.ok(missing.findings.some((finding) => finding.rule === 'unrecorded-business'),
    'a directory link to a slug the repository does not have fails closed');
});

test('declared relatedBusinesses slugs must resolve to records', () => {
  assert.deepEqual(lint({ content: 'Nothing specific here.', relatedBusinesses: ['mildreds-temple-kitchen'] }).findings, []);
  const bad = lint({ content: 'Nothing specific here.', relatedBusinesses: ['ghost-cafe'] });
  assert.deepEqual(bad.findings.map((finding) => finding.rule), ['unrecorded-business']);
  assert.match(bad.findings[0].detail, /relatedBusinesses\[0\]/);
});

test('an unbolded, unlinked business is covered by looking its name up, not by guessing', () => {
  const result = lint({ content: "Mildred's Temple Kitchen is at 999 Nowhere Road and charges $42 for brunch." });
  const found = result.findings.map((finding) => finding.rule);
  assert.ok(found.includes('unsupported-address'), 'a recorded name in plain prose still attributes its claims');
  assert.ok(found.includes('unsupported-price'));
  // ...while prose that names no recorded business is never guessed at.
  assert.deepEqual(lint({ content: 'Some Unrecorded Place Downtown charges $42.' }).findings, []);
});

test('attribution is sentence-scoped, so a business does not adopt the next paragraph', () => {
  const content = "**Mildred's Temple Kitchen** is the neighbourhood's crown jewel.\n\n"
    + 'The neighbourhood parking meters run $4.25 an hour.';
  assert.deepEqual(lint({ content }).findings, [],
    'a price two sentences away is not a claim about the business named in the intro');
});

// ---------------------------------------------------------------------------
// The rollback lever stays a lever, not a default.
// ---------------------------------------------------------------------------
test('extractReferencedBusinesses is re-exported and finds exact recorded names across serializations', () => {
  const post = {
    slug: 'guide',
    title: 'A guide',
    content: 'Brazen Head Irish Pub at 165 East Liberty St. [Arvo](/directory/arvo-coffee) nearby.',
    relatedBusinesses: ['jimmys-coffee-liberty-village'],
  };
  const businesses = [
    { slug: 'brazen-head-irish-pub', name: 'Brazen Head Irish Pub' },
    { slug: 'arvo-coffee', name: 'Arvo Coffee' },
    { slug: 'jimmys-coffee-liberty-village', name: "Jimmy's Coffee" },
    { slug: 'unmentioned-cafe', name: 'Unmentioned Cafe' },
  ];
  const slugsOf = (source) => extractReferencedBusinesses(source, businesses).map((row) => row.slug).sort();
  const fromPost = slugsOf(post);
  const fromJson = slugsOf(JSON.stringify(post));
  assert.deepEqual(fromPost, ['arvo-coffee', 'brazen-head-irish-pub', 'jimmys-coffee-liberty-village']);
  assert.deepEqual(fromPost, fromJson);
  assert.deepEqual(extractReferencedBusinesses(post, null), []);
});

test('an operational slug/title premise fails without record support and passes when a record has it', () => {
  const cafe = {
    slug: 'paw-cafe',
    name: 'Paw Cafe',
    address: '1 Fraser Ave',
    hours: 'Mon-Sun 8am-6pm',
    tags: ['dog-friendly', 'pet-friendly'],
    description: 'Dogs are welcome on the patio.',
  };
  const unsupported = lintPost({
    slug: 'pet-friendly-cafes-liberty-village-2026',
    title: 'Pet-Friendly Cafes in Liberty Village',
    content: '**Paw Cafe** at 1 Fraser Ave is open Mon-Sun 8am-6pm.',
  }, { businesses: [{ slug: 'paw-cafe', name: 'Paw Cafe', address: '1 Fraser Ave', hours: 'Mon-Sun 8am-6pm' }] });
  assert.equal(unsupported.ok, false);
  assert.ok(unsupported.findings.some((finding) => finding.rule === 'unsupported-operational-premise'));

  const supported = lintPost({
    slug: 'pet-friendly-cafes-liberty-village-2026',
    title: 'Pet-Friendly Cafes in Liberty Village',
    content: '**Paw Cafe** at 1 Fraser Ave is dog-friendly. Hours are Mon-Sun 8am-6pm.',
  }, { businesses: [cafe] });
  assert.equal(supported.ok, true, JSON.stringify(supported.findings));
});

test('the linter is fail-closed by default and warn is opt-in only', () => {
  assert.equal(resolveLintMode({}), 'fail');
  assert.equal(resolveLintMode({ LINT_MODE: '' }), 'fail');
  assert.equal(resolveLintMode({ LINT_MODE: 'nonsense' }), 'fail');
  assert.equal(resolveLintMode({ LINT_MODE: 'WARN' }), 'warn');
  const source = fs.readFileSync(new URL('../../scripts/blog-lint.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /return\s+'warn'\s*;?\s*\n\s*}/, 'warn must never be the fallback branch');
});

test('the whole historical corpus still parses and the linter stays deterministic', () => {
  const posts = JSON.parse(fs.readFileSync(new URL('../../data/posts.json', import.meta.url), 'utf8'));
  const businesses = JSON.parse(fs.readFileSync(new URL('../../data/businesses.json', import.meta.url), 'utf8'));
  let flaggedByGenericBold = 0;
  for (const record of posts) {
    const first = lintPost(record, { businesses });
    const second = lintPost(record, { businesses });
    assert.deepEqual(first, second, `${record.slug}: the linter must be deterministic`);
    for (const finding of first.findings) {
      assert.equal(finding.severity, 'high');
      // The narrowing that matters: no heading, table label or emphasis may be
      // reported as a business the repository failed to record.
      if (finding.rule === 'unrecorded-business' && /^(Best For|Venue|Pool|Yes|Noise|WiFi|Monthly|Day Pass|Meeting Rooms)$/.test(finding.claim)) {
        flaggedByGenericBold += 1;
      }
    }
  }
  assert.equal(flaggedByGenericBold, 0, 'generic bold labels must no longer read as unrecorded businesses');
});
