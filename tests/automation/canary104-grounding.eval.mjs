#!/usr/bin/env node
// =============================================================================
// EVALUATOR-OWNED ADDITIVE EVAL — PR #104 canary grounding contract.
//
// Authored by the independent eval/spec author. The builder MUST NOT edit,
// weaken, delete, re-scope, or skip any assertion in this file. Any change to
// this file by the builder is an automatic FAIL. Maker != checker.
//
// Evidence: tests/reliability/fixtures/pr104/
// Lock:     evals/canary104-grounding.sha256
//
// Run (offline, deterministic, zero model spend, no secrets):
//   node --test tests/automation/canary104-grounding.eval.mjs
//   (also invoked by the ordinary `npm run test:automation` CI command)
//
// Tests are tagged [RED] (expected to fail on clean origin/main until the
// implementation lands) or [GREEN] (already-working behaviour that must not
// regress into an overbroad ban or a weakened fail-closed preflight).
// =============================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
const FIXTURES = new URL('../reliability/fixtures/pr104/', import.meta.url);
const GATE_MODEL = 'claude-opus-5';
const MAX_REFERENCE_RECORDS = 40;

const readJson = (url) => JSON.parse(fs.readFileSync(url, 'utf8'));
const readRepoFile = (rel) => fs.readFileSync(new URL(rel, ROOT), 'utf8');
const repoFileExists = (rel) => fs.existsSync(new URL(rel, ROOT));

async function loadModule(rel) {
  if (!repoFileExists(rel)) {
    throw new Error(`NOT IMPLEMENTED: ${rel} does not exist`);
  }
  return import(new URL(rel, ROOT).href);
}

async function loadExport(rel, name) {
  const mod = await loadModule(rel);
  if (mod[name] === undefined) throw new Error(`NOT IMPLEMENTED: ${rel} does not export ${name}`);
  return mod[name];
}

// review-agent.mjs is a CLI: importing it with node --test as argv[2] trips
// "unknown command" and sets process.exitCode. Restore both so the eval's
// assertions are the only pass/fail signal.
async function loadSelectReferenceRecords() {
  const priorExit = process.exitCode;
  const log = console.log;
  const err = console.error;
  const quiet = (...args) => {
    const text = String(args[0] ?? '');
    if (/unknown command|Failure classified|fix_ok=|review_ok=/.test(text)) return;
    log(...args);
  };
  console.log = quiet;
  console.error = (...args) => {
    if (/unknown command/.test(String(args[0] ?? ''))) return;
    err(...args);
  };
  try {
    const fn = await loadExport('scripts/automation/review-agent.mjs', 'selectReferenceRecords');
    process.exitCode = priorExit ?? 0;
    return fn;
  } finally {
    console.log = log;
    console.error = err;
  }
}

const audits = readJson(new URL('gate-audits.json', FIXTURES));
const businesses = readJson(new URL('businesses-excerpts.json', FIXTURES));
const originalPost = readJson(new URL('e82a89d6-post.json', FIXTURES));
const finalPost = readJson(new URL('3850da18-post.json', FIXTURES));
const SIX = audits.six_repository_backed_claims.map((row) => row.slug);
const FINAL_COMMIT = audits.commits.find((row) => row.short === '3850da18');
const IDENTITY_FINDING = FINAL_COMMIT.blocking[0];
const SIX_MISSING_FINDING = FINAL_COMMIT.blocking[1];

function slugsOf(result) {
  const list = Array.isArray(result)
    ? result
    : Array.isArray(result?.records)
      ? result.records
      : Array.isArray(result?.slugs)
        ? result.slugs
        : [];
  return [...new Set(list.map((item) => (typeof item === 'string' ? item : item?.slug)).filter(Boolean))].sort();
}

function unifiedDiffForPost(post) {
  const body = JSON.stringify(post, null, 2).split('\n');
  return [
    'diff --git a/data/posts.json b/data/posts.json',
    '--- a/data/posts.json',
    '+++ b/data/posts.json',
    `@@ -0,0 +1,${body.length} @@`,
    ...body.map((line) => `+${line}`),
  ].join('\n');
}

function fixerPayload(post) {
  return JSON.stringify([{ file: 'data/posts.json', records: [post] }]);
}

function sameSet(a, b) {
  return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
}

