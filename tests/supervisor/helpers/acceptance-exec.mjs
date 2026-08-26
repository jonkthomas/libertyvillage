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
//
// FIFTH eval-owner correction — INDIRECT sync children. A frozen path does not
// have to write execFileSync itself to deadlock the checker. Calling an imported
// PRODUCTION function whose DEFAULT parameter spawns the coordinator/CLI
// synchronously is the same defect one level down: C-N13-outcome called
// `recordSupervisorOutcome(payload)` and production defaulted `coordinatorFn` to
// `coordinator()`, which runs coordinator.mjs through execFileSync. Observed
// >3m at 0% CPU on `record-candidate-outcome --outcome MONITOR_TIMEOUT`. The
// fix is evaluator-side only: inject `asyncCoordinatorSeam().fn` through the
// seam production already exposes. No production wrapper becomes async.
import fs from 'node:fs';
import os from 'node:os';
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
        label, code, signal, stdout, stderr, timedOut, pid: child.pid,
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

// Known PRODUCTION functions that reach a synchronous child (directly, or via a
// DEFAULT parameter/callback) which can speak to the loopback double or run the
// coordinator/CLI. A frozen eval that calls one of these while the in-process
// double is listening deadlocks the checker THROUGH production code. `seam` is
// the production parameter the evaluator must inject to stay async; `seam: null`
// means production exposes none, so a frozen eval must not call it at all.
export const PRODUCTION_SYNC_SPAWN_WRAPPERS = Object.freeze([
  Object.freeze({ name: 'recordSupervisorOutcome', module: 'scripts/supervisor/host-run.mjs', seam: 'coordinatorFn', reaches: 'coordinator() → execFileSync(coordinator.mjs record-candidate-outcome)' }),
  Object.freeze({ name: 'coordinator', module: 'scripts/supervisor/host-run.mjs', seam: null, reaches: 'execFileSync(coordinator.mjs …)' }),
  Object.freeze({ name: 'runCommand', module: 'scripts/supervisor/host-run.mjs', seam: null, reaches: 'execFileSync(<file>)' }),
  Object.freeze({ name: 'cleanupDataBranch', module: 'scripts/supervisor/host-run.mjs', seam: null, reaches: 'execFileSync(git ls-remote/push origin)' }),
  Object.freeze({ name: 'resolveHostWeeklyOwner', module: 'scripts/supervisor/host-run.mjs', seam: null, reaches: 'execFileSync(git fetch/show origin)' }),
  Object.freeze({ name: 'runBlogSupervisor', module: 'scripts/supervisor/host-run.mjs', seam: null, reaches: 'execFileSync(git/npm) + coordinator()' }),
]);

// The eval-owned async machinery. A wrapper call is only safe when its own call
// expression hands production one of these; anything else takes the synchronous
// production default and deadlocks.
export const ASYNC_SEAM_MARKERS = Object.freeze([
  'asyncCoordinatorSeam', 'coordinatorFn', 'seam.fn', 'runCoordinator', 'runExternal',
]);

const parseGithubOutput = (file) => Object.fromEntries(fs.readFileSync(file, 'utf8').trim().split('\n')
  .filter(Boolean).map((line) => { const split = line.indexOf('='); return [line.slice(0, split), line.slice(split + 1)]; }));

// Bounded ASYNC drop-in for production `coordinator(repoRoot, args, { repo })`,
// injected through an existing production seam (today: recordSupervisorOutcome's
// `coordinatorFn`). It mirrors the production wrapper exactly — a private
// GITHUB_OUTPUT file, the appended `--repo`, the key=value parse, a throw on a
// nonzero exit — but launches the child through runCoordinator so the evaluator
// keeps serving the double it hosts. Every invocation is recorded, so callers
// still assert production's own argument mapping instead of trusting it.
export function asyncCoordinatorSeam({
  cloneDir = null, env, extraEnv = {}, timeoutMs = COORDINATOR_TIMEOUT_MS, label = 'coordinator',
} = {}) {
  const calls = [];
  const fn = async (repoRoot, args, options = {}) => {
    const root = cloneDir ?? repoRoot;
    const call = { repoRoot, args: [...args], options: { ...options }, argv: null, result: null, outputs: null };
    calls.push(call);
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-accept-coordinator-'));
    const output = path.join(directory, 'output');
    fs.writeFileSync(output, '', { mode: 0o600 });
    const name = `${label} ${args[0]}`;
    try {
      call.argv = [...args, '--repo', options.repo];
      call.result = await runCoordinator(root, call.argv, {
        cwd: root, env, timeoutMs, label: name, extraEnv: { ...extraEnv, GITHUB_OUTPUT: output },
      });
      assertSettled(call.result, name);
      if (call.result.code !== 0) {
        throw new Error(`${name} exited ${call.result.code}: ${(call.result.stderr || call.result.stdout).slice(-400)}`);
      }
      call.outputs = parseGithubOutput(output);
      return call.outputs;
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  };
  // Orphan sweep: every child this seam launched must be gone once it settled.
  const orphans = () => calls.map((call) => call.result?.pid).filter((pid) => {
    if (!pid) return false;
    try { process.kill(pid, 0); return true; } catch { return false; }
  });
  return { fn, calls, orphans };
}
