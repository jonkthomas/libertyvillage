import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { emptyLedger, readLedger, repairLedger, terminalizeRun, writeLedgerAtomic } from '../../scripts/supervisor/ledger.mjs';
import { acquireAtomicLock, leaseIsLive, newLease, releaseAtomicLock } from '../../scripts/supervisor/lease.mjs';

test('ledger uses an atomic replacement and retains only 50 terminal runs', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-ledger-'));
  const file = path.join(directory, 'ledger.json');
  const ledger = emptyLedger();
  ledger.runs = Array.from({ length: 55 }, (_, index) => ({ run_id: String(index), terminal: 'SKIPPED_OWNER' }));
  writeLedgerAtomic(file, ledger);
  assert.equal(readLedger(file).runs.length, 50);
  assert.deepEqual(fs.readdirSync(directory), ['ledger.json']);
});

test('terminal invariant rejects every terminal while the owned PR is open', () => {
  assert.throws(() => terminalizeRun({ run_id: 'one', pr_number: 10 }, 'MERGED_STAGING', { prState: 'open' }), /remains open/);
  assert.throws(() => terminalizeRun({ run_id: 'one', pr_number: 10 }, 'BLOCKED_VALIDATION', { prState: 'open' }), /remains open/);
  assert.equal(terminalizeRun({ run_id: 'one', pr_number: 10 }, 'MERGED_STAGING', { prState: 'closed' }).terminal, 'MERGED_STAGING');
  assert.throws(() => terminalizeRun({}, 'PROMOTED_MAIN'), /unknown terminal/);
});

test('atomic lease refuses a live owner and reclaims a stale owner', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-lease-'));
  const file = path.join(directory, 'owner');
  const first = newLease({ runId: 'first', lockPath: file });
  assert.equal(acquireAtomicLock(file, first).acquired, true);
  assert.equal(acquireAtomicLock(file, newLease({ runId: 'second', lockPath: file }), { isLive: () => true }).acquired, false);
  const reclaimed = acquireAtomicLock(file, newLease({ runId: 'second', lockPath: file }), { isLive: () => false });
  assert.deepEqual({ acquired: reclaimed.acquired, reclaimed: reclaimed.reclaimed }, { acquired: true, reclaimed: true });
  releaseAtomicLock(file);
});

test('lease freshness requires both a live pid and a recent heartbeat', () => {
  const lease = newLease({ runId: 'run', lockPath: '/tmp/lock', now: new Date('2026-08-24T00:00:00Z') });
  assert.equal(leaseIsLive(lease, { now: Date.parse('2026-08-24T00:10:00Z'), pidAlive: () => true }), true);
  assert.equal(leaseIsLive(lease, { now: Date.parse('2026-08-24T00:16:00Z'), pidAlive: () => true }), false);
  assert.equal(leaseIsLive(lease, { now: Date.parse('2026-08-24T00:10:00Z'), pidAlive: () => false }), false);
  assert.equal(leaseIsLive(lease, { now: Date.parse('2026-08-24T07:00:00Z'), pidAlive: () => true }), false);
});

test('repair preserves a backup and queues unsafe or failed recovery rows', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-ledger-repair-'));
  const file = path.join(directory, 'ledger.json');
  fs.writeFileSync(file, JSON.stringify({ schema_version: 1, vm: {}, lease: null, runs: [
    { run_id: 'broken', terminal: 'BLOCKED_VALIDATION', terminal_at: 'old', pr_number: 10, pr_state: 'open' },
    { run_id: 'wedged', state: 'TERMINALIZATION_FAILED', terminal: null, error: 'old failure' },
    { run_id: 'retry', state: 'RECOVERY_REQUIRED', terminal: null, error: 'old retry' },
    { run_id: 'parked', state: 'RECOVERY_PARKED', recovery_attempts: 3, terminal: null, error: 'original parked diagnostic' },
    { run_id: 'good', terminal: 'MERGED_STAGING', pr_number: 11, pr_state: 'closed' },
  ] }));
  const result = repairLedger(file, { now: new Date('2026-08-24T12:00:00Z') });
  assert.equal(result.repaired, 4);
  assert.equal(fs.existsSync(result.backup), true);
  const broken = result.ledger.runs.find((run) => run.run_id === 'broken');
  const good = result.ledger.runs.find((run) => run.run_id === 'good');
  assert.equal(broken.terminal, null);
  assert.equal(broken.state, 'RECOVERY_PENDING');
  const wedged = result.ledger.runs.find((run) => run.run_id === 'wedged');
  assert.equal(wedged.state, 'RECOVERY_PENDING');
  assert.match(wedged.error, /^old failure; ledger repair queued/);
  assert.equal(result.ledger.runs.find((run) => run.run_id === 'retry').state, 'RECOVERY_PENDING');
  const parked = result.ledger.runs.find((run) => run.run_id === 'parked');
  assert.equal(parked.state, 'RECOVERY_PENDING');
  assert.equal(parked.recovery_attempts, 0);
  assert.match(parked.error, /^original parked diagnostic; ledger repair queued/);
  assert.equal(good.terminal, 'MERGED_STAGING');
  assert.equal('vm' in result.ledger, false);
});

test('repair refuses a live atomic owner and a live ledger lease', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-ledger-live-repair-'));
  const file = path.join(directory, 'ledger.json');
  const owner = path.join(directory, 'run.owner');
  const now = new Date('2026-08-24T12:00:00Z');
  const lease = newLease({ runId: 'active', pid: 4242, lockPath: path.join(directory, 'run.flock'), now });
  writeLedgerAtomic(file, { ...emptyLedger(), lease, runs: [] });
  assert.equal(acquireAtomicLock(owner, lease).acquired, true);
  assert.throws(() => repairLedger(file, { now, ownerLock: owner, pidAliveFn: () => true }), /live owner active/);
  releaseAtomicLock(owner);
  assert.throws(() => repairLedger(file, { now, ownerLock: owner, pidAliveFn: () => true }), /live ledger lease active/);
  assert.equal(fs.existsSync(`${file}.write-lock`), false);
  assert.equal(fs.existsSync(owner), false);
});