function post(over) {
  return {
    slug: 'liberty-village-guide',
    title: 'A Liberty Village guide',
    description: 'Neighbourhood notes.',
    content: 'A walkable stretch of East Liberty Street.',
    publishedAt: '2026-08-21',
    updatedAt: '2026-08-21',
    category: 'food-drink',
    tags: ['patios'],
    ...over,
  };
}

function brazenHead() {
  return businesses.find((row) => row.slug === 'brazen-head-irish-pub');
}

function arvoCoffee() {
  return businesses.find((row) => row.slug === 'arvo-coffee');
}

function pawCafe() {
  return {
    slug: 'paw-cafe',
    name: 'Paw Cafe',
    address: '1 Fraser Ave, Toronto, ON M6K 1Y7',
    hours: 'Mon-Sun 8am-6pm',
    category: 'coffee-shops',
    tags: ['dog-friendly', 'pet-friendly', 'cafe'],
    description: 'Dogs are welcome on the patio. Water bowls are provided.',
  };
}

// Full trusted gate schema. `passed` is optional and ignored; it is omitted here
// so a fixture cannot talk past evaluateVerdict. Model is the live GATE_MODEL.
function trustedVerdict({ overall = FINAL_COMMIT.overall, findings, commit_sha = FINAL_COMMIT.sha, model = GATE_MODEL } = {}) {
  return { overall, findings, model, commit_sha };
}

function namedLimitError(error) {
  const blob = `${error?.name ?? ''}\n${error?.code ?? ''}\n${error?.message ?? ''}`;
  assert.match(
    blob,
    /MAX_REFERENCE_RECORDS/,
    `overflow must throw a named MAX_REFERENCE_RECORDS error; got ${blob.slice(0, 400)}`,
  );
}

function automationCommandCoversEval(command, workflowText) {
  const evalName = 'canary104-grounding.eval.mjs';
  if (command.includes(evalName) || workflowText.includes(evalName)) return true;
  if (/\*\.eval\.mjs/.test(command)) return true;
  if (/tests\/automation\/\*\.mjs\b/.test(command)) return true;
  if (/\*\.\{[^}]*eval[^}]*\}\.mjs/.test(command)) return true;
  return false;
}

