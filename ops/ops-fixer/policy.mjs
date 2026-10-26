// Autonomous ops fixer policy (John's decision 1a): known content/ops failures
// get ONE of a few whitelisted, idempotent actions; everything else is left to
// the existing fix-it agent, which files GitHub issues from the weekly digest.
// Pure and clock-injectable: no fs, no network, no process spawning here.
//
// The fixer never edits code, pushes, deploys code, touches the hold switch or
// writes the content DB itself. Every action starts an existing runner unit, the
// same one its systemd timer starts, so all privileged work stays inside the
// runner's own sandbox, global lock, gate and cadence budgets.
import { explain, normalizeCode } from '../weekly-digest/lib/plain-english.mjs';

// The only things the fixer can do. Each maps to one runner unit start.
export const ACTIONS = Object.freeze({
  // Same job again, exactly as its timer would start it.
  'rerun-job': { unit: (job) => job },
  // The blog job again: this week's tried topics are excluded by the DB cadence
  // attempts (runner weekFingerprints), so the run moves on to the next topic.
  'next-topic': { unit: () => 'weekly-blog' },
  // `content deploy --target production`: re-POST the deploy hook, then smoke
  // every published-but-pending submission (runner job deploy-retry).
  'retry-deploy': { unit: () => 'deploy-retry' },
});

const TRANSIENT = { action: 'rerun-job', perDay: 1, perWeek: 3 };
const BAD_TOPIC = { action: 'next-topic', perDay: 1, perWeek: 2, jobs: ['weekly-blog'] };
const REBUILD = { action: 'retry-deploy', perDay: 2, perWeek: 4 };

// Explicit allowlist: plain-English code -> action + retry budget. A code that
// is not here is never acted on.
export const ALLOWLIST = Object.freeze({
  // Temporary infrastructure trouble: run the same job again.
  'cli-network': TRANSIENT,
  'cli-server': TRANSIENT,
  'cli-timeout': TRANSIENT,
  'cli-conflict': TRANSIENT,
  timeout: TRANSIENT,
  'no healthy news source': { ...TRANSIENT, perWeek: 2 },
  'roundup model technical failure': { ...TRANSIENT, perWeek: 2 },
  'writer safety rule': { ...TRANSIENT, perWeek: 2 },
  // The job's own start-up recovers stale or unfinished earlier attempts.
  'prior content unresolved': { ...TRANSIENT, perWeek: 2 },
  'no terminal event': { ...TRANSIENT, perWeek: 1 },
  // Bad or duplicate topic: swap to the next topic (weekly blog only).
  'business-outside-pack': BAD_TOPIC,
  'draft-changed-topic': BAD_TOPIC,
  'blog-lint': BAD_TOPIC,
  'unsupported-grounding': BAD_TOPIC,
  'blog generated no post': BAD_TOPIC,
  'gate blocked or rejected': BAD_TOPIC,
  'not-converging': BAD_TOPIC,
  unrepairable: BAD_TOPIC,
  exhausted: BAD_TOPIC,
  block: BAD_TOPIC,
  'cli-validation': BAD_TOPIC,
  validation: BAD_TOPIC,
  // Post saved but the site never rebuilt or showed it: retry the rebuild.
  'hook-failed': REBUILD,
  'smoke-timeout': REBUILD,
  'publish or propagation pending': REBUILD,
});

// Code bugs and unknown failures: no action, the fix-it agent investigates and
// files the GitHub issue (unchanged behaviour). Unknown codes land here too.
export const ESCALATE = Object.freeze(new Set([
  'operational-error', 'cli-operation', 'cli-target', 'cli-permission', 'invalid-json', 'safety stop', 'state-error',
]));

// Never more than this many actions in 24 hours, whatever the per-code budgets say.
export const DAILY_ACTION_CAP = 6;
// Only fresh failures: a newly enabled fixer must not replay an old backlog.
export const MAX_FAILURE_AGE_HOURS = 48;
// A run with no terminal event after this long was killed (digest uses the same rule).
const STALE_RUN_HOURS = 4;
const HOUR = 3600_000;

const baseCode = (code) => (code.startsWith('blog-lint:') ? 'blog-lint' : code);

/** The failure code of one parsed runner run (parseRun row), normalized to the plain-English map. */
export function runCode(run, now) {
  if (run?.outcome === 'incomplete' && run.startedAt && Date.parse(now) - Date.parse(run.startedAt) > STALE_RUN_HOURS * HOUR) return 'no terminal event';
  if (run?.outcome !== 'failure') return null;
  return baseCode(normalizeCode(run.error ?? run.detail ?? run.reason ?? 'operational-error') || 'operational-error');
}

