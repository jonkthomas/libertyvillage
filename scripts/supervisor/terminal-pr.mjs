import { github, paged } from '../automation/github.mjs';
import { isExactSha } from '../automation/policy.mjs';
import { mayRepin, validateOwnedPr } from './sha-monitor.mjs';
import { TRUSTED_PR_AUTHORS } from '../automation/constants.mjs';

const NO_LADDER_TERMINALS = new Set(['MERGED_STAGING', 'SKIPPED_OWNER', 'SKIPPED_CANDIDATE', 'ABANDONED_TOPIC', 'DRY_RUN', 'BASELINE_FAILED']);

export function terminalRequiresCandidateOutcome({ terminal, topicKey }) {
  return Boolean(topicKey) && !NO_LADDER_TERMINALS.has(terminal);
}

// Canonical terminal ordering: durable ladder first, exact owned PR closure second.
// The run_id-backed outcome key makes a reclaimed/replayed terminal idempotent.
export async function finalizeSupervisorTerminal({ repo, run, terminal, expectedSha, reason, recordOutcome, finalizePr = finalizeOwnedPr }) {
  if (terminalRequiresCandidateOutcome({ terminal, topicKey: run.topic_key })) {
    await recordOutcome({ terminal, topicKey: run.topic_key, reason });
  }
  if (!run.pr_number) return { prState: undefined, merged: false };
  return finalizePr({ repo, prNumber: run.pr_number, expectedSha, terminal, runId: run.run_id });
}

export async function finalizeOwnedPr({ repo, prNumber, expectedSha, terminal, runId, githubClient = github, commentsClient = paged }) {
  if (!Number.isInteger(prNumber) || prNumber <= 0) throw new Error('terminal finalizer requires the exact ledger PR number');
  if (!isExactSha(expectedSha)) throw new Error('terminal finalizer requires the exact ledger head SHA');
  const pr = await githubClient(`/repos/${repo}/pulls/${prNumber}`);
  const liveSha = pr?.head?.sha;
  const identity = validateOwnedPr({ pr, expectedSha: liveSha });
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
  const owned = validateOwnedPr({ pr, expectedSha: adoptedSha });
  if (!owned.ok) throw new Error(`terminal finalizer refused PR identity drift: ${owned.errors.join('; ')}`);
  if (terminal === 'MERGED_STAGING') {
    if (pr.state !== 'closed' || pr.merged !== true || !isExactSha(pr.merge_commit_sha)) {
      throw new Error('MERGED_STAGING requires a closed, merged owned PR');
    }
    const comparison = await githubClient(`/repos/${repo}/compare/${pr.merge_commit_sha}...staging`);
    if (!['ahead', 'identical'].includes(comparison?.status) || Number(comparison?.behind_by || 0) !== 0) {
      throw new Error('MERGED_STAGING merge commit is not contained in live staging');
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
  const exact = validateOwnedPr({ pr: verified, expectedSha: adoptedSha });
  if (!exact.ok || verified.state !== 'closed' || verified.merged === true) {
    throw new Error(`terminal finalizer could not verify a closed, unmerged exact PR: ${exact.errors.join('; ')}`);
  }
  return { prState: 'closed', merged: false, headSha: adoptedSha };
}
