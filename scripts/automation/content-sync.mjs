import { STATUS_CONTEXTS, TRUSTED_PR_AUTHORS } from './constants.mjs';
import { github as defaultGithub, paged as defaultPaged, writeOutput as defaultWriteOutput } from './github.mjs';
import { isExactSha, validateSyncDelta } from './policy.mjs';
import { contentShipEnabled as defaultContentShipEnabled } from './promotion-control.mjs';
import { publishStatus as defaultPublishStatus, statusForExactSha } from './statuses.mjs';

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const TERMINAL_STATUS = new Set(['failure', 'error']);

function requireOptions(options, names) {
  for (const name of names) if (!options[name]) throw new Error(`missing --${name}`);
}

function exactPrNumber(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0 || String(value).trim() !== String(number)) {
    throw new Error(`pull request number is not an exact positive integer: ${String(value)}`);
  }
  return number;
}

export function comparisonContained(comparison) {
  return ['ahead', 'identical'].includes(comparison?.status) && Number(comparison?.behind_by || 0) === 0;
}

export function syncHeadName(mergeSha) {
  if (!isExactSha(mergeSha)) throw new Error('sync head requires an exact merge SHA');
  return `sync/main-${mergeSha}`;
}

function trustedContentPr(pr, expectedSha) {
  return Boolean(pr && pr.state === 'open' && pr.merged !== true
    && pr.base?.ref === 'main' && pr.head?.sha === expectedSha
    && String(pr.head?.ref || '').startsWith('blog/auto-')
    && TRUSTED_PR_AUTHORS.includes(pr.user?.login)
    && pr.head?.repo?.fork !== true);
}

export async function waitForBlogLiveHeadStatuses(options, dependencies = {}) {
  requireOptions(options, ['repo', 'pr', 'sha']);
  if (!isExactSha(options.sha)) throw new Error('blog-live status gate requires an exact head SHA');
  const github = dependencies.github ?? defaultGithub;
  const sleep = dependencies.sleep ?? defaultSleep;
  const polls = dependencies.polls ?? 60;
  const intervalMs = dependencies.intervalMs ?? 10_000;
  for (let poll = 0; poll < polls; poll += 1) {
    const pr = await github(`/repos/${options.repo}/pulls/${exactPrNumber(options.pr)}`);
    if (!trustedContentPr(pr, options.sha)) throw new Error('blog-live status gate refused PR identity or head drift');
    const payload = await github(`/repos/${options.repo}/commits/${options.sha}/status`);
    const states = statusForExactSha(payload, options.sha);
    if ([states.ci, states.gate, states.vercel].some((state) => TERMINAL_STATUS.has(state))) {
      throw new Error(`blog-live status gate failed: ci=${states.ci}, gate=${states.gate}, Vercel=${states.vercel}`);
    }
    if (states.ci === 'success' && states.gate === 'success' && states.vercel === 'success') return states;
    if (poll + 1 < polls) await sleep(intervalMs);
  }
  throw new Error('blog-live status gate timed out before exact-head CI, Opus, and Vercel success');
}

function githubStatus(error, status) {
  return String(error?.message || '').includes(`(${status})`);
}

async function deleteSyncRef(repo, headName, github, { tolerateMissing = true } = {}) {
  if (!/^sync\/main-[0-9a-f]{40}$/.test(headName)) throw new Error(`refused non-owned sync ref cleanup: ${headName}`);
  try {
    await github(`/repos/${repo}/git/refs/heads/${headName}`, { method: 'DELETE' });
    return true;
  } catch (error) {
    if (tolerateMissing && githubStatus(error, 404)) return false;
    throw error;
  }
}

async function createSyncRef(repo, headName, sha, github) {
  try {
    await github(`/repos/${repo}/git/refs`, { method: 'POST', body: { ref: `refs/heads/${headName}`, sha } });
  } catch (error) {
    if (!githubStatus(error, 422)) throw error;
    await deleteSyncRef(repo, headName, github);
    await github(`/repos/${repo}/git/refs`, { method: 'POST', body: { ref: `refs/heads/${headName}`, sha } });
  }
}

async function closeAndDelete(repo, pr, headName, github) {
  if (pr?.state === 'open') await github(`/repos/${repo}/pulls/${pr.number}`, { method: 'PATCH', body: { state: 'closed' } });
  await deleteSyncRef(repo, headName, github);
}

