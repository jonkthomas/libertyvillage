#!/usr/bin/env node
// Liberty Village ops fixer: one bounded pass over recent runner logs.
//
//   node fixer.mjs [--apply] [--log-root DIR] [--state-dir DIR]
//
// Dry run unless --apply: prints the plan, writes nothing and starts nothing.
// With --apply it appends every decision to <state-dir>/actions.jsonl (the
// durable who/what/why/result record the weekly digest reads) and starts at most
// one whitelisted runner unit (see policy.mjs). Runs as root on lv-content-runner
// from lv-ops-fixer.service; no runner env file, token or DB credential is loaded.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseRun } from '../weekly-digest/lib/digest.mjs';
import { planPass, unitFor } from './policy.mjs';

export const LOG_ROOT = '/var/log/lv-runner';
export const STATE_DIR = '/var/lib/lv-ops-fixer';
const HOLD = '/etc/lv-runner.hold';
const MAX_LOG_BYTES = 2 * 1024 * 1024;

/** Parsed runner runs whose log changed in the last `days` days. */
export function readRuns(logRoot, now, days = 3) {
  let names = [];
  try { names = fs.readdirSync(logRoot).filter((f) => f.endsWith('.jsonl')); } catch { return []; }
  const since = Date.parse(now) - days * 86_400_000;
  const runs = [];
  for (const name of names) {
    const file = path.join(logRoot, name);
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.mtimeMs < since || stat.size > MAX_LOG_BYTES) continue;
      const run = parseRun(name, fs.readFileSync(file, 'utf8'));
      if (run) runs.push(run);
    } catch { /* unreadable log: the digest reports it */ }
  }
  return runs;
}

/** Every record the fixer wrote before (tolerant of a torn last line). */
export function readHistory(file) {
  let text = '';
  // Only a missing log means "no history"; any other read error must not reset budgets.
  try { text = fs.readFileSync(file, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  return text.split('\n').flatMap((line) => {
    try { const r = JSON.parse(line); return r && typeof r === 'object' && typeof r.at === 'string' ? [r] : []; } catch { return []; }
  });
}

const appendRecord = (file, record) => fs.appendFileSync(file, `${JSON.stringify(record)}\n`, { mode: 0o640 });

function systemctl(args, run = spawnSync) {
  const result = run('systemctl', args, { encoding: 'utf8', timeout: 60_000 });
  return { status: result.status, stdout: String(result.stdout ?? '') };
}

/** Production jobs whose timer is enabled, from `systemctl is-enabled lv-runner-<job>.timer`. */
export function enabledJobs(jobs, run = spawnSync) {
  return jobs.filter((job) => systemctl(['is-enabled', `lv-runner-${job}.timer`], run).stdout.trim() === 'enabled');
}

/** Any lv-runner@ unit active, activating or queued right now. */
export function runnerBusy(run = spawnSync) {
  const out = systemctl(['list-units', '--all', '--plain', '--no-legend', '--no-pager', '--state=active,activating,deactivating', 'lv-runner@*'], run);
  return out.status !== 0 || out.stdout.trim().length > 0;
}

const TIMER_JOBS = ['topic-discovery', 'discover-businesses', 'news', 'weekly-growth-report', 'weekly-blog', 'october-blog-backfill', 'seo-improvements'];

/**
 * One pass. Injected `deps` keep it testable: {now, runs, history, enabledJobs,
 * held, busy, start(unit) -> {status}}. Returns {records, act, skipped, dryRun}.
 */
export function runPass({ apply = false, logFile, deps }) {
  const now = deps.now();
  const plan = planPass({ runs: deps.runs(), history: deps.history(), now, enabledJobs: deps.enabledJobs(), held: deps.held(), busy: deps.busy() });
  if (!apply) return { ...plan, dryRun: true };
  for (const record of plan.records) {
    if (record !== plan.act) appendRecord(logFile, record);
  }
  if (plan.act) {
    // Reserve first: the 'acted' row counts against the budget even if this
    // process dies between starting the unit and recording how it went.
    let unit = null;
    try { unit = unitFor(plan.act); } catch { /* recorded as failed-to-start below */ }
    plan.act.unit = unit;
    plan.act.result = 'starting';
    appendRecord(logFile, plan.act);
    let result = 'failed-to-start';
    try { if (unit && deps.start(unit).status === 0) result = 'started'; } catch { /* failed-to-start */ }
    plan.act.result = result;
    appendRecord(logFile, { at: deps.now(), run: plan.act.run, decision: 'outcome', actor: plan.act.actor, unit, result });
  }
  return { ...plan, dryRun: false };
}

function main(argv = process.argv.slice(2)) {
  const opts = { apply: false, logRoot: LOG_ROOT, stateDir: STATE_DIR };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--apply') opts.apply = true;
    else if (argv[i] === '--log-root') opts.logRoot = argv[++i];
    else if (argv[i] === '--state-dir') opts.stateDir = argv[++i];
    else throw new Error(`unsupported option ${argv[i]}`);
  }
  const logFile = path.join(opts.stateDir, 'actions.jsonl');
  if (opts.apply) fs.mkdirSync(opts.stateDir, { recursive: true, mode: 0o750 });
  const result = runPass({
    apply: opts.apply, logFile,
    deps: {
      now: () => new Date().toISOString(),
      runs: () => readRuns(opts.logRoot, new Date().toISOString()),
      history: () => readHistory(logFile),
      enabledJobs: () => enabledJobs(TIMER_JOBS),
      held: () => fs.existsSync(HOLD),
      busy: () => runnerBusy(),
      start: (unit) => systemctl(['start', '--no-block', unit]),
    },
  });
  console.log(JSON.stringify({ dryRun: result.dryRun, skipped: result.skipped ?? null, records: result.records }, null, 1));
}

// realpath: a symlinked install path (e.g. macOS /var -> /private/var) must still run main.
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  try { main(); } catch (error) { console.error(`ops fixer failed: ${error.message}`); process.exitCode = 1; }
}
