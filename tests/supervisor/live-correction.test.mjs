import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import * as hostRun from '../../scripts/supervisor/host-run.mjs';
import { resolvedModelRoute } from '../../scripts/supervisor/pi-session.mjs';
import { finalizeOwnedPr } from '../../scripts/supervisor/terminal-pr.mjs';

test('line-rich command diagnostics remain bounded with an explicit truncation marker', () => {
  if (typeof hostRun.boundedOutcomeReason !== 'function') {
    const source = fs.readFileSync(new URL('../../scripts/supervisor/host-run.mjs', import.meta.url), 'utf8');
    assert.match(source, /--posts', path\.join\(workDir, 'data\/posts\.json'\).*cwd: repoRoot/s,
      'the bounded adapter may be absent only in the exact pre-#138 lint invocation');
    return;
  }
  const diagnostic = `${Array.from({ length: 80 }, (_, index) => `stdout line ${index + 1}: finding`).join('\n')}\ntail`;
  const reason = hostRun.boundedOutcomeReason(diagnostic);
  assert.ok([...diagnostic].length > hostRun.OUTCOME_REASON_LIMIT);
  assert.ok([...reason].length <= hostRun.OUTCOME_REASON_LIMIT);
  assert.match(reason, / …\[truncated\]$/);
});

test('resolved session evidence carries provider, model, API, and baseUrl together', () => {
  const route = resolvedModelRoute({
    provider: 'lv-openai-acceptance', id: 'openai/gpt-5.6-sol', api: 'openai-responses',
  }, 'https://approved.example/v1');
  assert.deepEqual(route, {
    provider: 'lv-openai-acceptance', id: 'openai/gpt-5.6-sol', api: 'openai-responses',
    baseUrl: 'https://approved.example/v1',
  });
  assert.throws(() => resolvedModelRoute({ provider: 'openai', id: 'model', api: '' }, 'https://approved.example/v1'), /lacks api/);
});

test('owned-PR observation fails soft when staging or main branch lookup is missing', () => {
  const source = fs.readFileSync(new URL('../../scripts/supervisor/github-monitor.mjs', import.meta.url), 'utf8');
  assert.match(source, /optionalBranch\(repo, 'staging'\)/);
  assert.match(source, /optionalBranch\(repo, 'main'\)/);
  assert.doesNotMatch(source, /github\(`\/repos\/\$\{repo\}\/branches\/staging`\),/);
});

test('published terminal rejects a Vercel status authored by the coordinator creator login', async () => {
  const sha = 'a'.repeat(40);
  const mergeSha = 'b'.repeat(40);
  const pr = {
    state: 'closed', merged: true, merge_commit_sha: mergeSha,
    head: { sha, ref: 'blog/auto-owned', repo: { fork: false } },
    base: { ref: 'main' }, user: { login: 'github-actions[bot]' },
  };
  const client = async (requestPath) => {
    if (requestPath.endsWith('/pulls/10')) return pr;
    if (requestPath.includes('/compare/')) return { status: 'ahead', behind_by: 0 };
    if (requestPath.endsWith(`/commits/${mergeSha}/status`)) return {
      sha: mergeSha, statuses: [{ context: 'Vercel', state: 'success', creator: { login: 'github-actions[bot]' } }],
    };
    throw new Error(`unexpected request ${requestPath}`);
  };
  await assert.rejects(() => finalizeOwnedPr({
    repo: 'owner/repo', prNumber: 10, expectedSha: sha, terminal: 'PUBLISHED_MAIN', runId: 'run', base: 'main', githubClient: client,
  }), /coordinator-forged Vercel/);
});

test('merged main recovery retries the same exact PR-shaped sync command within a hard bound', async () => {
  const sha = 'a'.repeat(40);
  const mergeSha = 'b'.repeat(40);
  let reads = 0;
  let clock = 0;
  const calls = [];
  const pr = {
    number: 10, state: 'closed', merged: true, merge_commit_sha: mergeSha,
    head: { sha, ref: 'blog/auto-owned', repo: { fork: false } },
    base: { ref: 'main' }, user: { login: 'github-actions[bot]' },
  };
  const observation = () => {
    reads += 1;
    const complete = reads > 3;
    return {
      pr, audit: null, statuses: { ci: 'success', gate: 'success', vercel: 'success' },
      stagingContained: complete, mainContained: true, contentContainedInMain: true,
      productionVercel: complete ? 'success' : 'missing',
    };
  };
  const result = await hostRun.monitorOwnedPr({
    repoRoot: '/repo', repo: 'owner/repo', prNumber: 10, initialSha: sha, startedAt: 0,
    now: () => clock, sleep: async () => { clock += 1; }, fetchObservationFn: async () => observation(),
    coordinatorFn: async (...args) => { calls.push(args); if (calls.length < 3) throw new Error('transient sync failure'); },
  });
  assert.equal(result.terminal, 'PUBLISHED_MAIN');
  assert.equal(calls.length, 3);
  for (const [repoRoot, argv, options] of calls) {
    assert.equal(repoRoot, '/repo');
    assert.deepEqual(argv, ['observe-and-sync-staging', '--pr', '10', '--sha', sha]);
    assert.deepEqual(options, { repo: 'owner/repo' });
  }
});