/**
 * What the fixer would do about one code on one job, ignoring budgets:
 * {decision: 'act', action, budget} | {decision: 'escalate'} | {decision: 'ignore'}.
 * 'ignore' = known and needs no automatic action (benign, or already a "needs you" alert).
 */
export function classify(code, job) {
  const entry = Object.hasOwn(ALLOWLIST, code) ? ALLOWLIST[code] : null;
  if (entry && (!entry.jobs || entry.jobs.includes(job))) {
    return { decision: 'act', action: entry.action, budget: { perDay: entry.perDay, perWeek: entry.perWeek } };
  }
  if (entry) return { decision: 'ignore' };
  if (ESCALATE.has(code) || !explain(code).known) return { decision: 'escalate' };
  return { decision: 'ignore' };
}

// Budgets are per code and per unit started, so a rebuild retried from the blog
// job and again from a failed deploy-retry run draws on one budget.
const actedWithin = (history, { code, unitJob }, sinceMs) => history.filter((h) => h.decision === 'acted'
  && h.code === code && h.unitJob === unitJob && Date.parse(h.at) >= sinceMs).length;

/**
 * Plan one fixer pass. Inputs:
 * - runs: parsed runner runs (parseRun rows), any order;
 * - history: previous action-log records ({at, run, decision, code, job, ...});
 * - enabledJobs: production jobs whose systemd timer is enabled;
 * - held: hold switch present; busy: a runner unit is active right now.
 * Returns {records, act}: `records` are the log lines to write (escalations,
 * exhausted budgets and the chosen action), `act` the single action to run, or null.
 * At most one action per pass: runner jobs never overlap (global lock).
 */
export function planPass({ runs = [], history = [], now, enabledJobs = [], held = false, busy = false } = {}) {
  const nowMs = Date.parse(now);
  const at = new Date(nowMs).toISOString();
  if (held) return { records: [], act: null, skipped: 'hold switch on' };
  if (busy) return { records: [], act: null, skipped: 'a runner job is active (or runner state unknown)' };
  const handled = new Set(history.map((h) => h.run));
  const enabled = new Set(enabledJobs);
  const production = runs.filter((r) => r?.target === 'production' && r.job && r.startedAt);
  // Only the latest run of each job counts: a later success or a run in
  // progress already settles (or is settling) the earlier failure.
  const latest = new Map();
  for (const r of production) {
    const prev = latest.get(r.job);
    if (!prev || Date.parse(r.startedAt) > Date.parse(prev.startedAt)) latest.set(r.job, r);
  }
  const records = [];
  let act = null;
  let actedToday = history.filter((h) => h.decision === 'acted' && Date.parse(h.at) >= nowMs - 24 * HOUR).length;
  const candidates = [...latest.values()].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  for (const run of candidates) {
    const code = runCode(run, now);
    if (!code || handled.has(run.file)) continue;
    if (nowMs - Date.parse(run.startedAt) > MAX_FAILURE_AGE_HOURS * HOUR) continue;
    const base = { at, run: run.file, job: run.job, target: run.target, slot: run.slot, code, actor: 'lv-ops-fixer' };
    const verdict = classify(code, run.job);
    if (verdict.decision === 'ignore') continue;
    if (verdict.decision === 'escalate') { records.push({ ...base, decision: 'escalated', why: 'not a known safe fix; left for the fix-it agent' }); continue; }
    const unitJob = ACTIONS[verdict.action].unit(run.job);
    // Timer off (or no timer): not ours to start. deploy-retry is the fixer's own job.
    if (!enabled.has(run.job) && run.job !== 'deploy-retry') continue;
    const day = actedWithin(history, { code, unitJob }, nowMs - 24 * HOUR);
    const week = actedWithin(history, { code, unitJob }, nowMs - 7 * 24 * HOUR);
    if (day >= verdict.budget.perDay || week >= verdict.budget.perWeek) {
      // Daily-budget stops wait for tomorrow; a spent weekly budget hands over.
      if (week >= verdict.budget.perWeek) records.push({ ...base, decision: 'budget-exhausted', action: verdict.action, tries: week, why: 'retry budget used up; left for the fix-it agent' });
      continue;
    }
    if (act || actedToday >= DAILY_ACTION_CAP) continue; // next pass picks it up
    act = { ...base, decision: 'acted', action: verdict.action, unitJob, attempt: week + 1, actor: 'lv-ops-fixer', why: explain(code).title };
    actedToday += 1;
  }
  if (act) records.push(act);
  return { records, act };
}

/** systemd unit the action starts: the exact unit the job's timer starts. */
export function unitFor(act) {
  if (!act || !Object.hasOwn(ACTIONS, act.action) || !/^[a-z][a-z-]{1,40}$/.test(act.unitJob)) throw new Error('invalid action');
  return `lv-runner@${act.unitJob}:production:scheduled.service`;
}
