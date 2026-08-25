#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { github } from '../automation/github.mjs';
import { acquireAtomicLock, leaseIsLive, newLease, pidAlive, releaseAtomicLock } from './lease.mjs';
import { readLedger, repairLedger, terminalizeRun, updateLedger } from './ledger.mjs';
import { cleanupDataBranch, recordSupervisorOutcome, resolveHostWeeklyOwner, runBlogSupervisor } from './host-run.mjs';
import { smokePiSession } from './pi-session.mjs';
import { activeOwnedRuns, evaluateSentinel } from './sentinel.mjs';
import { finalizeSupervisorTerminal } from './terminal-pr.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const STATE_DIR = process.env.LV_STATE_DIR || '/var/lib/lv-supervisor';
const LEDGER_FILE = process.env.LV_LEDGER || path.join(STATE_DIR, 'ledger.json');
const OWNER_LOCK = path.join(STATE_DIR, 'run.owner');
const FLOCK_PATH = path.join(STATE_DIR, 'run.flock');
const REPO = process.env.LV_GITHUB_REPOSITORY || 'jonkthomas/libertyvillage';
export const MAX_RECOVERY_ATTEMPTS = 3;

function persistRun(runId, changes) {
  updateLedger(LEDGER_FILE, (ledger) => {
    const index = ledger.runs.findIndex((run) => run.run_id === runId);
    if (index < 0) throw new Error(`ledger run is missing: ${runId}`);
    const update = { ...changes, updated_at: new Date().toISOString() };
    if (changes.sha_reason && changes.head_sha) {
      update.sha_history = [...(ledger.runs[index].sha_history || []), { sha: changes.head_sha, reason: changes.sha_reason, at: update.updated_at }];
      delete update.sha_reason;
    }
    ledger.runs[index] = { ...ledger.runs[index], ...update };
    if (ledger.lease?.run_id === runId) ledger.lease.heartbeat_at = update.updated_at;
    return ledger;
  });
}

async function settleTerminal(runRow, terminal, expectedSha, reason) {
  return finalizeSupervisorTerminal({
    repo: REPO, run: runRow, terminal, expectedSha, reason,
    recordOutcome: ({ terminal: outcome, topicKey, reason: outcomeReason }) => recordSupervisorOutcome({
      repoRoot: REPO_ROOT, repo: REPO, runId: runRow.run_id, topicKey, terminal: outcome, reason: outcomeReason,
    }),
  });
}

function withAdoptedHead(runRow, finalized, reason) {
  if (!finalized?.headSha || finalized.headSha === runRow.head_sha) return runRow;
  const at = new Date().toISOString();
  return {
    ...runRow,
    head_sha: finalized.headSha,
    sha_history: [...(runRow.sha_history || []), { sha: finalized.headSha, reason, at }],
    updated_at: at,
  };
}

export async function recoverUnfinishedRows(rows, { reconcile, markFailure, maxAttempts = MAX_RECOVERY_ATTEMPTS }) {
  const results = [];
  for (const row of rows) {
    const priorAttempts = Number.isSafeInteger(row.recovery_attempts) && row.recovery_attempts >= 0 ? row.recovery_attempts : 0;
    if (row.state === 'RECOVERY_PARKED' || priorAttempts >= maxAttempts) {
      results.push({ runId: row.run_id, recovered: false, parked: true, attempts: priorAttempts });
      continue;
    }
    try {
      await reconcile(row);
      results.push({ runId: row.run_id, recovered: true });
    } catch (error) {
      const attempts = priorAttempts + 1;
      const parked = attempts >= maxAttempts;
      await markFailure(row, error, { attempts, parked });
      results.push({ runId: row.run_id, recovered: false, parked, attempts, error: error.message });
    }
  }
  return results;
}

export function resolveSmokeAgentDir(args, fallback) {
  const index = args.indexOf('--agent-dir');
  if (index < 0) return fallback;
  if (!args[index + 1]) throw new Error('--agent-dir requires a path');
  return path.resolve(args[index + 1]);
}

