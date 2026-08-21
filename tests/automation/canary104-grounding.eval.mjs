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
//
// Tests are tagged [RED] (expected to fail on clean origin/main until the
// implementation lands) or [GREEN] (already-working behaviour that must not
// regress into an overbroad ban).
// =============================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
const FIXTURES = new URL('../reliability/fixtures/pr104/', import.meta.url);

const readJson = (url) => JSON.parse(fs.readFileSync(url, 'utf8'));
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

test('[GREEN] pet-friendly premise passes when an attributed record supports the attribute', async () => {
  const lintPost = await loadExport('scripts/blog-lint.mjs', 'lintPost');
  const supported = [{
    slug: 'paw-cafe',
    name: 'Paw Cafe',
    address: '1 Fraser Ave, Toronto, ON M6K 1Y7',
    hours: 'Mon-Sun 8am-6pm',
    category: 'coffee-shops',
    tags: ['dog-friendly', 'pet-friendly', 'cafe'],
    description: 'Dogs are welcome on the patio. Water bowls are provided.',
  }];
  const result = lintPost(post({
    slug: 'pet-friendly-cafes-liberty-village-2026',
    title: 'Pet-Friendly Cafes in Liberty Village',
    description: 'Cafes whose directory records list a dog-friendly patio policy.',
    content: '**Paw Cafe** at 1 Fraser Ave is dog-friendly. Hours are Mon-Sun 8am-6pm.',
    tags: ['pet-friendly', 'cafes'],
  }), { businesses: supported });
  assert.equal(result.ok, true, `supported pet-friendly must pass; findings=${JSON.stringify(result.findings)}`);
});

// -----------------------------------------------------------------------------
// [RED] deleting the core premise while keeping immutable slug/image is
// preflight-unrepairable / abandoned, not a third rewrite.
// -----------------------------------------------------------------------------
test('[RED] premise-deleted repair that retains pet-friendly slug/image is unrepairable', async () => {
  const classifyFindings = await loadExport('scripts/automation/preflight.mjs', 'classifyFindings');
  const preflightDecision = await loadExport('scripts/automation/preflight.mjs', 'preflightDecision');
  const detect = await loadExport('scripts/automation/preflight.mjs', 'isUnrepairablePremiseAbandonment');
  const nextCandidateAction = await loadExport('scripts/automation/recovery.mjs', 'nextCandidateAction');

  assert.equal(typeof detect, 'function');
  assert.equal(detect(originalPost, originalPost), false, 'an unrepaired pet-friendly draft has not abandoned its premise');
  assert.equal(
    detect(originalPost, finalPost),
    true,
    'SHA 3850da18 deleted the pet premise from repairable fields while keeping the pet-friendly slug and image',
  );

  const outdoor = post({
    slug: 'liberty-village-outdoor-dining-patios-2026',
    title: 'Liberty Village Outdoor Dining Guide',
    image: '/images/blog/liberty-village-outdoor-dining-patios-2026.jpg',
    content: `**${brazenHead().name}** at 165 East Liberty St is open Mon-Sun 11am-2am.`,
  });
  assert.equal(detect(outdoor, outdoor), false, 'a grounded outdoor-dining post is not an abandoned pet premise');

  const finalCommit = audits.commits.find((row) => row.short === '3850da18');
  const verdict = {
    commit_sha: finalCommit.sha,
    overall: finalCommit.overall,
    findings: finalCommit.blocking,
  };
  const classified = classifyFindings('blog', verdict, { changedFiles: ['data/posts.json'] });
  assert.equal(classified.allUnrepairable, true, 'slug/image identity mismatch must classify as structurally unrepairable');

  const decision = preflightDecision({
    verdict,
    contentSha: verdict.commit_sha,
    attempts: 0,
    kind: 'blog',
    changedFiles: ['data/posts.json'],
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