async function verifyReusableSyncPr({ repo, pr, headName, syncSha, oldStagingSha, mergeSha, github }) {
  const live = await github(`/repos/${repo}/pulls/${pr.number}`);
  const identityOk = live?.state === 'open' && live?.merged !== true
    && TRUSTED_PR_AUTHORS.includes(live?.user?.login)
    && live?.base?.ref === 'staging' && live?.head?.ref === headName && live?.head?.sha === syncSha
    && live?.head?.repo?.fork !== true;
  const commit = identityOk ? await github(`/repos/${repo}/commits/${syncSha}`) : null;
  const parents = (commit?.parents || []).map((parent) => parent.sha);
  const ancestryOk = parents.length === 2 && parents[0] === oldStagingSha && parents[1] === mergeSha;
  if (!identityOk || !ancestryOk) {
    await closeAndDelete(repo, live || pr, headName, github);
    throw new Error(`sync PR refused ${identityOk ? 'unexpected merge ancestry' : 'untrusted or stale identity'}`);
  }
  return live;
}

export async function syncMergedContentToStaging({ repo, contentPr, mergeSha }, dependencies = {}) {
  const github = dependencies.github ?? defaultGithub;
  const paged = dependencies.paged ?? defaultPaged;
  const writeOutput = dependencies.writeOutput ?? defaultWriteOutput;
  const publishStatus = dependencies.publishStatus ?? ((options) => defaultPublishStatus(options, github));
  if (!isExactSha(mergeSha) || contentPr?.merge_commit_sha !== mergeSha) throw new Error('sync requires the exact observed merge_commit_sha');
  const mainComparison = await github(`/repos/${repo}/compare/${mergeSha}...main`);
  if (!comparisonContained(mainComparison)) throw new Error('main does not contain the exact content merge commit');
  const staging = await github(`/repos/${repo}/branches/staging`);
  if (!isExactSha(staging?.commit?.sha)) throw new Error('staging head is not an exact SHA');
  const headName = syncHeadName(mergeSha);
  const already = await github(`/repos/${repo}/compare/${mergeSha}...staging`).catch(() => null);
  if (comparisonContained(already)) {
    await deleteSyncRef(repo, headName, github).catch((error) => { if (!githubStatus(error, 409)) throw error; });
    writeOutput({ synced: 'noop', merge_commit_sha: mergeSha, staging_sha: staging.commit.sha });
    return { synced: 'noop', mergeSha, stagingSha: staging.commit.sha };
  }

  const owner = repo.split('/')[0];
  const existing = await paged(`/repos/${repo}/pulls?state=open&base=staging&head=${encodeURIComponent(`${owner}:${headName}`)}`);
  if (existing.length > 1) throw new Error('multiple open exact-merge sync PRs found');
  let syncPr = existing[0] ?? null;
  let syncSha = syncPr?.head?.sha ?? null;
  let refCreated = false;
  let prCreated = Boolean(syncPr);
  try {
    if (!syncPr) {
      await createSyncRef(repo, headName, staging.commit.sha, github);
      refCreated = true;
      let merged;
      try {
        merged = await github(`/repos/${repo}/merges`, {
          method: 'POST', body: { base: headName, head: mergeSha, commit_message: `sync: main merge ${mergeSha.slice(0, 12)} into staging` },
        });
      } catch (error) {
        if (githubStatus(error, 409)) throw new Error(`sync merge conflict for exact merge ${mergeSha}`);
        throw error;
      }
      syncSha = merged?.sha;
      if (!isExactSha(syncSha)) {
        const containment = await github(`/repos/${repo}/compare/${mergeSha}...staging`).catch(() => null);
        if (comparisonContained(containment)) {
          writeOutput({ synced: 'noop', merge_commit_sha: mergeSha, staging_sha: staging.commit.sha });
          return { synced: 'noop', mergeSha, stagingSha: staging.commit.sha };
        }
        throw new Error('sync merge returned no exact two-parent merge SHA');
      }
      const commit = await github(`/repos/${repo}/commits/${syncSha}`);
      const parents = (commit?.parents || []).map((parent) => parent.sha);
      if (parents.length !== 2 || parents[0] !== staging.commit.sha || parents[1] !== mergeSha) {
        throw new Error('new sync merge has unexpected parent ancestry');
      }
      const deltaCompare = await github(`/repos/${repo}/compare/${staging.commit.sha}...${syncSha}`);
      const deltaOk = validateSyncDelta((deltaCompare.files || []).map((file) => file.filename));
      if (!deltaOk.ok) throw new Error(`sync aborted: incoming delta is not blog-only: ${deltaOk.errors.join('; ')}`);
      syncPr = await github(`/repos/${repo}/pulls`, {
        method: 'POST', body: {
          title: `sync: main merge ${mergeSha.slice(0, 12)} into staging`, head: headName, base: 'staging', draft: false,
          body: 'PR-shaped exact main-merge→staging content sync. Required checks are automation/ci and automation/opus-gate. Merge with --merge only.',
        },
      });
      prCreated = true;
    }

    syncPr = await verifyReusableSyncPr({
      repo, pr: syncPr, headName, syncSha, oldStagingSha: staging.commit.sha, mergeSha, github,
    });
    const files = (await paged(`/repos/${repo}/pulls/${syncPr.number}/files`)).map((file) => file.filename);
    const filesOk = validateSyncDelta(files);
    if (!filesOk.ok) {
      await closeAndDelete(repo, syncPr, headName, github);
      throw new Error(`sync PR closed unmerged: files are not blog-only: ${filesOk.errors.join('; ')}`);
    }
    await publishStatus({ repo, sha: syncSha, context: STATUS_CONTEXTS.publish.ci, state: 'success', description: 'Exact-merge content-sync CI' });
    await publishStatus({ repo, sha: syncSha, context: STATUS_CONTEXTS.publish.gate, state: 'success', description: 'Exact-merge content-sync gate' });
    let merge;
    try {
      merge = await github(`/repos/${repo}/pulls/${syncPr.number}/merge`, { method: 'PUT', body: { merge_method: 'merge', sha: syncSha } });
    } catch (error) {
      if (!githubStatus(error, 409)) throw error;
      const contained = await github(`/repos/${repo}/compare/${mergeSha}...staging`).catch(() => null);
      if (!comparisonContained(contained)) throw error;
      merge = { merged: true };
    }
    if (!merge?.merged) throw new Error('sync PR merge did not complete with --merge');
    const contained = await github(`/repos/${repo}/compare/${mergeSha}...staging`);
    if (!comparisonContained(contained)) throw new Error('staging does not contain the exact content merge after sync');
    const stagingAfter = await github(`/repos/${repo}/branches/staging`);
    await deleteSyncRef(repo, headName, github);
    writeOutput({ synced: 'true', sync_pr: syncPr.number, sync_sha: syncSha, staging_sha: stagingAfter.commit.sha, merge_commit_sha: mergeSha });
    return { synced: 'true', syncPr: syncPr.number, syncSha, stagingSha: stagingAfter.commit.sha, mergeSha };
  } finally {
    if (refCreated && !prCreated) await deleteSyncRef(repo, headName, github).catch(() => {});
  }
}