async function run(dryRun) {
  if (resolveHostWeeklyOwner(REPO_ROOT) !== 'exedev') {
    console.log('SKIPPED_OWNER: trusted remote weekly owner is gha');
    return;
  }
  fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  const now = new Date();
  const runId = `blog-${now.toISOString().replace(/[.:]/g, '-')}`;
  const lease = newLease({ runId, lockPath: FLOCK_PATH, now });
  const lock = acquireAtomicLock(OWNER_LOCK, lease, { isLive: (current) => leaseIsLive(current, { pidAlive }) });
  if (!lock.acquired) {
    console.log(`SKIPPED_LEASE: ${lock.current?.run_id ?? 'unknown'} is active`);
    return;
  }
  const pending = readLedger(LEDGER_FILE).runs.filter((entry) => !entry.terminal && entry.state !== 'RECOVERY_PARKED');
  await recoverUnfinishedRows(pending, {
    reconcile: async (staleRun) => {
      let recoveryTerminal = 'MONITOR_TIMEOUT';
      if (staleRun.pr_number) {
        const pr = await github(`/repos/${REPO}/pulls/${staleRun.pr_number}`);
        if (pr?.merged === true && /^[0-9a-f]{40}$/.test(pr.merge_commit_sha || '')) recoveryTerminal = 'MERGED_STAGING';
      }
      const finalized = await settleTerminal(staleRun, recoveryTerminal, staleRun.head_sha, 'reconciled unfinished supervisor run');
      if (staleRun.data_branch) cleanupDataBranch(REPO_ROOT, staleRun.data_branch);
      updateLedger(LEDGER_FILE, (ledger) => {
        const index = ledger.runs.findIndex((entry) => entry.run_id === staleRun.run_id);
        const adopted = withAdoptedHead(ledger.runs[index], finalized, 'recovered-live-head');
        ledger.runs[index] = terminalizeRun(adopted, recoveryTerminal, { prState: finalized.prState });
        if (ledger.lease?.run_id === staleRun.run_id) ledger.lease = null;
        return ledger;
      });
    },
    markFailure: async (staleRun, error, { attempts, parked }) => {
      if (staleRun.data_branch) {
        try { cleanupDataBranch(REPO_ROOT, staleRun.data_branch); } catch (cleanupError) { error.message += `; cleanup: ${cleanupError.message}`; }
      }
      updateLedger(LEDGER_FILE, (ledger) => {
        const index = ledger.runs.findIndex((entry) => entry.run_id === staleRun.run_id);
        if (index >= 0) ledger.runs[index] = {
          ...ledger.runs[index], state: parked ? 'RECOVERY_PARKED' : 'RECOVERY_REQUIRED', recovery_attempts: attempts,
          error: `recovery failed (${attempts}/${MAX_RECOVERY_ATTEMPTS}): ${error.message}`, updated_at: new Date().toISOString(),
        };
        if (ledger.lease?.run_id === staleRun.run_id) ledger.lease = null;
        return ledger;
      });
      console.error(`recovery ${parked ? 'parked' : 'failed'} for ${staleRun.run_id} after ${attempts}/${MAX_RECOVERY_ATTEMPTS} attempts; continuing with remaining rows: ${error.message}`);
    },
  });
  const row = {
    run_id: runId, kind: 'blog', owner: 'exedev', state: 'CLAIM_LEASE', topic_key: null,
    pr_number: null, head_sha: null, sha_history: [], budgets: { transient: 0, monitor_redispatch: 0 },
    terminal: null, terminal_at: null, error: null, started_at: now.toISOString(), updated_at: now.toISOString(),
  };
  updateLedger(LEDGER_FILE, (ledger) => {
    ledger.lease = lease; ledger.runs.push(row); return ledger;
  });
  const heartbeat = setInterval(() => {
    try { persistRun(runId, {}); } catch (error) { console.error(`heartbeat failed: ${error.message}`); }
  }, 30_000);
  heartbeat.unref();
  try {
    const result = await runBlogSupervisor({
      repoRoot: REPO_ROOT, stateDir: STATE_DIR, repo: REPO, run: row, dryRun,
      onUpdate: async (changes) => persistRun(runId, changes),
    });
    let ledger = readLedger(LEDGER_FILE);
    const index = ledger.runs.findIndex((entry) => entry.run_id === runId);
    let prState = result.prState;
    const finalized = await settleTerminal(
      ledger.runs[index], result.terminal, result.sha || ledger.runs[index].head_sha,
      result.reason || `supervisor terminal ${result.terminal}`,
    );
    prState = finalized.prState;
    updateLedger(LEDGER_FILE, (latest) => {
      const latestIndex = latest.runs.findIndex((entry) => entry.run_id === runId);
      const adopted = withAdoptedHead(latest.runs[latestIndex], finalized, 'terminal-live-head');
      latest.runs[latestIndex] = terminalizeRun(adopted, result.terminal, { prState });
      latest.lease = null; return latest;
    });
    console.log(`${result.terminal}: ${runId}`);
    if (!['MERGED_STAGING', 'SKIPPED_OWNER', 'SKIPPED_CANDIDATE', 'DISCARDED_PRE_PR', 'DRY_RUN'].includes(result.terminal)) process.exitCode = 1;
  } catch (error) {
    const snapshot = readLedger(LEDGER_FILE);
    const current = snapshot.runs.find((entry) => entry.run_id === runId);
    const terminal = current?.pr_number ? 'MONITOR_TIMEOUT'
      : current?.state === 'BASELINE_CI' ? 'BASELINE_FAILED'
        : current?.state === 'LINT' ? 'DISCARDED_PRE_PR'
          : ['PUSH_DATA_BRANCH', 'WAIT_INGEST'].includes(current?.state) ? 'INGEST_FAILED'
            : 'GENERATION_FAILED_PRE_PR';
    try {
      if (current?.data_branch) cleanupDataBranch(REPO_ROOT, current.data_branch);
      const finalized = await settleTerminal(current, terminal, current?.head_sha, error.message);
      updateLedger(LEDGER_FILE, (ledger) => {
        const index = ledger.runs.findIndex((entry) => entry.run_id === runId);
        const adopted = withAdoptedHead(ledger.runs[index], finalized, 'terminal-live-head');
        ledger.runs[index] = { ...terminalizeRun(adopted, terminal, { prState: finalized.prState }), error: error.message };
        ledger.lease = null; return ledger;
      });
    } catch (terminalError) {
      updateLedger(LEDGER_FILE, (ledger) => {
        const index = ledger.runs.findIndex((entry) => entry.run_id === runId);
        ledger.runs[index] = { ...ledger.runs[index], state: 'TERMINALIZATION_FAILED', error: `${error.message}; terminalization: ${terminalError.message}`, updated_at: new Date().toISOString() };
        ledger.lease = null; return ledger;
      });
    }
    throw error;
  } finally {
    clearInterval(heartbeat);
    releaseAtomicLock(OWNER_LOCK);
  }
}

