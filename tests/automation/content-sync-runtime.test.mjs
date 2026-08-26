import assert from 'node:assert/strict';
import test from 'node:test';
import {
  pollForMergedBlogLivePr, syncMergedContentToStaging, waitForBlogLiveHeadStatuses,
} from '../../scripts/automation/content-sync.mjs';

const A = 'a'.repeat(40);
const M = 'b'.repeat(40);
const S = 'c'.repeat(40);
const X = 'd'.repeat(40);
const T = 'e'.repeat(40);
const REPO = 'owner/repo';

function contentPr(overrides = {}) {
  return {
    number: 4, state: 'open', merged: false, merge_commit_sha: null,
    user: { login: 'github-actions[bot]' }, base: { ref: 'main' },
    head: { sha: A, ref: 'blog/auto-owned', repo: { fork: false } },
    ...overrides,
  };
}

function statusPayload(ci, gate, vercel) {
  return { sha: A, statuses: [
    { context: 'automation/ci', state: ci },
    { context: 'automation/opus-gate', state: gate },
    { context: 'Vercel', state: vercel },
  ] };
}

test('exact-head preview gate polls until CI, Opus, and Vercel all succeed', async () => {
  let statusReads = 0;
  let sleeps = 0;
  const github = async (path) => {
    if (path.endsWith('/pulls/4')) return contentPr();
    if (path.endsWith(`/commits/${A}/status`)) return statusReads++ ? statusPayload('success', 'success', 'success') : statusPayload('success', 'success', 'pending');
    throw new Error(`unexpected ${path}`);
  };
  const result = await waitForBlogLiveHeadStatuses({ repo: REPO, pr: '4', sha: A }, {
    github, polls: 2, intervalMs: 1, sleep: async () => { sleeps += 1; },
  });
  assert.deepEqual(result, { ci: 'success', gate: 'success', vercel: 'success' });
  assert.equal(sleeps, 1);
});

test('merge observer stays bounded and requires the exact owned main PR', async () => {
  let reads = 0;
  const merged = contentPr({ state: 'closed', merged: true, merge_commit_sha: M });
  const result = await pollForMergedBlogLivePr({ repo: REPO, pr: '4', sha: A }, {
    github: async () => (++reads === 2 ? merged : contentPr()), polls: 2, intervalMs: 1, sleep: async () => {},
    writeOutput: () => {},
  });
  assert.equal(result.merge_commit_sha, M);
  await assert.rejects(() => pollForMergedBlogLivePr({ repo: REPO, pr: '4', sha: A }, {
    github: async () => contentPr({ base: { ref: 'staging' } }), polls: 1, writeOutput: () => {},
  }), /identity/);
});

test('pre-PR merge conflict cleans the exact unencoded owned ref and a 422 is recreated safely', async () => {
  const calls = [];
  let creates = 0;
  const github = async (path, options = {}) => {
    calls.push({ path, ...options });
    if (path.includes(`/compare/${M}...main`)) return { status: 'ahead', behind_by: 0 };
    if (path.endsWith('/branches/staging')) return { commit: { sha: S } };
    if (path.includes(`/compare/${M}...staging`)) return { status: 'behind', behind_by: 1 };
    if (path.endsWith('/git/refs') && options.method === 'POST') {
      creates += 1;
      if (creates === 1) throw new Error('GitHub API POST failed (422): exists');
      return {};
    }
    if (path.endsWith('/merges')) throw new Error('GitHub API POST failed (409): conflict');
    if (options.method === 'DELETE') return null;
    throw new Error(`unexpected ${path}`);
  };
  await assert.rejects(() => syncMergedContentToStaging({ repo: REPO, contentPr: contentPr({ merge_commit_sha: M }), mergeSha: M }, {
    github, paged: async () => [], writeOutput: () => {},
  }), /merge conflict/);
  const deletes = calls.filter((call) => call.method === 'DELETE');
  assert.ok(deletes.length >= 2, '422 replacement and pre-PR failure both clean the ref');
  assert.ok(deletes.every((call) => call.path.endsWith(`/git/refs/heads/sync/main-${M}`)));
  assert.ok(deletes.every((call) => !call.path.includes('%2F')));
});