export async function pollForMergedBlogLivePr(options, dependencies = {}) {
  requireOptions(options, ['repo', 'pr', 'sha']);
  if (!isExactSha(options.sha)) throw new Error('merge observation requires an exact head SHA');
  const github = dependencies.github ?? defaultGithub;
  const sleep = dependencies.sleep ?? defaultSleep;
  const writeOutput = dependencies.writeOutput ?? defaultWriteOutput;
  const polls = dependencies.polls ?? 72;
  const intervalMs = dependencies.intervalMs ?? 10_000;
  for (let poll = 0; poll < polls; poll += 1) {
    const pr = await github(`/repos/${options.repo}/pulls/${exactPrNumber(options.pr)}`);
    const identity = pr?.base?.ref === 'main' && pr?.head?.sha === options.sha
      && String(pr?.head?.ref || '').startsWith('blog/auto-')
      && TRUSTED_PR_AUTHORS.includes(pr?.user?.login) && pr?.head?.repo?.fork !== true;
    if (!identity) throw new Error('merge observation refused PR identity or exact-head drift');
    if (pr.merged === true) {
      if (pr.state !== 'closed' || !isExactSha(pr.merge_commit_sha)) throw new Error('merged content PR lacks an exact merge_commit_sha');
      return pr;
    }
    if (pr.state !== 'open') throw new Error('owned content PR closed without merging');
    if (poll + 1 < polls) await sleep(intervalMs);
  }
  writeOutput({ synced: 'false', reason: 'merge-timeout', handoff: 'supervisor-sweep' });
  return null;
}

export async function observeAndSyncStaging(options, dependencies = {}) {
  requireOptions(options, ['repo', 'pr', 'sha']);
  const enabled = dependencies.contentShipEnabled ?? defaultContentShipEnabled;
  if (!enabled()) throw new Error('contentShipEnabled is false; refusing blog-live sync onto protected branches');
  const pr = await pollForMergedBlogLivePr(options, dependencies);
  if (!pr) return { synced: 'false', handoff: 'supervisor-sweep' };
  if (String(pr.head?.ref || '').startsWith('sync/main-')) throw new Error('observe-and-sync-staging refused to recurse into a sync PR');
  return syncMergedContentToStaging({ repo: options.repo, contentPr: pr, mergeSha: pr.merge_commit_sha }, dependencies);
}