async function sentinel() {
  const ledger = readLedger(LEDGER_FILE);
  const observations = new Map();
  for (const runRow of activeOwnedRuns(ledger)) {
    const pr = await github(`/repos/${REPO}/pulls/${runRow.pr_number}`);
    const status = await github(`/repos/${REPO}/commits/${runRow.head_sha}/status`);
    observations.set(runRow.pr_number, { pr, status });
  }
  const findings = evaluateSentinel({ ledger, observations, pidAlive });
  const previous = new Set(ledger.sentinel_alert_keys || []);
  const fresh = findings.filter((finding) => !previous.has(finding.key));
  if (fresh.length && process.env.SLACK_WEBHOOK_URL) {
    await fetch(process.env.SLACK_WEBHOOK_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: fresh.map((finding) => finding.message).join('\n') }) });
  }
  updateLedger(LEDGER_FILE, (latest) => {
    latest.sentinel_alert_keys = findings.map((finding) => finding.key);
    return latest;
  });
  if (findings.length) { console.error(findings.map((finding) => finding.message).join('\n')); process.exitCode = 1; }
  else console.log('supervisor sentinel healthy');
}

async function smoke() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-pi-smoke-'));
  const agentDir = resolveSmokeAgentDir(process.argv.slice(3), path.join(directory, 'agent'));
  try {
    fs.mkdirSync(agentDir, { recursive: true, mode: 0o700 });
    const result = await smokePiSession({ cwd: directory, agentDir });
    console.log(`smoke passed with active tools=${result.active.join(',')}; agentDir=${agentDir}; local stub used no network, branch, dispatch, or PR operation`);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

async function main() {
  const command = process.argv[2] || 'status';
  if (command === 'run') return run(process.argv.includes('--dry-run'));
  if (command === 'sentinel') return sentinel();
  if (command === 'smoke') return smoke();
  if (command === 'repair') {
    const result = repairLedger(LEDGER_FILE);
    console.log(`ledger repaired rows=${result.repaired}; backup=${result.backup ?? 'none'}`);
    return;
  }
  if (command === 'reclaim') { releaseAtomicLock(OWNER_LOCK); console.log('local atomic owner lock reclaimed; flock remains kernel-owned'); return; }
  if (command === 'status') { console.log(JSON.stringify(readLedger(LEDGER_FILE), null, 2)); return; }
  throw new Error(`unknown supervisor command: ${command}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); } catch (error) { console.error(error.stack || error.message); process.exitCode = 1; }
}
