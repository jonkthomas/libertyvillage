import { github, paged } from '../automation/github.mjs';
import { isExactSha } from '../automation/policy.mjs';
import { comparisonIsContained, mayRepin, statusForExactSha, validateOwnedPr } from './sha-monitor.mjs';
import { TRUSTED_PR_AUTHORS } from '../automation/constants.mjs';

const NO_LADDER_TERMINALS = new Set([
  'MERGED_STAGING', 'PUBLISHED_MAIN', 'SKIPPED_OWNER', 'SKIPPED_CANDIDATE',
  'ABANDONED_TOPIC', 'DRY_RUN', 'BASELINE_FAILED',
  'WEEKLY_OBJECTIVE_MET', 'DEFERRED_TO_DEADLINE', 'WEEKLY_PUBLICATION_MISSED',
]);

export function terminalRequiresCandidateOutcome({ terminal, topicKey }) {
  return Boolean(topicKey) && !NO_LADDER_TERMINALS.has(terminal);
}

// Canonical terminal ordering: durable ladder first, exact owned PR closure second.
// The run_id-backed outcome key makes a reclaimed/replayed terminal idempotent.
export async function finalizeSupervisorTerminal({ repo, run, terminal, expectedSha, reason, recordOutcome, expectedBase = 'main', finalizePr = finalizeOwnedPr }) {
  if (terminalRequiresCandidateOutcome({ terminal, topicKey: run.topic_key })) {
    await recordOutcome({ terminal, topicKey: run.topic_key, reason });
  }
  if (!run.pr_number) return { prState: undefined, merged: false };
  return finalizePr({ repo, prNumber: run.pr_number, expectedSha, terminal, runId: run.run_id, base: expectedBase });
}

export async function finalizeOwnedPr({ repo, prNumber, expectedSha, terminal, runId, base = 'staging', githubClient = github, commentsClient = paged }) {
  if (!Number.isInteger(prNumber) || prNumber <= 0) throw new Error('terminal finalizer requires the exact ledger PR number');
  if (!isExactSha(expectedSha)) throw new Error('terminal finalizer requires the exact ledger head SHA');
  const pr = await githubClient(`/repos/${repo}/pulls/${prNumber}`);
  const liveSha = pr?.head?.sha;
  const expectedBase = base;
  const identity = validateOwnedPr({ pr, expectedSha: liveSha, base: expectedBase });
  if (!identity.ok) throw new Error(`terminal finalizer refused PR identity drift: ${identity.errors.join('; ')}`);
  let adoptedSha = expectedSha;
  if (liveSha !== expectedSha) {
    const commit = await githubClient(`/repos/${repo}/commits/${liveSha}`);
    const parents = (commit?.parents || []).map((parent) => parent.sha);
    if (!mayRepin({ oldSha: expectedSha, newSha: liveSha, parents })) {
      throw new Error('terminal finalizer refused unrelated pull request head drift');
    }
    adoptedSha = liveSha;
  }
  const owned = validateOwnedPr({ pr, expectedSha: adoptedSha, base: expectedBase });
  if (!owned.ok) throw new Error(`terminal finalizer refused PR identity drift: ${owned.errors.join('; ')}`);
  if (terminal === 'MERGED_STAGING') {
    if (pr.state !== 'closed' || pr.merged !== true || !isExactSha(pr.merge_commit_sha)) {
      throw new Error('MERGED_STAGING requires a closed, merged owned PR');
    }
    if (pr.base?.ref !== 'staging') throw new Error('MERGED_STAGING requires a staging-base owned PR');
    const comparison = await githubClient(`/repos/${repo}/compare/${pr.merge_commit_sha}...staging`);
    if (!comparisonIsContained({ status: comparison?.status, behindBy: comparison?.behind_by })) {
      throw new Error('MERGED_STAGING merge commit is not contained in live staging');
    }
    return { prState: 'closed', merged: true, headSha: adoptedSha };
  }
  if (terminal === 'PUBLISHED_MAIN') {
    if (pr.state !== 'closed' || pr.merged !== true || !isExactSha(pr.merge_commit_sha)) {
      throw new Error('PUBLISHED_MAIN requires a closed, merged owned PR');
    }
    if (pr.base?.ref !== 'main') throw new Error('PUBLISHED_MAIN requires a main-base owned PR');
    const mergeOnMain = await githubClient(`/repos/${repo}/compare/${pr.merge_commit_sha}...main`);
    if (!comparisonIsContained({ status: mergeOnMain?.status, behindBy: mergeOnMain?.behind_by })) {
      throw new Error('PUBLISHED_MAIN merge commit is not contained in live main');
    }
    const contentOnMain = await githubClient(`/repos/${repo}/compare/${adoptedSha}...main`);
    if (!comparisonIsContained({ status: contentOnMain?.status, behindBy: contentOnMain?.behind_by })) {
      throw new Error('PUBLISHED_MAIN content SHA is not contained in live main as itself');
    }
    const stagingMerge = await githubClient(`/repos/${repo}/compare/${pr.merge_commit_sha}...staging`).catch(() => null);
    const stagingHead = await githubClient(`/repos/${repo}/compare/${adoptedSha}...staging`).catch(() => null);
    const stagingOk = comparisonIsContained({ status: stagingMerge?.status, behindBy: stagingMerge?.behind_by })
      || comparisonIsContained({ status: stagingHead?.status, behindBy: stagingHead?.behind_by });
    if (!stagingOk) throw new Error('PUBLISHED_MAIN content is not contained in live staging');
    const prodStatus = await githubClient(`/repos/${repo}/commits/${pr.merge_commit_sha}/status`);
    const vercel = statusForExactSha(prodStatus, pr.merge_commit_sha);
    if (vercel.vercel !== 'success') {
      throw new Error('PUBLISHED_MAIN requires Vercel success on merge_commit_sha');
    }
    const statuses = prodStatus?.statuses || [];
    if (statuses.some((item) => item.context === 'Vercel' && TRUSTED_PR_AUTHORS.includes(item.creator?.login))) {
      throw new Error('PUBLISHED_MAIN refused a coordinator-forged Vercel status');
    }
    return { prState: 'closed', merged: true, headSha: adoptedSha };
  }
  if (pr.state === 'open') {
    const comments = await commentsClient(`/repos/${repo}/issues/${prNumber}/comments`);
    const hasAudit = comments.some((comment) => TRUSTED_PR_AUTHORS.includes(comment?.user?.login)
      && String(comment?.body ?? '').includes(`automation-audit:${adoptedSha}`));
    if (!hasAudit) {
      await githubClient(`/repos/${repo}/issues/${prNumber}/comments`, {
        method: 'POST', body: { body: `<!-- supervisor-terminal:${runId}:${terminal}:${adoptedSha} -->\nSupervisor terminal **${terminal}** for exact SHA \`${adoptedSha}\`. This closes the staging candidate without merging; GitHub Actions gate policy was not bypassed.` },
      });
    }
    await githubClient(`/repos/${repo}/pulls/${prNumber}`, { method: 'PATCH', body: { state: 'closed' } });
  }
  const verified = await githubClient(`/repos/${repo}/pulls/${prNumber}`);
  const exact = validateOwnedPr({ pr: verified, expectedSha: adoptedSha, base: expectedBase });
  if (!exact.ok || verified.state !== 'closed' || verified.merged === true) {
    throw new Error(`terminal finalizer could not verify a closed, unmerged exact PR: ${exact.errors.join('; ')}`);
  }
  return { prState: 'closed', merged: false, headSha: adoptedSha };
}
