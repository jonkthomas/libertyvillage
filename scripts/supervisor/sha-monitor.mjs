import { TRUSTED_PR_AUTHORS } from '../automation/constants.mjs';
import { isExactSha } from '../automation/policy.mjs';
import { nextRetry } from '../automation/recovery.mjs';
import { statusForExactSha } from '../automation/statuses.mjs';

export const MONITOR_LIMIT_MS = 4 * 60 * 60 * 1000;
export const LOST_STATUS_MS = 15 * 60 * 1000;

export function validateOwnedPr({ pr, expectedSha, base } = {}) {
  const errors = [];
  const expectedBase = base ?? 'staging';
  if (!isExactSha(expectedSha)) errors.push('expected SHA is not exact');
  if (!pr || pr.head?.sha !== expectedSha) errors.push('pull request head SHA drifted');
  if (!['staging', 'main'].includes(expectedBase)) errors.push(`pull request base is not a supervised branch: ${expectedBase}`);
  if (pr?.base?.ref !== expectedBase) errors.push(`pull request base is not ${expectedBase}`);
  if (!String(pr?.head?.ref ?? '').startsWith('blog/auto-')) errors.push('pull request branch is not blog/auto-*');
  if (!TRUSTED_PR_AUTHORS.includes(pr?.user?.login)) errors.push('pull request author is untrusted');
  if (pr?.head?.repo?.fork === true) errors.push('fork pull requests are not owned');
  return { ok: errors.length === 0, errors };
}

export function mayRepin({ oldSha, newSha, parents }) {
  if (![oldSha, newSha].every(isExactSha) || oldSha === newSha) return false;
  if (!Array.isArray(parents)) return false;
  return parents.includes(oldSha);
}

export function lostDispatchRetry({ attempts, missingSince, now = Date.now() }) {
  if (!Number.isFinite(missingSince) || now - missingSince < LOST_STATUS_MS) return { action: 'wait' };
  return nextRetry({ attempts, classification: 'transient' });
}

function contained({ status, behindBy }) {
  return ['ahead', 'identical'].includes(status) && Number(behindBy || 0) === 0;
}

export function terminalFromObservation({
  pr, sha, auditDecision, base = 'staging',
  stagingContained = false, mainContained = false,
  productionVercel = 'missing', contentContainedInMain = false,
} = {}) {
  const owned = validateOwnedPr({ pr, expectedSha: sha, base });
  if (!owned.ok && !pr?.merged) return { terminal: 'INGEST_FAILED', errors: owned.errors };
  if (pr?.merged) {
    const mergedIdentity = validateOwnedPr({ pr, expectedSha: pr?.head?.sha, base });
    if (!mergedIdentity.ok) return { terminal: 'INGEST_FAILED', errors: mergedIdentity.errors };
  }
  if (pr?.state === 'open') {
    if (['validation-failed'].includes(auditDecision)) return { terminal: 'BLOCKED_VALIDATION' };
    if (['exhausted'].includes(auditDecision)) return { terminal: 'BLOCKED_EXHAUSTED' };
    if (['unrepairable', 'blocked', 'error'].includes(auditDecision)) return { terminal: 'BLOCKED_UNREPAIRABLE' };
    return { terminal: null };
  }
  if (pr?.merged && isExactSha(pr.merge_commit_sha)) {
    if (pr.base?.ref === 'main') {
      if (!mainContained || !stagingContained || productionVercel !== 'success' || !contentContainedInMain) {
        return { terminal: null };
      }
      return { terminal: 'PUBLISHED_MAIN' };
    }
    return { terminal: 'MERGED_STAGING' };
  }
  return { terminal: 'BLOCKED_VALIDATION' };
}

export { contained as comparisonIsContained };
export { statusForExactSha };
