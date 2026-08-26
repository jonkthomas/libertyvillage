import { github, paged } from '../automation/github.mjs';
import { parseAuditRecord } from '../automation/recovery.mjs';
import { TRUSTED_PR_AUTHORS } from '../automation/constants.mjs';
import { isExactSha } from '../automation/policy.mjs';
import { comparisonIsContained, statusForExactSha } from './sha-monitor.mjs';

export function latestAuditForSha(comments, sha) {
  return comments
    .filter((comment) => TRUSTED_PR_AUTHORS.includes(comment?.user?.login))
    .map((comment) => parseAuditRecord(comment?.body)).filter((audit) => audit?.sha === sha)
    .at(-1) ?? null;
}

async function compareContained(repo, fromSha, toRef) {
  if (!isExactSha(fromSha)) return false;
  try {
    const comparison = await github(`/repos/${repo}/compare/${fromSha}...${toRef}`);
    return comparisonIsContained({ status: comparison?.status, behindBy: comparison?.behind_by });
  } catch {
    return false;
  }
}

async function optionalBranch(repo, name) {
  try {
    return await github(`/repos/${repo}/branches/${name}`);
  } catch {
    return null;
  }
}

export async function fetchObservation(repo, prNumber, sha) {
  const [pr, combined, comments, staging, main] = await Promise.all([
    github(`/repos/${repo}/pulls/${prNumber}`),
    github(`/repos/${repo}/commits/${sha}/status`),
    paged(`/repos/${repo}/issues/${prNumber}/comments`),
    optionalBranch(repo, 'staging'),
    optionalBranch(repo, 'main'),
  ]);
  const statuses = statusForExactSha(combined, sha);
  let productionVercel = 'missing';
  let stagingContained = false;
  let mainContained = false;
  let contentContainedInMain = false;
  if (pr?.merged && isExactSha(pr.merge_commit_sha)) {
    try {
      const prodStatus = await github(`/repos/${repo}/commits/${pr.merge_commit_sha}/status`);
      productionVercel = statusForExactSha(prodStatus, pr.merge_commit_sha).vercel ?? 'missing';
    } catch {
      productionVercel = 'missing';
    }
    mainContained = await compareContained(repo, pr.merge_commit_sha, 'main');
    contentContainedInMain = await compareContained(repo, sha, 'main');
    stagingContained = await compareContained(repo, pr.merge_commit_sha, 'staging')
      || await compareContained(repo, sha, 'staging');
  }
  return {
    pr, statuses,
    audit: latestAuditForSha(comments, sha),
    stagingSha: staging?.commit?.sha ?? null,
    mainSha: main?.commit?.sha ?? null,
    productionVercel, stagingContained, mainContained, contentContainedInMain,
  };
}
