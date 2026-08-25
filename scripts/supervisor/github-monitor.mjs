import { github, paged } from '../automation/github.mjs';
import { parseAuditRecord } from '../automation/recovery.mjs';
import { TRUSTED_PR_AUTHORS } from '../automation/constants.mjs';
import { statusForExactSha } from './sha-monitor.mjs';

export function latestAuditForSha(comments, sha) {
  return comments
    .filter((comment) => TRUSTED_PR_AUTHORS.includes(comment?.user?.login))
    .map((comment) => parseAuditRecord(comment?.body)).filter((audit) => audit?.sha === sha)
    .at(-1) ?? null;
}

export async function fetchObservation(repo, prNumber, sha) {
  const [pr, combined, comments, staging] = await Promise.all([
    github(`/repos/${repo}/pulls/${prNumber}`),
    github(`/repos/${repo}/commits/${sha}/status`),
    paged(`/repos/${repo}/issues/${prNumber}/comments`),
    github(`/repos/${repo}/branches/staging`),
  ]);
  return {
    pr, statuses: statusForExactSha(combined, sha),
    audit: latestAuditForSha(comments, sha),
    stagingSha: staging?.commit?.sha ?? null,
  };
}
