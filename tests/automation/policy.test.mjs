import test from 'node:test';
import assert from 'node:assert/strict';
import { GATE_MODEL, MAX_REPAIRS, SCORE_THRESHOLD } from '../../scripts/automation/constants.mjs';
import {
  canRepair, evaluateGeneratorBase, evaluateObservedMerge, evaluateVerdict, filterRepairablePaths,
  readRepairAttempt, validatePaths, validatePromotionRange, validatePullRequest, validateRepairPlan,
} from '../../scripts/automation/policy.mjs';

const SHA = 'a'.repeat(40);
const MAIN = 'b'.repeat(40);

function trustedPr(overrides = {}) {
  return {
    state: 'open', draft: false,
    user: { login: 'github-actions[bot]' },
    head: { sha: SHA, ref: 'seo/auto-123', repo: { full_name: 'owner/repo' } },
    base: { ref: 'staging', repo: { full_name: 'owner/repo' } },
    labels: [],
    ...overrides,
  };
}

test('accepts a trusted exact-SHA same-repository generator PR', () => {
  const result = validatePullRequest({ repository: 'owner/repo', kind: 'seo', expectedSha: SHA, pr: trustedPr(), files: ['app/page.tsx'] });
  assert.equal(result.ok, true);
  assert.equal(result.attempt, 0);
});

test('fails closed for fork, stale SHA, draft, actor, branch, and forbidden paths', () => {
  const cases = [
    trustedPr({ head: { ...trustedPr().head, repo: { full_name: 'fork/repo' } } }),
    trustedPr({ head: { ...trustedPr().head, sha: 'c'.repeat(40) } }),
    trustedPr({ draft: true }),
    trustedPr({ user: { login: 'attacker' } }),
    trustedPr({ base: { ...trustedPr().base, ref: 'main' } }),
  ];
  for (const pr of cases) assert.equal(validatePullRequest({ repository: 'owner/repo', kind: 'seo', expectedSha: SHA, pr, files: ['app/page.tsx'] }).ok, false);
  assert.equal(validatePaths('seo', ['.github/workflows/backdoor.yml']).ok, false);
  assert.equal(validatePaths('blog', ['../package.json']).ok, false);
  assert.equal(validatePaths('business', ['data/posts.json']).ok, false);
  assert.equal(validatePaths('seo', ['app/page.tsx\n.github/workflows/backdoor.yml']).ok, false);
  assert.equal(validatePaths('news', ['data/posts.json']).ok, true);
  assert.equal(validatePaths('news', ['public/images/blog/x.jpg']).ok, false);
  assert.equal(validatePaths('news', ['.github/workflows/news-autopublish.yml']).ok, false);
});

test('accepts a trusted news autopublish PR touching only posts.json', () => {
  const pr = trustedPr({
    head: { sha: SHA, ref: 'news/auto-123', repo: { full_name: 'owner/repo' } },
  });
  const result = validatePullRequest({
    repository: 'owner/repo',
    kind: 'news',
    expectedSha: SHA,
    pr,
    files: ['data/posts.json'],
  });
  assert.equal(result.ok, true);
});

test('enforces strict verdict schema, score threshold, severity, model, and SHA', () => {
  const base = { overall: SCORE_THRESHOLD, passed: true, findings: [], model: GATE_MODEL, commit_sha: SHA };
  assert.deepEqual(evaluateVerdict(base, SHA).passed, true);
  assert.equal(evaluateVerdict({ ...base, overall: 7.9, passed: false }, SHA).passed, false);
  assert.equal(evaluateVerdict({ ...base, findings: [{ severity: 'high', path: 'app/page.tsx', note: 'breaks trust' }], passed: false }, SHA).passed, false);
  assert.equal(evaluateVerdict({ ...base, model: 'claude-sonnet-4-5-20250929' }, SHA).ok, false);
  assert.equal(evaluateVerdict({ ...base, commit_sha: 'c'.repeat(40) }, SHA).ok, false);
  assert.equal(evaluateVerdict({ ...base, extra: true }, SHA).ok, false);
  assert.equal(evaluateVerdict({ ...base, overall: 9, passed: false }, SHA).ok, false);
});

test('persists one controlled attempt label and caps repairs across reruns', () => {
  assert.equal(readRepairAttempt([]), 0);
  assert.equal(readRepairAttempt([{ name: 'automation-repair-3' }]), 3);
  assert.equal(canRepair(MAX_REPAIRS - 1), true);
  assert.equal(canRepair(MAX_REPAIRS), false);
  assert.throws(() => readRepairAttempt([{ name: 'automation-repair-1' }, { name: 'automation-repair-2' }]));
  assert.throws(() => readRepairAttempt([{ name: 'automation-repair-4' }]));
});

test('requires the exact staging head for promotion PRs', () => {
  const promotion = trustedPr({
    head: { sha: SHA, ref: 'staging', repo: { full_name: 'owner/repo' } },
    base: { ref: 'main', repo: { full_name: 'owner/repo' } },
  });
  assert.equal(validatePullRequest({ repository: 'owner/repo', kind: 'promotion', expectedSha: SHA, pr: promotion, files: ['data/posts.json'] }).ok, true);
  promotion.head.ref = 'staging-attacker';
  assert.equal(validatePullRequest({ repository: 'owner/repo', kind: 'promotion', expectedSha: SHA, pr: promotion, files: ['data/posts.json'] }).ok, false);
});

