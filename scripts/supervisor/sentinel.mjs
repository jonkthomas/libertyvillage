import { MONITOR_LIMIT_MS, statusForExactSha, validateOwnedPr } from './sha-monitor.mjs';
import { leaseIsLive } from './lease.mjs';

export function activeOwnedRuns(ledger) {
  return (ledger?.runs || []).filter((run) => !run.terminal && Number.isInteger(run.pr_number));
}

export function evaluateSentinel({ ledger, observations = new Map(), now = Date.now(), pidAlive }) {
  const findings = [];
  if (ledger?.lease && !leaseIsLive(ledger.lease, { now, pidAlive })) {
    findings.push({ key: `${ledger.lease.run_id}:stale-lease`, runId: ledger.lease.run_id, message: `stale local lease ${ledger.lease.run_id}` });
  }
  for (const run of activeOwnedRuns(ledger)) {
    const observation = observations.get(run.pr_number);
    if (!observation) {
      findings.push({ key: `${run.run_id}:missing-pr`, runId: run.run_id, message: `owned PR #${run.pr_number} could not be read` });
      continue;
    }
    const owned = validateOwnedPr({ pr: observation.pr, expectedSha: run.head_sha, base: 'main' });
    if (!owned.ok && observation.pr?.state === 'open') {
      findings.push({ key: `${run.run_id}:identity-drift`, runId: run.run_id, message: `owned PR #${run.pr_number} drifted: ${owned.errors.join('; ')}` });
      continue;
    }
    try { statusForExactSha(observation.status, run.head_sha); } catch (error) {
      findings.push({ key: `${run.run_id}:status-drift`, runId: run.run_id, message: `owned PR #${run.pr_number} status drifted: ${error.message}` });
      continue;
    }
    const started = Date.parse(run.started_at ?? '');
    const pastBound = !Number.isFinite(started) || now - started >= MONITOR_LIMIT_MS;
    if (observation.pr?.state === 'open' && pastBound) {
      findings.push({ key: `${run.run_id}:open-beyond-bound`, runId: run.run_id, message: `owned PR #${run.pr_number} remains open beyond the four-hour pilot bound` });
    }
    if (observation.pr?.merged === true && observation.pr?.base?.ref === 'main' && pastBound) {
      findings.push({
        key: `${run.run_id}:merged-nonterminal`,
        runId: run.run_id,
        message: `owned PR #${run.pr_number} merged to main but is non-terminal past the four-hour bound; production may have the post while Vercel or staging sync is incomplete`,
      });
    }
  }
  return findings;
}