// -----------------------------------------------------------------------------
// [GREEN] fixture lock — the canary evidence this eval is allowed to see.
// -----------------------------------------------------------------------------
test('[GREEN] PR #104 fixtures freeze the observed trajectory and six missing records', () => {
  assert.equal(audits.pr, 104);
  assert.deepEqual(audits.trajectory, [3.5, 4.5, 5.5, 3.5]);
  assert.equal(audits.terminal.decision, 'exhausted');
  assert.equal(audits.commits.length, 4);
  assert.equal(audits.commits.at(-1).reference_records, 5);
  assert.equal(audits.commits.at(-1).short, '3850da18');

  assert.equal(originalPost.slug, audits.immutable_identity.slug);
  assert.equal(finalPost.slug, audits.immutable_identity.slug);
  assert.equal(originalPost.image, audits.immutable_identity.image);
  assert.equal(finalPost.image, audits.immutable_identity.image);
  assert.match(originalPost.title, /pet-friendly|dog-friendly/i);
  assert.doesNotMatch(finalPost.title, /pet-friendly|dog/i);

  const bySlug = new Map(businesses.map((row) => [row.slug, row]));
  for (const claim of audits.six_repository_backed_claims) {
    const record = bySlug.get(claim.slug);
    assert.ok(record, `missing excerpt for ${claim.slug}`);
    assert.equal(record.name, claim.name);
    assert.match(record.address, new RegExp(claim.address.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  }
  for (const slug of audits.final_gate_reference_slugs) {
    assert.ok(bySlug.has(slug), `final-gate slug missing from excerpts: ${slug}`);
  }
  for (const slug of SIX) {
    assert.ok(!audits.final_gate_reference_slugs.includes(slug), `${slug} was in the five-record gate set`);
  }

  assert.equal(IDENTITY_FINDING.severity, 'high');
  assert.equal(IDENTITY_FINDING.path, 'data/posts.json');
  assert.match(IDENTITY_FINDING.note, /slug/i);
  assert.match(IDENTITY_FINDING.note, /image/i);
  assert.match(SIX_MISSING_FINDING.note, /six businesses/i);
});

// -----------------------------------------------------------------------------
// [GREEN] fail-closed trusted verdict: model + exact content SHA before classifier.
// -----------------------------------------------------------------------------
test('[GREEN] invalid, mismatched, or missing-model verdicts block before premise classification', async () => {
  const preflightDecision = await loadExport('scripts/automation/preflight.mjs', 'preflightDecision');
  const classifyFindings = await loadExport('scripts/automation/preflight.mjs', 'classifyFindings');
  const sha = FINAL_COMMIT.sha;
  const identityOnly = [IDENTITY_FINDING];
  const opts = {
    attempts: 0,
    kind: 'blog',
    changedFiles: ['data/posts.json'],
    original: originalPost,
    repaired: finalPost,
  };

  const missingModel = { overall: 3.5, findings: identityOnly, commit_sha: sha };
  assert.equal(
    preflightDecision({ verdict: missingModel, contentSha: sha, ...opts }),
    'block',
    'a fixture that omits model must block; it must not reach unrepairable via the premise classifier',
  );

  const mismatchedModel = trustedVerdict({ findings: identityOnly, model: 'claude-sonnet-4-5-20250929' });
  assert.equal(
    preflightDecision({ verdict: mismatchedModel, contentSha: sha, ...opts }),
    'block',
    'a non-Opus model must block before any premise classifier can return unrepairable',
  );

  const emptyModel = trustedVerdict({ findings: identityOnly, model: '' });
  assert.equal(preflightDecision({ verdict: emptyModel, contentSha: sha, ...opts }), 'block');

  const mismatchedSha = trustedVerdict({ findings: identityOnly });
  assert.equal(
    preflightDecision({ verdict: mismatchedSha, contentSha: '0'.repeat(40), ...opts }),
    'block',
    'content SHA mismatch must block before premise classification',
  );

  const missingSha = { overall: 3.5, findings: identityOnly, model: GATE_MODEL };
  assert.equal(preflightDecision({ verdict: missingSha, contentSha: sha, ...opts }), 'block');

  // Mixed live canary notes must not become all-unrepairable just because one
  // identity finding sits next to a repairable grounding miss.
  const mixed = trustedVerdict({ findings: FINAL_COMMIT.blocking });
  const classified = classifyFindings('blog', mixed, {
    changedFiles: ['data/posts.json'],
    original: originalPost,
    repaired: finalPost,
  });
  assert.equal(
    classified.allUnrepairable,
    false,
    'one unrepairable identity note among other repairable blocking findings must not set allUnrepairable',
  );
});

test('[GREEN] benign slug/image notes stay repairable and do not short-circuit the ladder', async () => {
  const classifyFindings = await loadExport('scripts/automation/preflight.mjs', 'classifyFindings');
  const preflightDecision = await loadExport('scripts/automation/preflight.mjs', 'preflightDecision');
  const sha = FINAL_COMMIT.sha;
  const benign = [
    {
      severity: 'high',
      path: 'data/posts.json',
      note: 'slug is fine, image alt missing',
    },
    {
      severity: 'high',
      path: 'data/posts.json',
      note: 'consider a different image',
    },
  ];

  for (const finding of benign) {
    const verdict = trustedVerdict({ findings: [finding], commit_sha: sha });
    const classified = classifyFindings('blog', verdict, {
      changedFiles: ['data/posts.json'],
      original: originalPost,
      repaired: finalPost,
    });
    assert.equal(classified.allUnrepairable, false, `${finding.note} must not be structurally unrepairable`);
    assert.equal(classified.repairable.length, 1, `${finding.note} must remain repairable`);
    assert.equal(
      preflightDecision({
        verdict,
        contentSha: sha,
        attempts: 0,
        kind: 'blog',
        changedFiles: ['data/posts.json'],
        original: originalPost,
        repaired: finalPost,
      }),
      'repair',
      `${finding.note} must not short-circuit as unrepairable`,
    );
  }

  const mixedPath = trustedVerdict({
    findings: [
      { severity: 'high', path: 'tasks/seo-data-latest.json', note: 'provenance does not match content' },
      { severity: 'high', path: 'data/posts.json', note: 'unsupported price in content' },
    ],
  });
  const classified = classifyFindings('blog', mixedPath, {
    changedFiles: ['data/posts.json', 'tasks/seo-data-latest.json'],
  });
  assert.equal(classified.allUnrepairable, false, 'a mix of unrepairable and repairable paths is not allUnrepairable');
  assert.ok(classified.unrepairable.length >= 1);
  assert.ok(classified.repairable.length >= 1);
});

// -----------------------------------------------------------------------------
// [RED] one shared trusted reference-extraction contract.
// -----------------------------------------------------------------------------
test('[RED] extractReferencedBusinesses is the shared lint/gate/fixer contract', async () => {
  const extract = await loadExport('scripts/blog-lint.mjs', 'extractReferencedBusinesses');
  assert.equal(typeof extract, 'function');

  const fromPost = slugsOf(extract(finalPost, businesses));
  const fromDiff = slugsOf(extract(unifiedDiffForPost(finalPost), businesses));
  const fromFixer = slugsOf(extract(fixerPayload(finalPost), businesses));

  assert.ok(fromPost.length > 0, 'post object produced an empty slug set');
  assert.ok(sameSet(fromPost, fromDiff), 'unified-diff slug set diverged from the post object');
  assert.ok(sameSet(fromPost, fromFixer), 'fixer-payload slug set diverged from the post object');
  for (const slug of SIX) {
    assert.ok(fromPost.includes(slug), `shared extractor missed repository-backed claim ${slug}`);
  }
});

test('[RED] selectReferenceRecords supplies the six final-SHA claims on every serialization', async () => {
  const select = await loadSelectReferenceRecords();
  const shapes = {
    'post-json': JSON.stringify(finalPost),
    'unified-diff': unifiedDiffForPost(finalPost),
    'fixer-payload': fixerPayload(finalPost),
  };
  const sets = {};
  for (const [label, source] of Object.entries(shapes)) {
    const slugs = slugsOf(select(source, businesses));
    sets[label] = slugs;
    for (const slug of SIX) {
      assert.ok(slugs.includes(slug), `${label} omitted ${slug}; gate would falsely flag a repository-backed address/hours claim`);
    }
  }
  assert.ok(sameSet(sets['post-json'], sets['unified-diff']));
  assert.ok(sameSet(sets['post-json'], sets['fixer-payload']));

  let extract = null;
  try {
    extract = await loadExport('scripts/blog-lint.mjs', 'extractReferencedBusinesses');
  } catch {
    extract = null;
  }
  if (extract) {
    const trusted = slugsOf(extract(finalPost, businesses));
    assert.ok(sameSet(trusted, sets['fixer-payload']), 'gate/fixer selectReferenceRecords diverged from extractReferencedBusinesses');
  }
});

test('[RED] relatedPosts and generic quoted slugs are not business attribution', async () => {
  const extract = await loadExport('scripts/blog-lint.mjs', 'extractReferencedBusinesses');
  const select = await loadSelectReferenceRecords();
  const venue = brazenHead();
  const quotedOnly = post({
    content: 'A walkable stretch of East Liberty Street.',
    relatedPosts: [venue.slug, 'arvo-coffee'],
    relatedTopics: ['arvo-coffee'],
    tags: [venue.slug],
  });
  const quotedSlugs = slugsOf(extract(quotedOnly, businesses));
  assert.ok(!quotedSlugs.includes(venue.slug), 'relatedPosts must not count as business attribution');
  assert.ok(!quotedSlugs.includes('arvo-coffee'), 'a generic quoted slug must not count as business attribution');
  assert.ok(!slugsOf(select(JSON.stringify(quotedOnly), businesses)).includes(venue.slug));
  assert.ok(!slugsOf(select(fixerPayload(quotedOnly), businesses)).includes('arvo-coffee'));

  const allowed = [
    ['factual name', post({ content: `${venue.name} at 165 East Liberty St has a wraparound patio.` })],
    ['directory link', post({ content: `See [${venue.name}](/directory/${venue.slug}) for hours.` })],
    ['relatedBusinesses', post({ content: 'Neighbourhood notes.', relatedBusinesses: [venue.slug] })],
    ['bold name', post({ content: `**${venue.name}** at 165 East Liberty St is open Mon-Sun 11am-2am.` })],
  ];
  for (const [label, sample] of allowed) {
    const slugs = slugsOf(extract(sample, businesses));
    assert.ok(slugs.includes(venue.slug), `${label} must attribute ${venue.slug}; got ${slugs.join(',') || '(none)'}`);
  }
});

test('[RED] reference selection fails closed when extracted records exceed MAX_REFERENCE_RECORDS', async () => {
  const select = await loadSelectReferenceRecords();
  const many = Array.from({ length: MAX_REFERENCE_RECORDS + 1 }, (_, index) => ({
    slug: `synthetic-venue-${String(index + 1).padStart(2, '0')}`,
    name: `Synthetic Venue ${String(index + 1).padStart(2, '0')} Cafe`,
    address: `${index + 1} Fraser Ave, Toronto, ON M6K 1Y7`,
    hours: 'Mon-Sun 8am-6pm',
    category: 'coffee-shops',
  }));
  const sample = post({
    slug: 'liberty-village-synthetic-directory-overflow-2026',
    title: 'Liberty Village cafe roll call',
    content: many.map((row) => `**${row.name}** at ${row.address}. Hours are ${row.hours}.`).join('\n'),
  });
  const sources = [JSON.stringify(sample), unifiedDiffForPost(sample), fixerPayload(sample)];

  for (const source of sources) {
    assert.throws(
      () => select(source, many),
      (error) => {
        namedLimitError(error);
        return true;
      },
      'selectReferenceRecords must throw rather than drop the tail of a >40 set',
    );
  }

  let extract = null;
  try {
    extract = await loadExport('scripts/blog-lint.mjs', 'extractReferencedBusinesses');
  } catch {
    extract = null;
  }
  if (extract) {
    let extracted;
    try {
      extracted = extract(sample, many);
    } catch (error) {
      namedLimitError(error);
      return;
    }
    const slugs = slugsOf(extracted);
    assert.equal(slugs.length, many.length, 'extractReferencedBusinesses must not silently truncate; return all records or throw');
    for (const row of many) {
      assert.ok(slugs.includes(row.slug), `extractor dropped ${row.slug}`);
    }
  }
});

// -----------------------------------------------------------------------------
// [RED] operational-attribute premise must fail pre-PR when no record supports it.
// [GREEN] grounded outdoor-dining, and record-supported pet-friendly, still pass.
// -----------------------------------------------------------------------------
test('[RED] operational-attribute slug/title premises fail pre-PR lint without record support', async () => {
  const lintPost = await loadExport('scripts/blog-lint.mjs', 'lintPost');
  const unsupported = [
    {
      label: 'pet-friendly',
      sample: originalPost,
      needle: /pet|dog|operational|premise|attribute|policy/i,
    },
    {
      label: 'happy-hour',
      sample: post({
        slug: 'liberty-village-happy-hour-guide-2026',
        title: 'Liberty Village Happy Hour Guide',
        description: 'Where to find the best happy hour specials.',
        content: `**Arvo Coffee** at 17 Fraser Ave runs a weekday happy hour. Hours are Mon-Fri 7:30am-4pm, Sat-Sun 8:30am-4pm.`,
        tags: ['happy-hour', 'bars'],
      }),
      needle: /happy hour|operational|premise|attribute|policy/i,
    },
    {
      label: 'accessibility',
      sample: post({
        slug: 'wheelchair-accessible-restaurants-liberty-village-2026',
        title: 'Wheelchair Accessible Restaurants in Liberty Village',
        description: 'A guide to accessible dining rooms and step-free patios.',
        content: `**Arvo Coffee** at 17 Fraser Ave is fully wheelchair accessible. Hours are Mon-Fri 7:30am-4pm, Sat-Sun 8:30am-4pm.`,
        tags: ['accessibility'],
      }),
      needle: /accessib|wheelchair|operational|premise|attribute|policy/i,
    },
    {
      label: 'reservations',
      sample: post({
        slug: 'restaurants-that-take-reservations-liberty-village-2026',
        title: 'Liberty Village Restaurants That Take Reservations',
        description: 'Book a table at neighbourhood restaurants that accept reservations.',
        content: `**Arvo Coffee** at 17 Fraser Ave takes reservations seven days a week. Hours are Mon-Fri 7:30am-4pm, Sat-Sun 8:30am-4pm.`,
        tags: ['reservations'],
      }),
      needle: /reservation|operational|premise|attribute|policy/i,
    },
  ];

  for (const row of unsupported) {
    const result = lintPost(row.sample, { businesses });
    assert.equal(result.ok, false, `${row.label} premise must fail pre-PR when no attributed record supports it`);
    const blob = JSON.stringify(result.findings);
    assert.ok(row.needle.test(blob), `${row.label} findings must name the unsupported operational attribute; got ${blob.slice(0, 400)}`);
  }
});

test('[RED] operational premise support is per attributed business, not inherited from a peer', async () => {
  const lintPost = await loadExport('scripts/blog-lint.mjs', 'lintPost');
  const supported = pawCafe();
  const unsupportedPeer = {
    ...arvoCoffee(),
    tags: ['coffee'],
    description: 'Australian-style coffee. No pet policy on file.',
  };
  const result = lintPost(post({
    slug: 'pet-friendly-cafes-liberty-village-2026',
    title: 'Pet-Friendly Cafes in Liberty Village',
    description: 'Cafes that welcome dogs on the patio.',
    content: [
      `**${supported.name}** at 1 Fraser Ave is dog-friendly. Hours are Mon-Sun 8am-6pm.`,
      `**${unsupportedPeer.name}** at 17 Fraser Ave is dog-friendly. Hours are Mon-Fri 7:30am-4pm, Sat-Sun 8:30am-4pm.`,
    ].join('\n'),
    tags: ['pet-friendly', 'cafes'],
  }), { businesses: [supported, unsupportedPeer] });

  assert.equal(
    result.ok,
    false,
    'one supported pet-friendly record must not license pet-policy claims for unsupported peers',
  );
  const blob = JSON.stringify(result.findings);
  assert.match(blob, /pet|dog|operational|premise|attribute|policy/i);
  assert.match(blob, /Arvo|arvo-coffee/i);
});

test('[GREEN] grounded outdoor-dining content still passes the claim linter', async () => {
  const lintPost = await loadExport('scripts/blog-lint.mjs', 'lintPost');
  const venue = brazenHead();
  const result = lintPost(post({
    slug: 'liberty-village-outdoor-dining-patios-2026',
    title: 'Liberty Village Outdoor Dining Guide: Patios and Beer Gardens',
    description: 'Patios along East Liberty Street with addresses and hours from the directory.',
    content: `**${venue.name}** at 165 East Liberty St has a wraparound patio. Hours are Mon-Sun 11am-2am.`,
    answerBlock: `${venue.name} at 165 East Liberty St is open Mon-Sun 11am-2am.`,
    tags: ['patios', 'outdoor-dining'],
  }), { businesses });
  assert.equal(result.ok, true, `outdoor-dining must remain publishable when addresses/hours match records; findings=${JSON.stringify(result.findings)}`);
});

test('[GREEN] pet-friendly premise passes when each attributed record supports the attribute', async () => {
  const lintPost = await loadExport('scripts/blog-lint.mjs', 'lintPost');
  const supported = pawCafe();
  const result = lintPost(post({
    slug: 'pet-friendly-cafes-liberty-village-2026',
    title: 'Pet-Friendly Cafes in Liberty Village',
    description: 'Cafes whose directory records list a dog-friendly patio policy.',
    content: '**Paw Cafe** at 1 Fraser Ave is dog-friendly. Hours are Mon-Sun 8am-6pm.',
    tags: ['pet-friendly', 'cafes'],
  }), { businesses: [supported] });
  assert.equal(result.ok, true, `supported pet-friendly must pass; findings=${JSON.stringify(result.findings)}`);
});

// -----------------------------------------------------------------------------
// [RED] deleting the core premise while keeping immutable slug/image is
// preflight-unrepairable / abandoned, not a third rewrite. Narrow: only when
// slug/image encode a controlled operational premise AND repaired topic/body
// materially delete it. Mixed repairable findings stay mixed.
// -----------------------------------------------------------------------------
test('[RED] premise abandonment is narrow and only all-unrepairable when every blocking finding is', async () => {
  const classifyFindings = await loadExport('scripts/automation/preflight.mjs', 'classifyFindings');
  const preflightDecision = await loadExport('scripts/automation/preflight.mjs', 'preflightDecision');
  const detect = await loadExport('scripts/automation/preflight.mjs', 'isUnrepairablePremiseAbandonment');
  const nextCandidateAction = await loadExport('scripts/automation/recovery.mjs', 'nextCandidateAction');

  assert.equal(typeof detect, 'function');
  assert.equal(detect(originalPost, originalPost), false, 'an unrepaired pet-friendly draft has not abandoned its premise');
  assert.equal(
    detect(originalPost, finalPost),
    true,
    'SHA 3850da18 deleted the pet premise from repairable topic/body while keeping the pet-friendly slug and image',
  );

  const outdoor = post({
    slug: 'liberty-village-outdoor-dining-patios-2026',
    title: 'Liberty Village Outdoor Dining Guide',
    image: '/images/blog/liberty-village-outdoor-dining-patios-2026.jpg',
    content: `**${brazenHead().name}** at 165 East Liberty St is open Mon-Sun 11am-2am.`,
  });
  assert.equal(detect(outdoor, outdoor), false, 'a grounded outdoor-dining post is not an abandoned pet premise');
  assert.equal(
    detect(outdoor, { ...outdoor, title: 'Liberty Village Patio Hours', content: 'Patio notes along East Liberty Street.' }),
    false,
    'changing topic/body without an operational premise in slug/image is not unrepairable abandonment',
  );
  assert.equal(
    detect(originalPost, {
      ...originalPost,
      title: originalPost.title,
      description: originalPost.description,
      content: originalPost.content,
      tags: originalPost.tags,
    }),
    false,
    'keeping the user-visible pet premise is not abandonment',
  );

  const sha = FINAL_COMMIT.sha;
  const context = {
    changedFiles: ['data/posts.json'],
    original: originalPost,
    repaired: finalPost,
  };

  const mixedVerdict = trustedVerdict({ findings: FINAL_COMMIT.blocking });
  const mixed = classifyFindings('blog', mixedVerdict, context);
  assert.equal(
    mixed.allUnrepairable,
    false,
    'the live 3850da18 mix (identity mismatch + missing reference records) is not allUnrepairable',
  );
  assert.ok(
    mixed.unrepairable.some((finding) => finding.note === IDENTITY_FINDING.note),
    'the slug/image identity mismatch must be structurally unrepairable',
  );
  assert.ok(
    mixed.repairable.some((finding) => finding.note === SIX_MISSING_FINDING.note),
    'unsupported named-business facts remain repairable by supplying the missing records',
  );
  assert.equal(
    preflightDecision({
      verdict: mixedVerdict,
      contentSha: sha,
      attempts: 0,
      kind: 'blog',
      ...context,
    }),
    'repair',
    'mixed live canary findings must still attempt repair; they must not skip the fixer as unrepairable',
  );

  const identityVerdict = trustedVerdict({ findings: [IDENTITY_FINDING] });
  const identityOnly = classifyFindings('blog', identityVerdict, context);
  assert.equal(identityOnly.allUnrepairable, true, 'a lone slug/image operational-premise identity mismatch is all-unrepairable');
  const decision = preflightDecision({
    verdict: identityVerdict,
    contentSha: sha,
    attempts: 0,
    kind: 'blog',
    ...context,
  });
  assert.equal(decision, 'unrepairable');

  const ladder = nextCandidateAction({
    attempts: 0,
    blockDecision: decision,
    regenerations: 0,
  });
  assert.notEqual(ladder.action, 'repair', 'an unrepairable premise abandonment must not enter another fixer rewrite');
  assert.ok(
    ['abandon-topic', 'close-and-regenerate', 'wait'].includes(ladder.action),
    `expected abandon/regenerate/wait, got ${ladder.action}`,
  );
});

// -----------------------------------------------------------------------------
// [RED] this live regression cannot silently leave ordinary automation CI.
// -----------------------------------------------------------------------------
test('[RED] the additive canary eval is part of the ordinary automation CI command', () => {
  const pkg = JSON.parse(readRepoFile('package.json'));
  const workflow = readRepoFile('.github/workflows/autonomous-coordinator.yml');
  const command = String(pkg.scripts?.['test:automation'] ?? '');
  assert.ok(
    automationCommandCoversEval(command, workflow),
    `ordinary CI must invoke tests/automation/canary104-grounding.eval.mjs via package.json test:automation or the coordinator workflow; test:automation=${JSON.stringify(command)}`,
  );
});
