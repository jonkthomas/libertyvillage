#!/usr/bin/env node
// Read-only planner for the scheduled promotion sweep (PRD ticket 3b).
//
// The ordinary promotion path is fire-and-forget: pass-generator observes the
// staging merge and dispatches the cumulative promotion. A dropped dispatch, or an
// observation window that simply ran out (F10/F11), leaves `main` stranded behind
// `staging` with nothing scheduled to notice. This tick notices.
//
// It decides, it does not act: the decision is written to the step outputs and the
// workflow performs the one dispatch through the coordinator's single dispatch
// binding site. Every guard lives in recovery.planPromotionSweep, which is pure.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { github, paged, writeOutput } from './github.mjs';
import {
  isPromotionCoordinatorRun, planPromotionSweep, PROMOTION_STALE_HOURS,
  selectRecentDispatchRuns, SWEEP_MIN_DISPATCH_INTERVAL_HOURS,
} from './recovery.mjs';

// Only a PROMOTION dispatch counts as "this tick already dispatched". Counting any
// coordinator dispatch let ordinary blog/SEO/news generator activity — which happens
// several times a week — suppress the sweep forever, leaving `main` stranded behind
// `staging` with the one mechanism built to notice permanently stood down.
//
// The dispatch payload is not readable from the runs API, so the run's job graph is
// the evidence: a promotion dispatch runs `validate-promotion`, a generator dispatch
// skips it. Only the runs recent enough to matter are inspected, newest first.
async function lastPromotionDispatchAt(repo, now) {
  let runs;
  try {
    const response = await github(`/repos/${repo}/actions/workflows/autonomous-coordinator.yml/runs?event=repository_dispatch&per_page=30`);
    runs = response?.workflow_runs ?? [];
  } catch (error) {
    // Unknown recent-dispatch history means we cannot prove we are not racing.
    console.log(`Cannot read coordinator run history (${error.message}); treating this tick as already dispatched.`);
    return new Date(now).toISOString();
  }
  for (const run of selectRecentDispatchRuns(runs, { now })) {
    let jobs;
    try {
      jobs = (await github(`/repos/${repo}/actions/runs/${run.id}/jobs?per_page=100`))?.jobs ?? [];
    } catch (error) {
      console.log(`Cannot read jobs for run ${run.id} (${error.message}); treating this tick as already dispatched.`);
      return new Date(now).toISOString();
    }
    if (isPromotionCoordinatorRun(jobs)) {
      console.log(`Run ${run.id} at ${run.created_at} was a promotion dispatch; the sweep stands down this tick.`);
      return run.created_at;
    }
    console.log(`Run ${run.id} at ${run.created_at} was a generator dispatch; it does not suppress the promotion sweep.`);
  }
  return null;
}

function writeSummary(lines) {
  const text = `${lines.join('\n')}\n`;
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
  else console.log(text);
}

async function main() {
  const repo = process.argv.includes('--repo') ? process.argv[process.argv.indexOf('--repo') + 1] : process.env.GITHUB_REPOSITORY;
  if (!repo) throw new Error('missing --repo');
  const owner = repo.split('/')[0];

  const now = Date.now();
  const [comparison, staging, openPromotionPrs, lastDispatchAt] = await Promise.all([
    github(`/repos/${repo}/compare/main...staging`),
    github(`/repos/${repo}/branches/staging`),
    paged(`/repos/${repo}/pulls?state=open&base=main&head=${encodeURIComponent(`${owner}:staging`)}`),
    lastPromotionDispatchAt(repo, now),
  ]);

  const stagingSha = staging?.commit?.sha;
  const stagingHeadAt = staging?.commit?.commit?.committer?.date ?? staging?.commit?.commit?.author?.date ?? null;
  const plan = planPromotionSweep({
    aheadBy: comparison?.ahead_by,
    stagingHeadAt,
    openPromotionPrs,
    lastDispatchAt,
    stagingSha,
    now,
  });

  writeOutput({ action: plan.action, sha: plan.sha ?? '', reason: plan.reason });
  // Durable evidence a human can read after the fact: every tick says what it saw
  // and what it did, whether or not it dispatched.
  writeSummary([
    '## Promotion sweep',
    '',
    `- decision: **${plan.action}**`,
    `- reason: ${plan.reason}`,
    `- main is behind staging by: ${comparison?.ahead_by ?? 'unknown'} commit(s)`,
    `- staging head: \`${stagingSha ?? 'unknown'}\` (${stagingHeadAt ?? 'unknown'})`,
    `- open promotion PRs: ${openPromotionPrs.length ? openPromotionPrs.map((pr) => `#${pr.number}`).join(', ') : 'none'}`,
    `- last **promotion** coordinator dispatch: ${lastDispatchAt ?? 'none in the suppression window'}`,
    '- (generator dispatches are deliberately not counted here — they must never suppress the sweep)',
    `- thresholds: staging head older than ${PROMOTION_STALE_HOURS}h, at most one dispatch per ${SWEEP_MIN_DISPATCH_INTERVAL_HOURS}h`,
    '',
    plan.action === 'dispatch'
      ? `Dispatching the cumulative promotion for exact staging SHA \`${plan.sha}\`.`
      : 'No dispatch this tick.',
  ]);
  console.log(`Promotion sweep: ${plan.action} — ${plan.reason}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    writeOutput({ action: 'skip', sha: '', reason: `sweep failed closed: ${error.message}` });
    process.exitCode = 1;
  }
}
