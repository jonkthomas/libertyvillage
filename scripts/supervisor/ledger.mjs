import fs from 'node:fs';
import path from 'node:path';
import { acquireAtomicLock, leaseIsLive, newLease, pidAlive, releaseAtomicLock } from './lease.mjs';

export const SCHEMA_VERSION = 1;
export const MAX_RUNS = 50;
export const TERMINALS = Object.freeze([
  'BASELINE_FAILED', 'SKIPPED_OWNER', 'SKIPPED_LEASE', 'SKIPPED_CANDIDATE',
  'DISCARDED_PRE_PR', 'GENERATION_FAILED_PRE_PR', 'INGEST_FAILED',
  'MERGED_STAGING', 'BLOCKED_EXHAUSTED', 'BLOCKED_UNREPAIRABLE',
  'BLOCKED_VALIDATION', 'ABANDONED_TOPIC', 'MONITOR_TIMEOUT',
  'DRY_RUN',
]);

export function emptyLedger() {
  return { schema_version: SCHEMA_VERSION, lease: null, runs: [] };
}

export function validateLedger(value) {
  if (!value || value.schema_version !== SCHEMA_VERSION || !Array.isArray(value.runs)) {
    throw new Error(`invalid supervisor ledger schema (expected ${SCHEMA_VERSION})`);
  }
  for (const run of value.runs) {
    if (run?.terminal !== null && run?.terminal !== undefined && !TERMINALS.includes(run.terminal)) {
      throw new Error(`invalid supervisor terminal: ${String(run?.terminal)}`);
    }
    if (run?.terminal && run?.pr_number && run?.pr_state === 'open') {
      throw new Error('terminal invariant violated: an owned PR cannot remain open at terminal');
    }
  }
  return value;
}

export function compactLedger(value) {
  const ledger = structuredClone(validateLedger(value));
  delete ledger.vm;
  const active = ledger.runs.filter((run) => !run.terminal);
  const terminal = ledger.runs.filter((run) => run.terminal).slice(-MAX_RUNS);
  ledger.runs = [...terminal, ...active];
  return ledger;
}

export function repairLedger(file, {
  now = new Date(), ownerLock = path.join(path.dirname(file), 'run.owner'), pidAliveFn = pidAlive,
} = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const repairLease = newLease({ runId: `ledger-repair-${process.pid}`, lockPath: path.join(path.dirname(file), 'run.flock'), now });
  const owner = acquireAtomicLock(ownerLock, repairLease, {
    isLive: (current) => leaseIsLive(current, { now: now.getTime(), pidAlive: pidAliveFn }),
  });
  if (!owner.acquired) throw new Error(`ledger repair refused while live owner ${owner.current?.run_id ?? 'unknown'} holds the run lock`);
  try {
    return withLedgerWriteLock(file, () => {
      if (!fs.existsSync(file)) return { ledger: writeLedgerAtomic(file, emptyLedger()), backup: null, repaired: 0 };
      const raw = fs.readFileSync(file, 'utf8');
      let parsed;
      try { parsed = JSON.parse(raw); } catch { throw new Error('ledger repair refused malformed JSON; restore the file from a known backup'); }
      if (!parsed || parsed.schema_version !== SCHEMA_VERSION || !Array.isArray(parsed.runs)) {
        throw new Error(`ledger repair refused an unknown schema (expected ${SCHEMA_VERSION})`);
      }
      if (leaseIsLive(parsed.lease, { now: now.getTime(), pidAlive: pidAliveFn })) {
        throw new Error(`ledger repair refused while live ledger lease ${parsed.lease.run_id ?? 'unknown'} exists`);
      }
      const stamp = now.toISOString().replace(/[.:]/g, '-');
      const backup = `${file}.repair-backup-${stamp}`;
      fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(backup, 0o600);
      let repaired = 0;
      for (const run of parsed.runs) {
        const invalidTerminal = run?.terminal != null && !TERMINALS.includes(run.terminal);
        const openTerminal = Boolean(run?.terminal && run?.pr_number && run?.pr_state === 'open');
        const failedRecovery = ['TERMINALIZATION_FAILED', 'RECOVERY_REQUIRED', 'RECOVERY_PARKED'].includes(run?.state);
        if (!invalidTerminal && !openTerminal && !failedRecovery) continue;
        const repairMessage = `ledger repair queued safe terminal reconciliation from ${String(run.state || run.terminal)}`;
        run.error = run.error ? `${run.error}; ${repairMessage}` : repairMessage;
        run.state = 'RECOVERY_PENDING';
        run.recovery_attempts = 0;
        run.terminal = null;
        run.terminal_at = null;
        run.updated_at = now.toISOString();
        repaired += 1;
      }
      delete parsed.vm;
      return { ledger: writeLedgerAtomic(file, parsed), backup, repaired };
    });
  } finally {
    releaseAtomicLock(ownerLock);
  }
}

export function readLedger(file) {
  if (!fs.existsSync(file)) return emptyLedger();
  return validateLedger(JSON.parse(fs.readFileSync(file, 'utf8')));
}

export function writeLedgerAtomic(file, value, { fsImpl = fs } = {}) {
  const ledger = compactLedger(value);
  fsImpl.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  const data = `${JSON.stringify(ledger, null, 2)}\n`;
  let fd;
  try {
    fd = fsImpl.openSync(temporary, 'wx', 0o600);
    fsImpl.writeFileSync(fd, data);
    fsImpl.fsyncSync(fd);
    fsImpl.closeSync(fd);
    fd = undefined;
    fsImpl.renameSync(temporary, file);
    const directory = fsImpl.openSync(path.dirname(file), 'r');
    try { fsImpl.fsyncSync(directory); } finally { fsImpl.closeSync(directory); }
  } finally {
    if (fd !== undefined) fsImpl.closeSync(fd);
    try { fsImpl.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return ledger;
}

function withLedgerWriteLock(file, action) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const lock = `${file}.write-lock`;
  const deadline = Date.now() + 5_000;
  let fd;
  while (fd === undefined) {
    try { fd = fs.openSync(lock, 'wx', 0o600); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > 30_000) { fs.unlinkSync(lock); continue; }
      } catch (statError) { if (statError.code !== 'ENOENT') throw statError; }
      if (Date.now() >= deadline) throw new Error('timed out acquiring supervisor ledger write lock');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  try {
    return action();
  } finally {
    fs.closeSync(fd);
    try { fs.unlinkSync(lock); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

export function updateLedger(file, update) {
  return withLedgerWriteLock(file, () => {
    const ledger = readLedger(file);
    const next = update(structuredClone(ledger)) ?? ledger;
    return writeLedgerAtomic(file, next);
  });
}

export function terminalizeRun(run, terminal, { now = new Date(), prState } = {}) {
  if (!TERMINALS.includes(terminal)) throw new Error(`unknown terminal: ${terminal}`);
  if (run?.pr_number && prState === 'open') {
    throw new Error('terminal invariant violated: owned PR remains open at terminal');
  }
  return {
    ...run, state: 'TERMINAL', terminal, terminal_at: now.toISOString(),
    updated_at: now.toISOString(), ...(prState ? { pr_state: prState } : {}),
  };
}