for (const variant of ['untrusted', 'wrong-ancestry']) {
  test(`reused sync PR is closed before statuses when it is ${variant}`, async () => {
    const actions = [];
    const reused = {
      number: 7, state: 'open', merged: false,
      user: { login: variant === 'untrusted' ? 'mallory' : 'github-actions[bot]' },
      base: { ref: 'staging' }, head: { sha: X, ref: `sync/main-${M}`, repo: { fork: false } },
    };
    const github = async (path, options = {}) => {
      if (options.method) actions.push({ path, ...options });
      if (path.includes(`/compare/${M}...main`)) return { status: 'ahead', behind_by: 0 };
      if (path.endsWith('/branches/staging')) return { commit: { sha: S } };
      if (path.includes(`/compare/${M}...staging`)) return { status: 'behind', behind_by: 1 };
      if (path.endsWith('/pulls/7')) return reused;
      if (path.endsWith(`/commits/${X}`)) return { parents: [{ sha: M }, { sha: S }] };
      if (options.method === 'PATCH' || options.method === 'DELETE') return {};
      throw new Error(`unexpected ${path}`);
    };
    let statuses = 0;
    await assert.rejects(() => syncMergedContentToStaging({ repo: REPO, contentPr: contentPr({ merge_commit_sha: M }), mergeSha: M }, {
      github, paged: async () => [reused], writeOutput: () => {}, publishStatus: async () => { statuses += 1; },
    }), variant === 'untrusted' ? /untrusted or stale identity/ : /unexpected merge ancestry/);
    assert.equal(statuses, 0);
    assert.ok(actions.some((call) => call.method === 'PATCH' && call.body.state === 'closed'));
    assert.ok(actions.some((call) => call.method === 'DELETE'));
  });
}

test('successful sync targets the exact merge SHA, validates two parents, and deletes the merged branch', async () => {
  const calls = [];
  const statuses = [];
  let staged = false;
  const syncPr = {
    number: 7, state: 'open', merged: false, user: { login: 'github-actions[bot]' },
    base: { ref: 'staging' }, head: { sha: X, ref: `sync/main-${M}`, repo: { fork: false } },
  };
  const github = async (path, options = {}) => {
    calls.push({ path, ...options });
    if (path.includes(`/compare/${M}...main`)) return { status: 'ahead', behind_by: 0 };
    if (path.endsWith('/branches/staging')) return { commit: { sha: staged ? T : S } };
    if (path.includes(`/compare/${M}...staging`)) return { status: staged ? 'ahead' : 'behind', behind_by: staged ? 0 : 1 };
    if (path.endsWith('/git/refs') && options.method === 'POST') return {};
    if (path.endsWith('/merges')) return { sha: X };
    if (path.endsWith(`/commits/${X}`)) return { parents: [{ sha: S }, { sha: M }] };
    if (path.includes(`/compare/${S}...${X}`)) return { files: [{ filename: 'data/posts.json' }] };
    if (path.endsWith('/pulls') && options.method === 'POST') return syncPr;
    if (path.endsWith('/pulls/7') && !options.method) return syncPr;
    if (path.endsWith('/pulls/7/merge')) { staged = true; return { merged: true }; }
    if (options.method === 'DELETE') return null;
    throw new Error(`unexpected ${path}`);
  };
  const result = await syncMergedContentToStaging({ repo: REPO, contentPr: contentPr({ merge_commit_sha: M }), mergeSha: M }, {
    github,
    paged: async (path) => path.includes('/files') ? [{ filename: 'data/posts.json' }] : [],
    writeOutput: () => {}, publishStatus: async (value) => statuses.push(value),
  });
  assert.equal(result.synced, 'true');
  assert.equal(calls.find((call) => call.path.endsWith('/merges')).body.head, M);
  assert.deepEqual(statuses.map((value) => value.context), ['automation/ci', 'automation/opus-gate']);
  assert.ok(calls.some((call) => call.method === 'DELETE' && call.path.endsWith(`/git/refs/heads/sync/main-${M}`)));
});
