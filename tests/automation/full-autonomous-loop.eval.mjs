#!/usr/bin/env node
// =============================================================================
// EVALUATOR-OWNED JOURNEY EVAL — full autonomous content publishing loop.
//
// Authored by the independent eval/spec author. The builder MUST NOT edit,
// weaken, delete, re-scope, or skip any assertion in this file. Any change to
// this file by the builder is an automatic FAIL. Maker != checker.
//
// Contract: docs/automation/full-autonomous-content-loop-prd.md
// Journey:  docs/automation/full-autonomous-content-loop-journey.md
// Lock:     evals/full-autonomous-content-loop.sha256
//
// Run (offline, deterministic, zero model spend, no secrets):
//   node --test tests/automation/full-autonomous-loop.eval.mjs
//
// Opt-in live canary (read-only GitHub, still zero model spend):
//   LV_LIVE_CANARY=1 LV_CANARY_REPO=jonkthomas/libertyvillage \
//     node --test tests/automation/full-autonomous-loop.eval.mjs
//
// Tests are tagged [RED] (expected to fail on clean origin/main until the
// implementation lands) or [GREEN] (already-working behaviour that must not be
// rebuilt or regressed). The RED baseline is recorded in the PRD.
// =============================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const ROOT = new URL('../../', import.meta.url);
const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const SHA_C = 'c'.repeat(40);
const REPO = 'jonkthomas/libertyvillage';

const readRepoFile = (rel) => fs.readFileSync(new URL(rel, ROOT), 'utf8');
const repoFileExists = (rel) => fs.existsSync(new URL(rel, ROOT));

// Every not-yet-built surface fails its OWN test with a legible message instead
// of exploding the whole file at import time.
async function loadModule(rel) {
  if (!repoFileExists(rel)) {
    throw new Error(`NOT IMPLEMENTED: ${rel} does not exist (see docs/automation/full-autonomous-content-loop-prd.md)`);
  }
  return import(new URL(rel, ROOT).href);
}

async function loadExport(rel, name) {
  const mod = await loadModule(rel);
  if (mod[name] === undefined) throw new Error(`NOT IMPLEMENTED: ${rel} does not export ${name}`);
  return mod[name];
}

const coordinatorYml = readRepoFile('.github/workflows/autonomous-coordinator.yml');
const blogYml = readRepoFile('.github/workflows/weekly-blog.yml');
const sentinelYml = readRepoFile('.github/workflows/blocked-sentinel.yml');
const coordinatorSrc = readRepoFile('scripts/automation/coordinator.mjs');
const reviewAgentSrc = readRepoFile('scripts/automation/review-agent.mjs');

// -----------------------------------------------------------------------------
// Deterministic GitHub Actions job-graph simulator.
//
// Parses the real coordinator workflow and evaluates each job's `if:` expression
// against a synthetic needs-context, so terminal-state guarantees are *executed*
// rather than grepped. Supports the expression subset the workflow actually uses:
// always(), &&, ||, !, ==, !=, parentheses, string literals, needs.<job>.result,
// needs.<job>.outputs.<key>, github.event.client_payload.<key>.
// -----------------------------------------------------------------------------
function parseJobs(yamlText) {
  const body = yamlText.slice(yamlText.indexOf('\njobs:\n') + 1);
  const headers = [...body.matchAll(/^ {2}([A-Za-z0-9_-]+):\s*$/gm)];
  const jobs = new Map();
  for (const [index, header] of headers.entries()) {
    const start = header.index;
    const end = index + 1 < headers.length ? headers[index + 1].index : body.length;
    const text = body.slice(start, end);
    const ifMatch = /^ {4}if:\s*(.+)$/m.exec(text);
    const needsMatch = /^ {4}needs:\s*([\s\S]*?)(?=^ {4}[a-z-]+:)/m.exec(text);
    jobs.set(header[1], {
      name: header[1],
      text,
      if: ifMatch ? ifMatch[1].trim() : null,
      needs: needsMatch ? (needsMatch[1].match(/[A-Za-z][A-Za-z0-9_-]*/g) || []) : [],
    });
  }
  return jobs;
}

