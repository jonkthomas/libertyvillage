// Eval-owned bounded ASYNC external-child machinery for the local live-model
// supervisor acceptance gate. FROZEN by evals/local-supervisor-acceptance.sha256.
//
// WHY THIS FILE EXISTS (fourth eval-owner correction). The evaluator process
// HOSTS the loopback GitHub double (`fake-supervisor-github.mjs` listens on
// 127.0.0.1 inside this very process). Launching an external coordinator with
// execFileSync/spawnSync therefore blocks the evaluator's own event loop: the
// child completes its TCP connect and then waits forever for a response the
// blocked host can never write. That is a CHECKER deadlock — no production
// change can fix it — and it was observed twice on a real full live run (N4
// `coordinator.mjs record-candidate-outcome --reason replay`, stalled >3m at 0%
// CPU; C-N5 `coordinator.mjs heal-generator-base`, stalled >2m).
//
// Every external child that could speak to the in-process double MUST be
// launched through `runExternal`/`runCoordinator`: async (the event loop keeps
// serving), detached into its own process group, bounded by a short per-call
// timeout, and swept by a process-group SIGKILL. Callers then assert COMPLETION
// or REJECTION with `assertSettled` + an explicit exit-code expectation — a
// child that merely failed to hang is never acceptance evidence.
import path from 'node:path';
import { spawn } from 'node:child_process';

// Short bounded per-call ceilings. Both are an order of magnitude below the
// observed stalls, so a reintroduced deadlock surfaces as a fast, named failure.
export const COORDINATOR_TIMEOUT_MS = 60_000;
export const CONTROL_TIMEOUT_MS = 60_000;

// Async bounded child launch. Never rejects: the settled shape carries
// timedOut/spawnError so the caller can assert on it explicitly.
export function runExternal(file, args, {
  cwd, env, timeoutMs = CONTROL_TIMEOUT_MS, maxOutput = 1024 * 1024, label = file,
} = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(file, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let spawnError = null;
    const keep = (current, chunk) => (current.length >= maxOutput ? current : current + chunk.toString('utf8'));
    child.stdout.on('data', (chunk) => { stdout = keep(stdout, chunk); });
    child.stderr.on('data', (chunk) => { stderr = keep(stderr, chunk); });
    // Process-group cleanup: the child is its own group leader, so one negative
    // pid reaps it and any grandchild coordinator/git it started.
    const killGroup = () => {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* exited */ } }
    };
    const timer = setTimeout(() => { timedOut = true; killGroup(); }, timeoutMs);
    child.on('error', (error) => { spawnError = error?.message || String(error); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      killGroup();
      resolve({
        label, code, signal, stdout, stderr, timedOut,
        spawnError, timeoutMs, durationMs: Date.now() - startedAt,
      });
    });
  });
}

// Launches a production coordinator subcommand from the scenario clone against
// the loopback double. The spawn-logger import and log path are cleared so the
// evaluator-driven child never pollutes the observed spawn evidence.
export function runCoordinator(cloneDir, args, {
  cwd, env, extraEnv = {}, timeoutMs = COORDINATOR_TIMEOUT_MS, label = `coordinator ${args[0]}`,
} = {}) {
  const script = path.join(cloneDir, 'scripts/automation/coordinator.mjs');
  return runExternal(process.execPath, [script, ...args], {
    cwd: cwd ?? cloneDir, timeoutMs, label,
    env: { ...env, NODE_OPTIONS: '', LV_ACCEPT_SPAWN_LOG: '', ...extraEnv },
  });
}

// Completion/rejection assertion: a bounded-timeout kill or a failed spawn is a
// checker defect, never a passing observation.
export function assertSettled(result, label) {
  if (result?.spawnError) throw new Error(`${label}: child could not be spawned — ${result.spawnError}`);
  if (result?.timedOut) {
    throw new Error(`${label}: EVALUATOR_CHILD_DEADLINE — the child did not settle within ${result.timeoutMs}ms `
      + '(a same-process loopback + synchronous-child deadlock, or a genuinely hung coordinator); '
      + `killed by process group after ${result.durationMs}ms`);
  }
  if (typeof result?.code !== 'number' && !result?.signal) throw new Error(`${label}: child produced no exit status`);
  return result;
}