test('validates exact cumulative promotion range and no-op state', () => {
  const active = validatePromotionRange({ expectedSha: SHA, stagingSha: SHA, mainSha: MAIN, aheadBy: 2 });
  assert.equal(active.ok, true);
  assert.equal(active.noChanges, false);
  assert.equal(active.range, `${MAIN}...${SHA}`);
  assert.equal(validatePromotionRange({ expectedSha: SHA, stagingSha: SHA, mainSha: MAIN, aheadBy: 0 }).noChanges, true);
  assert.equal(validatePromotionRange({ expectedSha: SHA, stagingSha: 'c'.repeat(40), mainSha: MAIN, aheadBy: 1 }).ok, false);
});

test('allows ordinary cumulative promotion paths while sensitive infrastructure stays forbidden', () => {
  const ordinary = [
    'app/page.tsx', 'components/Card.tsx', 'data/businesses.json', 'lib/schema.ts',
    'public/images/hero.jpg', 'public/fonts/site.woff2',
    'tasks/seo-data-latest.json', 'tasks/auto-blog-runs/2026-08-05.json',
    'tasks/discovery-runs/2026-08-05.json',
  ];
  assert.equal(validatePaths('promotion', ordinary).ok, true);
  for (const file of [
    '.github/workflows/deploy.yml', 'scripts/automation/coordinator.mjs', 'docs/rubric.md',
    'package.json', 'tasks/arbitrary.json', 'tasks/discovery-runs.json',
  ]) {
    assert.equal(validatePaths('promotion', [file]).ok, false, file);
  }
  assert.equal(validatePaths('promotion', Array.from({ length: 100 }, (_, index) => `app/page-${index}.tsx`)).ok, true);
  assert.equal(validatePaths('promotion', Array.from({ length: 101 }, (_, index) => `app/page-${index}.tsx`)).ok, false);
});

test('refreshes a generator whose staging base advanced and fails closed on invalid comparisons', () => {
  assert.equal(evaluateGeneratorBase({
    expectedSha: SHA, prHeadSha: SHA, stagingSha: MAIN, stagingAheadBy: 1,
  }), 'refresh');
  assert.equal(evaluateGeneratorBase({
    expectedSha: SHA, prHeadSha: SHA, stagingSha: MAIN, stagingAheadBy: 0,
  }), 'continue');
  assert.throws(() => evaluateGeneratorBase({
    expectedSha: SHA, prHeadSha: 'c'.repeat(40), stagingSha: MAIN, stagingAheadBy: 1,
  }));
  assert.throws(() => evaluateGeneratorBase({
    expectedSha: SHA, prHeadSha: SHA, stagingSha: 'invalid', stagingAheadBy: 1,
  }));
  assert.throws(() => evaluateGeneratorBase({
    expectedSha: SHA, prHeadSha: SHA, stagingSha: MAIN, stagingAheadBy: -1,
  }));
});

test('treats a merged PR behind staging as superseded and fails closed for other mismatches', () => {
  const mergeSha = 'c'.repeat(40);
  const pr = { merged: true, head: { sha: SHA }, base: { ref: 'staging' }, merge_commit_sha: mergeSha };
  assert.equal(evaluateObservedMerge({ pr, expectedSha: SHA, stagingSha: mergeSha }), 'dispatch');
  assert.equal(evaluateObservedMerge({ pr, expectedSha: SHA, stagingSha: 'd'.repeat(40) }), 'superseded');
  assert.equal(evaluateObservedMerge({ pr: { ...pr, merged: false }, expectedSha: SHA }), 'wait');
  assert.throws(() => evaluateObservedMerge({ pr: { ...pr, head: { sha: MAIN } }, expectedSha: SHA, stagingSha: mergeSha }));
  assert.throws(() => evaluateObservedMerge({ pr: { ...pr, base: { ref: 'main' } }, expectedSha: SHA, stagingSha: mergeSha }));
});

test('fixer sees only kind-specific repairable text paths', () => {
  assert.deepEqual(filterRepairablePaths('business', [
    'data/businesses.json',
    'public/images/businesses/photo.jpg',
    'tasks/discovery-runs/2026-08-05.json',
  ]), ['data/businesses.json']);
  assert.deepEqual(filterRepairablePaths('blog', [
    'data/posts.json',
    'public/images/blog/post.jpg',
    'tasks/auto-blog-runs/2026-08-05.json',
  ]), ['data/posts.json']);
});

test('repair plans can only replace existing kind-specific text content within budget', () => {
  const valid = validateRepairPlan('seo', { edits: [{ path: 'app/page.tsx', content: 'safe', reason: 'fix finding' }] }, ['app/page.tsx']);
  assert.equal(valid.ok, true);
  assert.equal(validateRepairPlan('seo', { edits: [{ path: 'scripts/pwn.mjs', content: 'x', reason: 'bad' }] }, ['scripts/pwn.mjs']).ok, false);
  assert.equal(validateRepairPlan('seo', { edits: [{ path: 'app/new.tsx', content: 'x', reason: 'new' }] }, ['app/page.tsx']).ok, false);
  assert.equal(validateRepairPlan('seo', { edits: [{ path: 'app/icon.png', content: 'not an image', reason: 'bad' }] }, ['app/icon.png']).ok, false);
  assert.equal(validateRepairPlan('blog', { edits: [{ path: 'public/images/blog/post.jpg', content: 'not an image', reason: 'bad' }] }, ['public/images/blog/post.jpg']).ok, false);
});