function tokenize(expression) {
  const source = expression.replace(/^\$\{\{/, '').replace(/\}\}$/, '').trim();
  const tokens = [];
  let i = 0;
  while (i < source.length) {
    const char = source[i];
    if (/\s/.test(char)) { i += 1; continue; }
    if (char === "'") {
      const end = source.indexOf("'", i + 1);
      if (end === -1) throw new Error(`unterminated string in: ${source}`);
      tokens.push({ type: 'string', value: source.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    const two = source.slice(i, i + 2);
    if (two === '&&' || two === '||' || two === '==' || two === '!=') {
      tokens.push({ type: 'op', value: two });
      i += 2;
      continue;
    }
    if (char === '(' || char === ')' || char === '!') { tokens.push({ type: 'op', value: char }); i += 1; continue; }
    const word = /^[A-Za-z0-9_.[\]-]+/.exec(source.slice(i));
    if (!word) throw new Error(`unexpected character ${char} in: ${source}`);
    tokens.push({ type: 'word', value: word[0] });
    i += word[0].length;
  }
  return tokens;
}

function evaluateExpression(expression, context) {
  const tokens = tokenize(expression);
  let position = 0;
  const peek = () => tokens[position];
  const eat = (value) => {
    if (peek() && peek().value === value) { position += 1; return true; }
    return false;
  };
  const truthy = (value) => (typeof value === 'string' ? value.length > 0 : Boolean(value));

  function resolve(pathText) {
    if (pathText === 'true') return true;
    if (pathText === 'false') return false;
    const parts = pathText.split('.');
    if (parts[0] === 'needs') {
      const job = parts[1];
      if (parts[2] === 'result') return context.results.get(job) ?? 'skipped';
      if (parts[2] === 'outputs') {
        if (context.results.get(job) !== 'success') return '';
        return context.outputs?.[job]?.[parts[3]] ?? '';
      }
      return '';
    }
    if (pathText.startsWith('github.event.client_payload.')) {
      return context.payload?.[parts.at(-1)] ?? '';
    }
    return '';
  }

  function primary() {
    if (eat('(')) {
      const value = or();
      if (!eat(')')) throw new Error(`missing ) in: ${expression}`);
      return value;
    }
    if (eat('!')) return !truthy(primary());
    const token = peek();
    if (!token) throw new Error(`unexpected end of: ${expression}`);
    position += 1;
    if (token.type === 'string') return token.value;
    // always()/success()/failure()/cancelled() arrive as `always` + `(` + `)`.
    if (eat('(')) {
      if (!eat(')')) throw new Error(`only zero-arg status functions are supported: ${expression}`);
      if (token.value === 'always') return true;
      if (token.value === 'success') return context.needsAllSucceeded;
      if (token.value === 'failure') return !context.needsAllSucceeded;
      if (token.value === 'cancelled') return false;
      throw new Error(`unsupported function ${token.value}() in: ${expression}`);
    }
    return resolve(token.value);
  }

  function comparison() {
    let left = primary();
    while (peek() && (peek().value === '==' || peek().value === '!=')) {
      const op = peek().value;
      position += 1;
      const right = primary();
      left = op === '==' ? left === right : left !== right;
    }
    return left;
  }

  function and() {
    let left = comparison();
    while (eat('&&')) { const right = comparison(); left = truthy(left) ? right : left; }
    return left;
  }

  function or() {
    let left = and();
    while (eat('||')) { const right = and(); left = truthy(left) ? left : right; }
    return left;
  }

  const value = or();
  if (position !== tokens.length) throw new Error(`trailing tokens in: ${expression}`);
  return truthy(value);
}

function topoSort(jobs) {
  const order = [];
  const seen = new Set();
  const visit = (name, stack = new Set()) => {
    if (seen.has(name) || !jobs.has(name)) return;
    if (stack.has(name)) throw new Error(`cycle at ${name}`);
    stack.add(name);
    for (const need of jobs.get(name).needs) visit(need, stack);
    stack.delete(name);
    seen.add(name);
    order.push(name);
  };
  for (const name of jobs.keys()) visit(name);
  return order;
}

// scenario: { payload, outputs, forced } — `forced` maps a job to the result it
// produces when it runs (default 'success'); everything else is derived.
function simulateRun(jobs, scenario) {
  const results = new Map();
  const context = { results, outputs: scenario.outputs || {}, payload: scenario.payload || {} };
  for (const name of topoSort(jobs)) {
    const job = jobs.get(name);
    const needsAllSucceeded = job.needs.every((need) => results.get(need) === 'success');
    let gate = needsAllSucceeded;
    if (job.if) {
      gate = evaluateExpression(job.if, { ...context, needsAllSucceeded });
      if (gate && !/\b(always|failure|cancelled)\(\)/.test(job.if)) gate = needsAllSucceeded;
    }
    results.set(name, gate ? (scenario.forced?.[name] || 'success') : 'skipped');
  }
  return results;
}

const TERMINAL_JOB = /^(pass|block|validation-failed)-(generator|promotion)$/;
const CONTINUATION_JOB = /^(apply-generator-repair|heal-generator-base)$/;

function outcomeOf(results) {
  const ran = (name) => results.get(name) !== 'skipped';
  const terminal = [...results.keys()].filter((name) => TERMINAL_JOB.test(name) && ran(name));
  const continuation = [...results.keys()].filter((name) => CONTINUATION_JOB.test(name) && results.get(name) === 'success');
  return { terminal, continuation, total: terminal.length + continuation.length };
}

const jobs = parseJobs(coordinatorYml);

const GENERATOR_OK = { trusted: 'true', can_repair: 'true', can_heal: 'true', pr_number: '99', head_sha: SHA_A };

// =============================================================================
// 0. Gate integrity — the Opus >=8 / zero-high-or-critical bar is NOT negotiable
// =============================================================================
test('[GREEN] gate constants are unchanged: Opus, threshold 8, blocking severities', async () => {
  const constants = await loadModule('scripts/automation/constants.mjs');
  assert.equal(constants.GATE_MODEL, 'claude-opus-5');
  assert.equal(constants.SCORE_THRESHOLD, 8);
  assert.deepEqual([...constants.BLOCKING_SEVERITIES], ['critical', 'high']);
  assert.equal(constants.MAX_REPAIRS, 3);
  assert.equal(constants.MAX_HEALS, 2);
  assert.deepEqual([...constants.TRUSTED_PR_AUTHORS], ['github-actions[bot]']);
});

test('[GREEN] the gate decision is recomputed server-side and cannot be talked past', async () => {
  const { evaluateVerdict } = await loadModule('scripts/automation/policy.mjs');
  const verdict = (over, findings) => ({
    overall: over, findings, model: 'claude-opus-5', commit_sha: SHA_A, passed: true,
  });
  assert.equal(evaluateVerdict(verdict(7.9, []), SHA_A).passed, false, '7.9 must never pass');
  const high = [{ severity: 'high', path: 'data/posts.json', note: 'fabricated address' }];
  assert.equal(evaluateVerdict(verdict(9.9, high), SHA_A).passed, false, 'a high finding must never pass');
  const clean = { ...verdict(8.1, [{ severity: 'low', path: 'data/posts.json', note: 'nit' }]) };
  assert.equal(evaluateVerdict(clean, SHA_A).passed, true);
  assert.equal(evaluateVerdict(clean, SHA_B).passed, false, 'verdict must be bound to the exact SHA');
});

test('[RED] verdict schema tolerates historical `passed` but always derives the decision itself', async () => {
  const { evaluateVerdict } = await loadModule('scripts/automation/policy.mjs');
  const base = { overall: 8.4, findings: [], model: 'claude-opus-5', commit_sha: SHA_A };
  const withoutPassed = evaluateVerdict({ ...base }, SHA_A);
  assert.equal(withoutPassed.ok, true, '`passed` must be optional so the gate cannot self-declare');
  assert.equal(withoutPassed.passed, true);
  const lying = evaluateVerdict({ ...base, passed: false }, SHA_A);
  assert.equal(lying.ok, true, 'a self-declared `passed` must be ignored, not rejected');
  assert.equal(lying.passed, true, 'the decision comes from overall + findings only');
  const lyingUp = evaluateVerdict({
    ...base, overall: 6.1, findings: [{ severity: 'high', path: 'data/posts.json', note: 'x' }], passed: true,
  }, SHA_A);
  assert.equal(lyingUp.passed, false);
  assert.doesNotMatch(reviewAgentSrc, />= 8\b/, 'the review prompt must interpolate SCORE_THRESHOLD, not hardcode 8');
});

// =============================================================================
// 1. Grounded claim preflight (fail-closed, before a PR ever exists)
// =============================================================================
const BUSINESS_RECORDS = [
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

const groundedPost = {
  slug: 'liberty-village-brunch-guide',
  title: 'Where to eat brunch in Liberty Village',
  publishedAt: '2026-09-13T11:00:00.000Z',
  content: "**Balzac's Coffee Roasters** sits at 171 East Liberty St Unit 130 and opens Mon-Fri 7:00 AM - 7:00 PM.",
  faqs: [{ question: 'Where can I get brunch?', answer: "**Mildred's Temple Kitchen** is at 85 Hanna Ave #104." }],
  keyTakeaways: ['Liberty Village brunch spots cluster around East Liberty Street.'],
};

test('[RED] the blog claim linter rejects every frozen fabrication class and accepts a grounded draft', async () => {
  const lintPost = await loadExport('scripts/blog-lint.mjs', 'lintPost');
  const lint = (post) => lintPost(post, { businesses: BUSINESS_RECORDS });
  const rules = (post) => new Set(lint(post).findings.map((finding) => finding.rule));

  const clean = lint(groundedPost);
  assert.equal(clean.ok, true, `a fully grounded draft must pass: ${JSON.stringify(clean.findings)}`);

  // #97: geography the record contradicts.
  assert.ok(rules({
    ...groundedPost,
    content: "**Balzac's Coffee Roasters** sits at 25 Hanna Ave where Hanna Ave meets Wellington St W.",
  }).has('unsupported-address'), 'an address absent from the record must be flagged');

  // #72/#52: invented prices and hours.
  assert.ok(rules({ ...groundedPost, content: "**Mildred's Temple Kitchen** brunch runs $18-$24 a plate." })
    .has('unsupported-price'), 'a dollar amount absent from the record must be flagged');
  assert.ok(rules({ ...groundedPost, content: "**Balzac's Coffee Roasters** is open 6:00 AM - 11:00 PM daily." })
    .has('unsupported-hours'), 'an hour range absent from the record must be flagged');

  // Fail-closed on a business the repo has never recorded.
  assert.ok(rules({ ...groundedPost, content: '**Not In Records Cafe** is the neighbourhood favourite.' })
    .has('unrecorded-business'), 'an unrecorded business must fail closed, by design');

  // #75: Labour Day 2026 is Monday September 7, not September 1.
  assert.ok(rules({ ...groundedPost, content: 'Come by over Labour Day weekend (September 1).' })
    .has('unsupported-date'), 'a holiday date that disagrees with the calendar must be flagged');
});

test('[RED] the linter defaults to fail-closed and runs before the blog PR is committed', async () => {
  const resolveLintMode = await loadExport('scripts/blog-lint.mjs', 'resolveLintMode');
  assert.equal(resolveLintMode({}), 'fail', 'an unset LINT_MODE must fail closed');
  assert.equal(resolveLintMode({ LINT_MODE: 'nonsense' }), 'fail', 'an invalid LINT_MODE must fail closed');
  assert.equal(resolveLintMode({ LINT_MODE: 'warn' }), 'warn', 'the documented rollback flag must exist');

  const lintStep = blogYml.indexOf('blog-lint.mjs');
  const commitStep = blogYml.indexOf('git commit');
  assert.ok(lintStep > 0, 'weekly-blog.yml must run the claim linter');
  assert.ok(lintStep < commitStep, 'the linter must run BEFORE the draft is committed to a branch');
});

// =============================================================================
// 2. Unrepairable PR-file exclusion
// =============================================================================
test('[RED] no generator can ship a scored file its fixer is structurally unable to repair', async () => {
  const { KIND_POLICIES } = await loadModule('scripts/automation/constants.mjs');
  const isBinaryAsset = (rule) => /^public\/images\//.test(rule);
  for (const [kind, policy] of Object.entries(KIND_POLICIES)) {
    if (kind === 'promotion') continue; // promotion is never repaired; it is re-cut from staging.
    for (const rule of policy.allowedPaths) {
      if (isBinaryAsset(rule)) continue;
      assert.ok(
        policy.repairablePaths.some((repairable) => rule === repairable || rule.startsWith(repairable)),
        `${kind} allows ${rule} into the scored diff but cannot repair it — guaranteed exhaustion`,
      );
    }
  }
});

test('[RED] the blog PR carries content only — no provenance files in the scored diff', async () => {
  const { KIND_POLICIES } = await loadModule('scripts/automation/constants.mjs');
  assert.deepEqual(
    KIND_POLICIES.blog.allowedPaths.filter((rule) => rule.startsWith('tasks/')), [],
    'tasks/* must not be in the blog PR: it is scored but not repairable',
  );
  const addStep = /git add ([^\n]*)/.exec(blogYml);
  assert.ok(addStep, 'weekly-blog.yml must stage its content explicitly');
  assert.doesNotMatch(addStep[1], /tasks\//, 'weekly-blog.yml must stop staging tasks/ provenance files');
});

// =============================================================================
// 3. Repair by deletion (the only repair that cannot invent a fresh claim)
// =============================================================================
test('[RED] the fixer is instructed to resolve unsupported specifics by deletion, never substitution', () => {
  const prompt = reviewAgentSrc.slice(
    reviewAgentSrc.indexOf('function recordRepairPrompt'),
    reviewAgentSrc.indexOf('async function planRecordRepair'),
  );
  assert.match(prompt, /remov|delet/i, 'repair-by-deletion must be an explicit instruction');
  assert.match(prompt, /never by substituting|not by substituting|never substitute/i,
    'substitution must be explicitly forbidden for unsupported-specific findings');
  assert.match(prompt, /UNTRUSTED_REFERENCE_DATA/,
    'the fixer must adjudicate against the same reference records as the gate');
});

test('[GREEN] a deletion repair passes record validation and strictly shrinks the claim surface', async () => {
  const { validatePostRepair } = await loadModule('scripts/automation/preflight.mjs');
  const original = {
    slug: 'liberty-village-brunch-guide', title: 'Brunch guide', description: 'Brunch in Liberty Village.',
    content: "**Mildred's Temple Kitchen** brunch runs $18-$24 from 9:00 AM - 3:00 PM.",
    publishedAt: '2026-09-13T11:00:00.000Z', updatedAt: '2026-09-13T11:00:00.000Z',
    category: 'food-drink', image: '/images/blog/brunch.jpg', author: 'Liberty Village Local',
    tags: ['brunch'], answerBlock: 'Brunch is easy here.', faqs: [], keyTakeaways: ['Brunch is easy here.'],
    relatedServices: [], relatedTopics: [], relatedPosts: [],
  };
  const repaired = { ...original, content: "**Mildred's Temple Kitchen** serves brunch." };
  const result = validatePostRepair(original, repaired);
  assert.equal(result.ok, true, result.errors.join('; '));
  const specifics = (text) => (text.match(/\$\d|\d{1,2}:\d{2}\s?(?:AM|PM)/gi) || []).length;
  assert.ok(specifics(repaired.content) < specifics(original.content), 'a deletion repair must reduce specifics');
  assert.deepEqual(result.changedFields, ['content'], 'deletion must stay inside the repairable field');
});

// =============================================================================
// 4. Non-improvement handling — bounded, no oscillation
// =============================================================================
test('[RED] a non-improving or self-harming repair round abandons the candidate instead of burning budget', async () => {
  const evaluateRepairProgress = await loadExport('scripts/automation/recovery.mjs', 'evaluateRepairProgress');
  const improving = evaluateRepairProgress({
    history: [{ attempt: 0, overall: 6.5, blockingCount: 2 }, { attempt: 1, overall: 7.4, blockingCount: 1 }],
  });
  assert.equal(improving.decision, 'continue');

  // #97: 7.2 -> 6.5. #75: 5.0 -> 4.5.
  const regressed = evaluateRepairProgress({
    history: [{ attempt: 0, overall: 7.2, blockingCount: 1 }, { attempt: 1, overall: 6.5, blockingCount: 1 }],
  });
  assert.equal(regressed.decision, 'abandon', 'a score regression must stop the repair loop');

  // #97 attempt 3: the fixer introduced a NEW high severity finding.
  const newBlocking = evaluateRepairProgress({
    history: [{ attempt: 0, overall: 7.4, blockingCount: 0 }, { attempt: 1, overall: 7.5, blockingCount: 1 }],
  });
  assert.equal(newBlocking.decision, 'abandon', 'a fixer-introduced blocking finding must stop the repair loop');
  assert.match(String(newBlocking.reason), /blocking/i);

  const flat = evaluateRepairProgress({
    history: [{ attempt: 0, overall: 7.4, blockingCount: 1 }, { attempt: 1, overall: 7.4, blockingCount: 1 }],
  });
  assert.equal(flat.decision, 'continue', 'a flat round is still within the bounded budget');
});

// =============================================================================
// 5. Validation failure: visible terminal state + autonomous recovery
// =============================================================================
test('[RED] a validation throw still produces exactly one visible terminal outcome (generator)', () => {
  const results = simulateRun(jobs, {
    payload: { kind: 'blog' },
    outputs: {},
    forced: { 'validate-generator': 'failure' },
  });
  const outcome = outcomeOf(results);
  assert.equal(outcome.total, 1,
    `a validation throw must not leave an invisible PR; ran: ${JSON.stringify(outcome)}`);
  assert.equal(results.get('validation-failed-generator'), 'success',
    'validation-failed-generator must label, status, and comment when validation throws');
});

test('[RED] a validation throw still produces exactly one visible terminal outcome (promotion)', () => {
  const results = simulateRun(jobs, {
    payload: { kind: 'promotion' },
    outputs: {},
    forced: { 'validate-promotion': 'failure' },
  });
  const outcome = outcomeOf(results);
  assert.equal(outcome.total, 1, `a promotion validation throw must be visible; ran: ${JSON.stringify(outcome)}`);
  assert.equal(results.get('validation-failed-promotion'), 'success');
});

test('[RED] the validation-failed jobs are mutually exclusive with the block jobs and are deduplicated', () => {
  const generator = jobs.get('validation-failed-generator');
  const promotion = jobs.get('validation-failed-promotion');
  assert.ok(generator, 'missing job validation-failed-generator');
  assert.ok(promotion, 'missing job validation-failed-promotion');
  assert.match(generator.if, /always\(\)/);
  assert.match(generator.if, /needs\.validate-generator\.result != 'success'/);
  assert.match(promotion.if, /always\(\)/);
  assert.match(promotion.if, /needs\.validate-promotion(-pr)?\.result != 'success'/);
  assert.match(generator.text, /automation-blocked/, 'a validation failure must label the PR');
  assert.match(generator.text, /coordinator\.mjs status|automation\/ci|automation\/opus-gate/,
    'a validation failure must publish a head status');
  assert.match(generator.text, /automation-audit|validation-failed/,
    'a validation failure must post a deduplicated audit marker');
});

test('[GREEN] every ordinary generator path already ends in exactly one outcome', () => {
  const scenarios = {
    'gate pass': {
      payload: { kind: 'blog' },
      outputs: {
        'validate-generator': GENERATOR_OK,
        'generator-review': { review_ok: 'true', passed: 'true', overall: '8.3' },
      },
      expect: 'pass-generator',
    },
    'gate block, repair budget exhausted': {
      payload: { kind: 'blog' },
      outputs: {
        'validate-generator': { ...GENERATOR_OK, can_repair: 'false' },
        'generator-review': { review_ok: 'true', passed: 'false', overall: '7.4' },
      },
      expect: 'block-generator',
    },
    'repair round redispatches': {
      payload: { kind: 'blog' },
      outputs: {
        'validate-generator': GENERATOR_OK,
        'generator-review': { review_ok: 'true', passed: 'false', overall: '7.2' },
        'generator-fixer': { fix_ok: 'true' },
      },
      expect: 'apply-generator-repair',
    },
    'base conflict heals and redispatches': {
      payload: { kind: 'blog' },
      outputs: { 'validate-generator': GENERATOR_OK },
      forced: { 'generator-ci': 'failure' },
      expect: 'heal-generator-base',
    },
    'base conflict with heal budget exhausted': {
      payload: { kind: 'blog' },
      outputs: { 'validate-generator': { ...GENERATOR_OK, can_heal: 'false' } },
      forced: { 'generator-ci': 'failure' },
      expect: 'block-generator',
    },
    'heal itself fails': {
      payload: { kind: 'blog' },
      outputs: { 'validate-generator': GENERATOR_OK },
      forced: { 'generator-ci': 'failure', 'heal-generator-base': 'failure' },
      expect: 'block-generator',
    },
  };
  for (const [name, scenario] of Object.entries(scenarios)) {
    const results = simulateRun(jobs, scenario);
    const outcome = outcomeOf(results);
    assert.equal(outcome.total, 1, `${name}: expected exactly one outcome, got ${JSON.stringify(outcome)}`);
    assert.equal(results.get(scenario.expect), 'success', `${name}: expected ${scenario.expect}`);
  }
});

// =============================================================================
// 6. Transient CI / model failure retries itself, boundedly
// =============================================================================
test('[RED] transient infrastructure failures are classified and retried within a hard bound', async () => {
  const recovery = await loadModule('scripts/automation/recovery.mjs');
  const { classifyRunFailure, nextRetry, MAX_TRANSIENT_RETRIES } = recovery;
  assert.ok(typeof classifyRunFailure === 'function', 'NOT IMPLEMENTED: recovery.mjs must export classifyRunFailure');
  assert.equal(Number.isInteger(MAX_TRANSIENT_RETRIES) && MAX_TRANSIENT_RETRIES > 0, true);
  assert.ok(MAX_TRANSIENT_RETRIES <= 3, 'the transient retry budget must stay small and bounded');

  for (const message of [
    'GitHub API 502: Bad gateway',
    'GitHub API 503: Service Unavailable',
    'GitHub API 429: rate limit exceeded',
    'agent failed closed: error_during_execution',
    'ETIMEDOUT connecting to api.github.com',
  ]) assert.equal(classifyRunFailure(new Error(message)), 'transient', `should be transient: ${message}`);

  for (const message of [
    'pull request rejected: forbidden path: .github/workflows/weekly-blog.yml',
    'invalid gate verdict: passed does not match the enforced score/severity decision',
    'untrusted pull request author: someone-else',
    'repair rejected before write: repair byte budget exceeded',
  ]) assert.equal(classifyRunFailure(new Error(message)), 'terminal', `should be terminal: ${message}`);

  assert.equal(nextRetry({ attempts: 0, classification: 'transient' }).action, 'retry');
  assert.equal(nextRetry({ attempts: MAX_TRANSIENT_RETRIES, classification: 'transient' }).action, 'block',
    'the transient retry budget must terminate in a visible block, never a hot loop');
  assert.equal(nextRetry({ attempts: 0, classification: 'terminal' }).action, 'block');
  const backoff = nextRetry({ attempts: 1, classification: 'transient' });
  assert.ok(Number.isFinite(backoff.delaySeconds) && backoff.delaySeconds > 0, 'retries must back off');
});

// =============================================================================
// 7. Exhausted candidate: close and regenerate a FRESH grounded candidate
// =============================================================================
test('[RED] an exhausted candidate is closed and regenerated on a later bounded retry — never hot-looped', async () => {
  const recovery = await loadModule('scripts/automation/recovery.mjs');
  const { nextCandidateAction, MAX_CANDIDATE_REGENERATIONS, REGENERATION_COOLDOWN_HOURS } = recovery;
  assert.ok(typeof nextCandidateAction === 'function', 'NOT IMPLEMENTED: recovery.mjs must export nextCandidateAction');
  assert.ok(REGENERATION_COOLDOWN_HOURS >= 24, 'regeneration must wait at least a full cycle — no hot loop');
  assert.ok(MAX_CANDIDATE_REGENERATIONS >= 1 && MAX_CANDIDATE_REGENERATIONS <= 3, 'regeneration must be bounded');

  const now = Date.parse('2026-09-20T11:00:00.000Z');
  const hoursAgo = (hours) => new Date(now - hours * 3600_000).toISOString();
  const call = (over) => nextCandidateAction({
    attempts: 3, maxRepairs: 3, regenerations: 0, blockedAt: hoursAgo(48), now, ...over,
  });

  assert.equal(call({ attempts: 1 }).action, 'repair', 'budget remains: keep repairing this candidate');
  assert.equal(call({ blockedAt: hoursAgo(1) }).action, 'wait',
    'an exhausted candidate must cool down before regeneration — no immediate re-generation loop');
  const regenerate = call({});
  assert.equal(regenerate.action, 'close-and-regenerate');
  assert.equal(regenerate.closeCandidate, true, 'the failed candidate must be closed, not left open forever');
  assert.notEqual(regenerate.reuseDraft, true, 'the retry must be a FRESH grounded candidate, not the failed draft');
  assert.equal(call({ regenerations: MAX_CANDIDATE_REGENERATIONS }).action, 'abandon-topic',
    'regeneration itself must be bounded and end in a human-visible abandonment');
  assert.equal(call({ attempts: 3, healExhausted: true, blockedAt: hoursAgo(48) }).action, 'close-and-regenerate',
    'an unhealable base conflict is also an exhausted candidate');
  // Never a forced low-quality publish.
  for (const over of [{}, { attempts: 3 }, { regenerations: MAX_CANDIDATE_REGENERATIONS }, { blockedAt: hoursAgo(1) }]) {
    assert.notEqual(call(over).action, 'publish', 'the loop must never force-publish a blocked candidate');
    assert.notEqual(call(over).lowerThreshold, true, 'the loop must never lower the gate');
  }
});

test('[RED] a verdict whose blocking findings are all unrepairable short-circuits without spending the fixer', async () => {
  const preflight = await loadModule('scripts/automation/preflight.mjs');
  const { classifyFindings, preflightDecision } = preflight;
  assert.ok(typeof classifyFindings === 'function', 'NOT IMPLEMENTED: preflight.mjs must export classifyFindings');

  const verdict = (findings) => ({
    overall: 7.1, findings, model: 'claude-opus-5', commit_sha: SHA_A, passed: false,
  });
  const unrepairable = verdict([
    { severity: 'high', path: 'tasks/seo-data-latest.json', note: 'provenance does not match content' },
    { severity: 'high', path: 'data/posts.json', note: 'slug duplicates an existing post' },
  ]);
  const classified = classifyFindings('blog', unrepairable, { changedFiles: ['data/posts.json', 'tasks/seo-data-latest.json'] });
  assert.equal(classified.allUnrepairable, true, 'non-repairable paths and immutable-field errors are foregone conclusions');
  assert.equal(
    preflightDecision({ verdict: unrepairable, contentSha: SHA_A, attempts: 0 }),
    'unrepairable',
    'an all-unrepairable verdict must skip the fixer entirely instead of burning 3 x 4 attempts',
  );

  const repairable = verdict([{ severity: 'high', path: 'data/posts.json', note: 'unsupported price in content' }]);
  assert.equal(classifyFindings('blog', repairable, { changedFiles: ['data/posts.json'] }).allUnrepairable, false);
  assert.equal(preflightDecision({ verdict: repairable, contentSha: SHA_A, attempts: 0 }), 'repair',
    'when in doubt the classifier must bias towards attempting the repair');
});

test('[GREEN] the bounded repair budget itself is unchanged', async () => {
  const { canRepair, readRepairAttempt } = await loadModule('scripts/automation/policy.mjs');
  assert.equal(readRepairAttempt([{ name: 'automation-repair-2' }]), 2);
  assert.equal(canRepair(2), true);
  assert.equal(canRepair(3), false);
  assert.throws(() => readRepairAttempt([{ name: 'automation-repair-1' }, { name: 'automation-repair-2' }]),
    /multiple controlled repair labels/);
});

// =============================================================================
// 8. Merge conflict recovery
// =============================================================================
test('[GREEN] a both-appended staging conflict heals inside its own bounded budget', async () => {
  const { planBaseHeal, resolveAppendUnion } = await loadModule('scripts/automation/heal-base.mjs');
  const { canHeal, readHealAttempt } = await loadModule('scripts/automation/policy.mjs');
  assert.equal(planBaseHeal('blog', ['data/posts.json']).ok, true);
  assert.equal(planBaseHeal('blog', ['data/posts.json', 'public/images/blog/x.jpg']).ok, false,
    'a non-record conflict must refuse and fall through to the block path');
  const serialize = (records) => `${JSON.stringify(records, null, 2)}\n`;
  const base = [{ slug: 'a', title: 'A' }];
  const ours = [...base, { slug: 'ours', title: 'Ours' }];
  const theirs = [...base, { slug: 'theirs', title: 'Theirs' }];
  const union = resolveAppendUnion('data/posts.json', {
    baseText: serialize(base), oursText: serialize(ours), theirsText: serialize(theirs),
  });
  assert.equal(union.ok, true, (union.errors || []).join('; '));
  assert.deepEqual(union.appendedSlugs, ['ours']);
  assert.equal(readHealAttempt([{ name: 'automation-heal-1' }]), 1);
  assert.equal(canHeal(2), false, 'the heal budget is hard-bounded at MAX_HEALS');
});

test('[RED] an unhealable conflict hands the candidate to the regeneration policy, not to a human queue', async () => {
  const nextCandidateAction = await loadExport('scripts/automation/recovery.mjs', 'nextCandidateAction');
  const now = Date.parse('2026-09-20T11:00:00.000Z');
  const decision = nextCandidateAction({
    attempts: 0, maxRepairs: 3, regenerations: 0, healExhausted: true,
    blockedAt: new Date(now - 48 * 3600_000).toISOString(), now,
  });
  assert.equal(decision.action, 'close-and-regenerate');
});

// =============================================================================
// 9. Exact-SHA race
// =============================================================================
test('[GREEN] every decision is pinned to an exact SHA and a raced head is rejected', async () => {
  const { validatePullRequest, evaluateObservedMerge, evaluateGeneratorBase } = await loadModule('scripts/automation/policy.mjs');
  const pr = {
    state: 'open', draft: false, labels: [],
    head: { ref: 'blog/auto-1', sha: SHA_A, repo: { full_name: REPO } },
    base: { ref: 'staging', repo: { full_name: REPO } },
    user: { login: 'github-actions[bot]' },
  };
  const good = validatePullRequest({ repository: REPO, kind: 'blog', expectedSha: SHA_A, pr, files: ['data/posts.json'] });
  assert.equal(good.ok, true, good.errors.join('; '));
  const raced = validatePullRequest({
    repository: REPO, kind: 'blog', expectedSha: SHA_A,
    pr: { ...pr, head: { ...pr.head, sha: SHA_B } }, files: ['data/posts.json'],
  });
  assert.equal(raced.ok, false);
  assert.ok(raced.errors.some((error) => /SHA does not match/.test(error)));

  assert.equal(evaluateObservedMerge({
    pr: { head: { sha: SHA_A }, merged: true, base: { ref: 'staging' }, merge_commit_sha: SHA_B }, expectedSha: SHA_A, stagingSha: SHA_B,
  }), 'dispatch');
  assert.equal(evaluateObservedMerge({
    pr: { head: { sha: SHA_A }, merged: true, base: { ref: 'staging' }, merge_commit_sha: SHA_B }, expectedSha: SHA_A, stagingSha: SHA_C,
  }), 'superseded', 'a staging advance must defer to the newer serialized run, never double-promote');
  assert.throws(() => evaluateObservedMerge({ pr: { head: { sha: SHA_C }, merged: false }, expectedSha: SHA_A }),
    /head changed/);
  assert.equal(evaluateGeneratorBase({ expectedSha: SHA_A, prHeadSha: SHA_A, stagingSha: SHA_B, stagingAheadBy: 2 }), 'refresh');
});

test('[RED] the generator review diff is pinned to merge_base...head like the promotion review already is', () => {
  const reviewFn = reviewAgentSrc.slice(reviewAgentSrc.indexOf('async function review('), reviewAgentSrc.indexOf('async function reviewContent'));
  assert.match(reviewFn, /merge_base|mergeBase/,
    'the generator review must fetch /compare/${merge_base}...${sha} so a raced base cannot change the scored diff');
});

// =============================================================================
// 10. Promotion dispatch loss + scheduled sweep
// =============================================================================
test('[RED] a lost promotion dispatch is swept up automatically, at most once per tick', async () => {
  const planPromotionSweep = await loadExport('scripts/automation/recovery.mjs', 'planPromotionSweep');
  const now = Date.parse('2026-09-20T11:00:00.000Z');
  const hoursAgo = (hours) => new Date(now - hours * 3600_000).toISOString();
  const call = (over) => planPromotionSweep({
    aheadBy: 3, stagingHeadAt: hoursAgo(30), openPromotionPrs: [], lastDispatchAt: null, now,
    stagingSha: SHA_A, ...over,
  });

  const dispatched = call({});
  assert.equal(dispatched.action, 'dispatch', 'main behind staging for >24h with no open promotion PR must self-heal');
  assert.equal(dispatched.sha, SHA_A, 'the sweep must dispatch the live staging head as an exact SHA');
  assert.equal(call({ aheadBy: 0 }).action, 'skip', 'nothing to promote');
  assert.equal(call({ stagingHeadAt: hoursAgo(2) }).action, 'skip', 'the ordinary fire-and-forget path gets first refusal');
  assert.equal(call({ openPromotionPrs: [{ number: 120 }] }).action, 'skip', 'never duplicate an in-flight promotion');
  assert.equal(call({ lastDispatchAt: hoursAgo(0.2) }).action, 'skip', 'at most one dispatch per tick — no dispatch storm');
});

test('[RED] the promotion sweep is a real scheduled workflow, not a hand-run script', () => {
  assert.ok(repoFileExists('.github/workflows/promotion-sweep.yml'),
    'NOT IMPLEMENTED: .github/workflows/promotion-sweep.yml');
  const sweep = readRepoFile('.github/workflows/promotion-sweep.yml');
  assert.match(sweep, /schedule:\s*\n\s*- cron:/, 'the sweep must run on a schedule');
  assert.match(sweep, /workflow_dispatch:/, 'the sweep must also be manually runnable');
  assert.match(sweep, /coordinator\.mjs dispatch|promotion-sweep\.mjs|recovery\.mjs/);
});

// =============================================================================
// 11. Auto-merge observation timeout must not create a contradictory state
// =============================================================================
test('[RED] the observe-and-promote timeout is non-fatal and never relabels a merging PR as blocked', () => {
  const observe = coordinatorSrc.slice(
    coordinatorSrc.indexOf('async function observeAndPromote'),
    coordinatorSrc.indexOf('const commands = {'),
  );
  assert.doesNotMatch(observe, /throw new Error\('timed out waiting for native auto-merge/,
    'a slow-but-merging PR must not be turned into automation-blocked while auto-merge is still armed');
  assert.match(observe, /writeOutput\(/, 'the timeout must record an observable outcome and exit 0');
  assert.match(observe, /observ|timeout|handoff|sweep/i, 'the timeout must hand off to the sweep explicitly');
});

// =============================================================================
// 12. Orphan PR detection (the independent tripwire on the whole guarantee)
// =============================================================================
test('[RED] the sentinel detects automation PRs that never reached a terminal state', async () => {
  const selectOrphanAutomationPrs = await loadExport('scripts/automation/blocked-sentinel.mjs', 'selectOrphanAutomationPrs');
  const now = Date.parse('2026-09-20T11:00:00.000Z');
  const hoursAgo = (hours) => new Date(now - hours * 3600_000).toISOString();
  const items = [
    { number: 101, state: 'open', pull_request: {}, user: { login: 'github-actions[bot]' }, labels: [], updated_at: hoursAgo(30), statusContexts: [] },
    { number: 102, state: 'open', pull_request: {}, user: { login: 'github-actions[bot]' }, labels: [], updated_at: hoursAgo(30), statusContexts: ['automation/ci'] },
    { number: 103, state: 'open', pull_request: {}, user: { login: 'github-actions[bot]' }, labels: [{ name: 'automation-blocked' }], updated_at: hoursAgo(30), statusContexts: [] },
    { number: 104, state: 'open', pull_request: {}, user: { login: 'github-actions[bot]' }, labels: [], updated_at: hoursAgo(2), statusContexts: [] },
    { number: 32, state: 'open', pull_request: {}, user: { login: 'jonkthomas' }, labels: [], updated_at: hoursAgo(900), statusContexts: ['Vercel'] },
  ];
  const orphans = selectOrphanAutomationPrs(items, { now, staleHours: 24 }).map((pr) => pr.number);
  assert.deepEqual(orphans, [101],
    'only bot-authored PRs with no automation status, no automation label, idle > 24h are orphans');
});

test('[RED] the sentinel workflow actually runs the orphan pass and stays read-only', () => {
  assert.match(sentinelYml, /ORPHAN|orphan/, 'the sentinel workflow must run the orphan pass');
  const permissions = sentinelYml.slice(sentinelYml.indexOf('permissions:'), sentinelYml.indexOf('steps:'));
  assert.doesNotMatch(permissions, /write/, 'the sentinel stays strictly read-only');
});

test('[GREEN] the stale blocked-PR sweep still works and the label lives in one place', async () => {
  const { selectStaleBlockedPrs } = await loadModule('scripts/automation/blocked-sentinel.mjs');
  const now = Date.parse('2026-09-20T11:00:00.000Z');
  const items = [
    { number: 7, state: 'open', pull_request: {}, labels: [{ name: 'automation-blocked' }], updated_at: new Date(now - 30 * 3600_000).toISOString(), title: 'blog' },
    { number: 8, state: 'open', pull_request: {}, labels: [{ name: 'automation-blocked' }], updated_at: new Date(now - 2 * 3600_000).toISOString(), title: 'seo' },
  ];
  assert.deepEqual(selectStaleBlockedPrs(items, { now }).map((pr) => pr.number), [7]);
});

test('[RED] the blocked label has exactly one binding site', async () => {
  const constants = await loadModule('scripts/automation/constants.mjs');
  assert.equal(constants.BLOCKED_LABEL, 'automation-blocked',
    'NOT IMPLEMENTED: BLOCKED_LABEL must be bound in constants.mjs, not duplicated per module');
  const sentinelSrc = readRepoFile('scripts/automation/blocked-sentinel.mjs');
  assert.match(sentinelSrc, /BLOCKED_LABEL[^\n]*constants\.mjs|from '\.\/constants\.mjs'/,
    'the sentinel must import the label rather than redeclaring the string');
  assert.match(coordinatorSrc, /BLOCKED_LABEL/,
    'the coordinator must label from the same binding the sentinel reads');
});

// =============================================================================
// 13. Destructive-diff guard at merge time
// =============================================================================
test('[RED] a diff that drops slug-keyed records is rejected before merge, with a human escape hatch', async () => {
  const validateDestructiveDiff = await loadExport('scripts/automation/policy.mjs', 'validateDestructiveDiff');
  const serialize = (records) => `${JSON.stringify(records, null, 2)}\n`;
  const baseRecords = [{ slug: 'a', name: 'A' }, { slug: 'b', name: 'B' }, { slug: 'c', name: 'C' }];
  const file = 'data/businesses.json';
  const sources = (head) => ({ [file]: { baseText: serialize(baseRecords), headText: serialize(head) } });

  // PR #8 replay: 85 records dropped by a whole-file rewrite.
  const dropped = validateDestructiveDiff({
    kind: 'business', files: [file], sources: sources([{ slug: 'a', name: 'A' }]), labels: [],
  });
  assert.equal(dropped.ok, false, 'a dropped base record must hard-fail at merge time');
  assert.ok(dropped.errors.some((error) => /dropped|delete/i.test(error)));

  // #86 / #92 replay: append + modify must pass untouched.
  const appended = validateDestructiveDiff({
    kind: 'business', files: [file],
    sources: sources([...baseRecords, { slug: 'd', name: 'D' }]), labels: [],
  });
  assert.equal(appended.ok, true, (appended.errors || []).join('; '));
  const modified = validateDestructiveDiff({
    kind: 'business', files: [file],
    sources: sources([{ slug: 'a', name: 'A2' }, { slug: 'b', name: 'B' }, { slug: 'c', name: 'C' }]), labels: [],
  });
  assert.equal(modified.ok, true, (modified.errors || []).join('; '));

  // The escape hatch is human-applied and must be loud.
  const allowed = validateDestructiveDiff({
    kind: 'business', files: [file], sources: sources([{ slug: 'a', name: 'A' }]),
    labels: [{ name: 'allow-record-deletion' }],
  });
  assert.equal(allowed.ok, true, 'a human-applied allow-record-deletion label permits the deletion');
  assert.equal(allowed.overridden, true, 'the override must be reported so the audit comment can say so loudly');

  const { ALLOW_RECORD_DELETION_LABEL } = await loadModule('scripts/automation/constants.mjs');
  assert.equal(ALLOW_RECORD_DELETION_LABEL, 'allow-record-deletion');
});

test('[RED] the merge-time guard is wired into pull-request validation for every kind', () => {
  const policySrc = readRepoFile('scripts/automation/policy.mjs');
  const validate = policySrc.slice(policySrc.indexOf('export function validatePullRequest'), policySrc.indexOf('export function evaluateVerdict'));
  assert.match(validate, /validateDestructiveDiff|destructive/,
    'validatePullRequest must run the destructive-diff guard, not only the fixer path');
});

// =============================================================================
// 14. Final staging -> main promotion
// =============================================================================
test('[GREEN] the promotion path still ends in exactly one outcome and is SHA-pinned', async () => {
  const { validatePromotionRange } = await loadModule('scripts/automation/policy.mjs');
  const happy = simulateRun(jobs, {
    payload: { kind: 'promotion' },
    outputs: {
      'validate-promotion': { trusted: 'true', no_changes: 'false', head_sha: SHA_A, main_sha: SHA_B },
      'validate-promotion-pr': { trusted: 'true', pr_number: '120', head_sha: SHA_A },
      'promotion-review': { review_ok: 'true', passed: 'true', overall: '8.5' },
    },
  });
  const outcome = outcomeOf(happy);
  assert.deepEqual(outcome.terminal, ['pass-promotion'], JSON.stringify(outcome));

  const noop = simulateRun(jobs, {
    payload: { kind: 'promotion' },
    outputs: { 'validate-promotion': { trusted: 'true', no_changes: 'true' } },
  });
  assert.equal(outcomeOf(noop).total, 0, 'an already-promoted staging is a documented no-op, not a block');
  assert.equal(noop.get('validate-promotion'), 'success');

  assert.equal(validatePromotionRange({ expectedSha: SHA_A, stagingSha: SHA_B, mainSha: SHA_C, aheadBy: 1 }).ok, false,
    'promotion must reject a staging head that moved after dispatch');
  assert.equal(validatePromotionRange({ expectedSha: SHA_A, stagingSha: SHA_A, mainSha: SHA_B, aheadBy: 0 }).noChanges, true);
});

test('[RED] the promotion outcome writes durable evidence a human can read after the fact', () => {
  const pass = jobs.get('pass-promotion');
  assert.ok(pass, 'missing pass-promotion');
  assert.match(pass.text, /coordinator\.mjs audit/, 'a promotion must leave an audit record');
  const sweepEvidence = repoFileExists('.github/workflows/promotion-sweep.yml')
    ? readRepoFile('.github/workflows/promotion-sweep.yml') : '';
  assert.match(sweepEvidence, /GITHUB_STEP_SUMMARY|issues: write|gh issue|coordinator\.mjs/,
    'NOT IMPLEMENTED: the sweep must leave observable evidence of what it did each tick');
});

// =============================================================================
// 15. Cost and safety envelope of this eval itself
// =============================================================================
test('[GREEN] this eval spends nothing on models and needs no secrets in ordinary CI', () => {
  const self = readRepoFile('tests/automation/full-autonomous-loop.eval.mjs');
  // Needles are assembled at runtime so this test does not match on its own source.
  const sdkNeedle = new RegExp(['@anthropic', '-ai'].join(''));
  const keyNeedle = new RegExp(['ANTHROPIC', 'API', 'KEY'].join('_'));
  assert.doesNotMatch(self, sdkNeedle, 'the eval must never import the model SDK');
  assert.doesNotMatch(self, keyNeedle, 'the eval must never read model credentials');
  assert.match(self, /LV_LIVE_CANARY/, 'live checks must be opt-in');
});

// =============================================================================
// 16. Opt-in live canary — read-only GitHub, still zero model spend
// =============================================================================
const CANARY = process.env.LV_LIVE_CANARY === '1';
const canaryRepo = process.env.LV_CANARY_REPO || REPO;
const gh = (endpoint) => JSON.parse(execFileSync('gh', ['api', endpoint], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));

test('[CANARY] protected branches still require automation/ci and automation/opus-gate', { skip: !CANARY }, () => {
  for (const branch of ['main', 'staging']) {
    const protection = gh(`repos/${canaryRepo}/branches/${branch}/protection`);
    const contexts = protection.required_status_checks.contexts;
    assert.ok(contexts.includes('automation/ci'), `${branch} must require automation/ci`);
    assert.ok(contexts.includes('automation/opus-gate'), `${branch} must require automation/opus-gate`);
    assert.equal(protection.enforce_admins.enabled, true, `${branch} must enforce protection for admins`);
  }
});

test('[CANARY] main is not stranded behind staging', { skip: !CANARY }, () => {
  const comparison = gh(`repos/${canaryRepo}/compare/main...staging`);
  assert.equal(comparison.ahead_by, 0, `main is ${comparison.ahead_by} commit(s) behind staging — the sweep should have promoted it`);
});

test('[CANARY] no bot PR is sitting without a terminal state', { skip: !CANARY }, () => {
  const open = gh(`repos/${canaryRepo}/pulls?state=open&per_page=100`);
  const now = Date.now();
  const orphans = open.filter((pr) => pr.user?.login === 'github-actions[bot]'
    && (now - Date.parse(pr.updated_at)) > 24 * 3600_000
    && !(pr.labels || []).some((label) => /^automation-/.test(label.name))
    && gh(`repos/${canaryRepo}/commits/${pr.head.sha}/status`).statuses.every((status) => !status.context.startsWith('automation/')));
  assert.deepEqual(orphans.map((pr) => pr.number), [], 'every bot PR must reach a visible terminal state');
});
